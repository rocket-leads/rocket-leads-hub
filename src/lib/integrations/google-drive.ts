import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { ResolvedEntity } from "./resolved-entity"

let cachedAuth: { value: InstanceType<typeof google.auth.GoogleAuth>; expiresAt: number } | null = null

async function getAuth() {
  if (cachedAuth && Date.now() < cachedAuth.expiresAt) return cachedAuth.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "google_drive")
    .single()

  if (!data) throw new Error("Google Drive service account not configured. Go to Settings → API Tokens.")

  const keyJson = JSON.parse(decrypt(data.token_encrypted))

  // Scopes: `drive.readonly` for the existing knowledge-base ingest, plus
  // `drive.file` so we can write Pedro refresh deliverables INTO folders
  // the service account was already given Editor access to. `drive.file`
  // is the narrower of the two write scopes — it only authorises files
  // the service account itself creates, which is exactly what we want
  // (no risk of clobbering an existing client file by accident).
  //
  // Folder share precondition: the client's Drive folder must be shared
  // with the service account email as Editor for write to succeed.
  // Without it, createMarkdownFile() returns a 403 which the calling
  // endpoint surfaces to the AM ("Drive folder must be shared as Editor").
  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
  })

  cachedAuth = { value: auth, expiresAt: Date.now() + 30 * 60 * 1000 }
  return auth
}

export type CreatedDriveFile = {
  id: string
  webViewLink: string
  name: string
}

/**
 * Create a plain Markdown file inside the given Drive folder.
 *
 * Roy 2026-06-09: Pedro refresh deliverables push here so the CM can find
 * them in the client's existing Drive folder without manually exporting.
 *
 * Permission failures surface as a thrown error with a hint about the
 * Editor share — the caller wraps this so the AM sees an actionable
 * message instead of a stack trace.
 */
export async function createMarkdownFile(args: {
  folderId: string
  name: string
  contentMarkdown: string
}): Promise<CreatedDriveFile> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  try {
    const res = await drive.files.create({
      requestBody: {
        name: args.name.endsWith(".md") ? args.name : `${args.name}.md`,
        parents: [args.folderId],
        mimeType: "text/markdown",
      },
      media: {
        mimeType: "text/markdown",
        body: args.contentMarkdown,
      },
      fields: "id, name, webViewLink",
      supportsAllDrives: true,
    })
    const data = res.data
    if (!data.id) throw new Error("Drive create returned no file id")
    return {
      id: data.id,
      name: data.name ?? args.name,
      webViewLink: data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/permission|forbidden|insufficient|insufficientFilePermissions/i.test(msg)) {
      throw new Error(
        "Drive folder is niet als Editor gedeeld met het service-account. Open de folder, kies Share, en geef het service-account-emailadres Editor-rechten.",
      )
    }
    throw e
  }
}

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
}

export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })

    for (const f of res.data.files ?? []) {
      files.push({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        modifiedTime: f.modifiedTime!,
      })
    }

    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

/**
 * Format `modifiedTime` (ISO8601) as a short relative label for the picker
 * subline ("modified 3d ago"). Keeps things tight in the row — anything
 * past a year is rendered as the year only.
 */
function relativeModifiedLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  const diffSec = Math.floor((Date.now() - ms) / 1000)
  if (diffSec < 60) return "modified just now"
  if (diffSec < 3600) return `modified ${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `modified ${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 30 * 86400) return `modified ${Math.floor(diffSec / 86400)}d ago`
  if (diffSec < 365 * 86400) return `modified ${Math.floor(diffSec / (30 * 86400))}mo ago`
  return `modified in ${new Date(ms).getFullYear()}`
}

type DriveFolderSummary = {
  id: string
  name: string
  modifiedTime: string | null
  trashed: boolean
}

function toResolvedDriveFolder(f: DriveFolderSummary): ResolvedEntity {
  const subParts: string[] = []
  const modLabel = relativeModifiedLabel(f.modifiedTime)
  if (modLabel) subParts.push(modLabel)
  return {
    id: f.id,
    name: f.name,
    subline: subParts.length > 0 ? subParts.join(" · ") : undefined,
    // Trashed folders are resolvable but unusable as a link target; flag
    // loudly so the AM can fix before it silently breaks file creation.
    status: f.trashed ? "error" : "ok",
    statusLabel: f.trashed ? "In trash" : undefined,
  }
}

/**
 * Search Drive folders by name for the ConnectedEntity picker.
 *
 * Uses `files.list` with a server-side `name contains` filter — Drive
 * supports this natively so we don't have to do client-side substring
 * matching. Scopes to folders the service account can see (it's been
 * shared in as Editor or Viewer); workspace folders the service account
 * has no access to won't appear, which is the correct behavior — those
 * aren't link candidates anyway.
 *
 * Empty query returns the most-recently-modified folders so cold-open
 * shows "folders I actually use", not the alphabetical A-list.
 */
export async function searchDriveFolders(
  query: string,
  limit = 10,
): Promise<ResolvedEntity[]> {
  const trimmed = query.trim()
  const cap = Math.min(Math.max(limit, 1), 25)
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  // Drive's `q` filter accepts a mix of clauses joined with `and`. Escape
  // single quotes in the name fragment so a folder called "Roy's Tests"
  // doesn't break the query string.
  const escaped = trimmed.replace(/'/g, "\\'")
  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
  ]
  if (escaped.length > 0) clauses.push(`name contains '${escaped}'`)
  const q = clauses.join(" and ")

  const res = await drive.files.list({
    q,
    fields: "files(id, name, modifiedTime, trashed)",
    pageSize: cap,
    orderBy: "modifiedTime desc",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })

  const folders: DriveFolderSummary[] = (res.data.files ?? []).map((f) => ({
    id: f.id ?? "",
    name: f.name ?? f.id ?? "",
    modifiedTime: f.modifiedTime ?? null,
    trashed: f.trashed === true,
  }))
  return folders.map(toResolvedDriveFolder)
}

/**
 * Resolve a single Drive folder ID to its ResolvedEntity. Returns null
 * when the folder doesn't exist or the service account has no access —
 * both are "broken link" from the Hub's perspective; the AM needs to
 * either fix the ID or share the folder. Throws on transport/auth
 * failures so the picker shows "couldn't verify" instead of "broken".
 */
export async function resolveDriveFolder(id: string): Promise<ResolvedEntity | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })
  try {
    const res = await drive.files.get({
      fileId: trimmed,
      fields: "id, name, mimeType, modifiedTime, trashed",
      supportsAllDrives: true,
    })
    const f = res.data
    if (!f.id) return null
    if (f.mimeType !== "application/vnd.google-apps.folder") {
      // It's a real file ID but not a folder — wrong link, treat as broken
      // so the picker prompts a correction rather than silently accepting
      // a file ID where the rest of the Hub expects a folder.
      return null
    }
    return toResolvedDriveFolder({
      id: f.id,
      name: f.name ?? f.id,
      modifiedTime: f.modifiedTime ?? null,
      trashed: f.trashed === true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Drive throws "File not found" (404) for both missing files AND
    // files the service account has no access to. Both are "broken link"
    // from the Hub's perspective.
    if (/not found|404|file not found/i.test(msg)) return null
    throw e
  }
}

export async function getFileContent(fileId: string, mimeType: string): Promise<string> {
  const auth = await getAuth()
  const drive = google.drive({ version: "v3", auth })

  // Google Docs/Sheets/Slides — export as plain text
  if (mimeType.startsWith("application/vnd.google-apps.")) {
    const exportMime = mimeType === "application/vnd.google-apps.spreadsheet"
      ? "text/csv"
      : "text/plain"

    const res = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "text" },
    )
    return String(res.data)
  }

  // Plain text files
  if (mimeType.startsWith("text/")) {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" },
    )
    return String(res.data)
  }

  // PDFs — download binary and extract text
  if (mimeType === "application/pdf") {
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" },
    )
    return extractPdfText(res.data as ArrayBuffer)
  }

  // Word documents — export via Google's conversion
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" },
    )
    return String(res.data)
  }

  return `[Unsupported file type: ${mimeType}]`
}

function extractPdfText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const raw = new TextDecoder("latin1").decode(bytes)

  const textBlocks: string[] = []

  const btEtRegex = /BT\s([\s\S]*?)ET/g
  let match
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1]
    const tjRegex = /\(([^)]*)\)\s*Tj/g
    let tj
    while ((tj = tjRegex.exec(block)) !== null) {
      textBlocks.push(tj[1])
    }
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g
    let tja
    while ((tja = tjArrayRegex.exec(block)) !== null) {
      const parts = tja[1].match(/\(([^)]*)\)/g)
      if (parts) {
        textBlocks.push(parts.map((p) => p.slice(1, -1)).join(""))
      }
    }
  }

  const text = textBlocks.join(" ")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return text || "[PDF content could not be extracted — may be image-based]"
}
