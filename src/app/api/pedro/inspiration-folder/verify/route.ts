import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listFolderFiles } from "@/lib/integrations/google-drive"
import { getInspirationFolderId } from "@/lib/pedro/visual-reference-library"

/**
 * Verify the configured AD CREATIVES INSPIRATION root folder is reachable
 * + enumerate which canonical subfolders are present (and how many image
 * files each holds). Powers the "✓ Verbonden — 4 subfolders gevonden"
 * indicator on the Pedro Optimize settings panel.
 *
 * Response shape:
 *   { connected: false, folderId: null }
 *   { connected: false, folderId: "<id>", error: "Drive: folder not found" }
 *   { connected: true,  folderId: "<id>", subfolders: [
 *       { key: "client_content", name: "Client content", id, fileCount, found: true },
 *       { key: "ai_animation",   name: null,             id: null, fileCount: 0, found: false },
 *       ...
 *     ] }
 *
 * Roy 2026-06-13.
 */

export const dynamic = "force-dynamic"

type SubfolderKey =
  | "client_content"
  | "client_content_ai"
  | "ai_content"
  | "ai_animation"
  | "stock_content"

const CANONICAL_SUBFOLDERS: Array<{ key: SubfolderKey; candidates: string[] }> = [
  { key: "client_content", candidates: ["Client content"] },
  { key: "client_content_ai", candidates: ["Client content + AI", "Client content+AI"] },
  { key: "ai_content", candidates: ["AI Content"] },
  { key: "ai_animation", candidates: ["AI Animation"] },
  { key: "stock_content", candidates: ["Stock content"] },
]

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])
const FOLDER_MIME = "application/vnd.google-apps.folder"

function normaliseName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const folderId = await getInspirationFolderId()
  if (!folderId) {
    return NextResponse.json({ connected: false, folderId: null })
  }

  let rootEntries: Awaited<ReturnType<typeof listFolderFiles>>
  try {
    rootEntries = await listFolderFiles(folderId)
  } catch (e) {
    return NextResponse.json({
      connected: false,
      folderId,
      error: e instanceof Error ? e.message : "Drive enumeration failed",
    })
  }

  const subfolders = rootEntries.filter((f) => f.mimeType === FOLDER_MIME)

  // For each canonical subfolder, find a match by exact-or-substring name
  // (drift-tolerant: "Client content+AI" matches "Client content + AI").
  // When found, count image files one level deep so the CM sees the
  // ref pool size next to the toggle.
  const results = await Promise.all(
    CANONICAL_SUBFOLDERS.map(async ({ key, candidates }) => {
      const normCandidates = candidates.map(normaliseName)
      const match =
        subfolders.find((s) => normCandidates.includes(normaliseName(s.name))) ??
        subfolders.find((s) =>
          normCandidates.some((c) => normaliseName(s.name).includes(c)),
        )

      if (!match) {
        return { key, name: null, id: null, fileCount: 0, found: false as const }
      }

      let fileCount = 0
      try {
        const files = await listFolderFiles(match.id)
        for (const f of files) {
          if (IMAGE_MIME_TYPES.has(f.mimeType)) {
            fileCount++
          } else if (f.mimeType === FOLDER_MIME) {
            // One nested level deep — matches visual-reference-library's
            // walk so the count reflects what Pedro can actually pull.
            try {
              const nested = await listFolderFiles(f.id)
              for (const n of nested) {
                if (IMAGE_MIME_TYPES.has(n.mimeType)) fileCount++
              }
            } catch {
              // Swallow — partial count is better than failing the verify.
            }
          }
        }
      } catch {
        // Match exists but enumeration failed — surface 0 with found=true
        // so the UI shows "folder detected, count unavailable".
      }

      return {
        key,
        name: match.name,
        id: match.id,
        fileCount,
        found: true as const,
      }
    }),
  )

  return NextResponse.json({
    connected: true,
    folderId,
    subfolders: results,
  })
}
