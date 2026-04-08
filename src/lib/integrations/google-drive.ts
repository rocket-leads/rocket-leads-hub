import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

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

  const auth = new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  })

  cachedAuth = { value: auth, expiresAt: Date.now() + 30 * 60 * 1000 }
  return auth
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
