import { listFolderFiles, downloadDriveFileBytes } from "@/lib/integrations/google-drive"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Visual Reference Library - Roy 2026-06-12.
 *
 * Pedro's branded composite + AI polish slots produce mediocre output
 * when the only Gemini reference is "the client photo". Knowledge base
 * (campaigns.md §7) calls for a shared `AD CREATIVES INSPIRATION/`
 * Drive folder with subfolders per content category. We pick a random
 * recent image from the matching subfolder and inject it as the FIRST
 * reference image to Gemini - that one slot becomes the quality bar
 * for composition, lighting, typography, and mood.
 *
 * Subfolder mapping (knowledge/campaigns.md §7):
 *   - Client content/         → real_photo
 *   - Client content + AI/    → real_ai_polish
 *   - AI Content/             → branded_composite
 *   - AI Animation/           → (reserved - we don't generate motion yet)
 *   - Stock content/          → (only used when Pexels-stock is on; not
 *                                from this library)
 *
 * Config: settings key `pedro_inspiration_folder_id` (JSONB value is
 * the Drive folder id as a string). When unset, every helper here
 * becomes a no-op so the calling code can fall back gracefully.
 *
 * Caching: the subfolder file lists are cached in-process for an hour.
 * Drive's file listings rarely change, and the auto-promote-on-push
 * hook we add later in the campaign lifecycle invalidates the cache
 * when needed.
 */

type SlotStyle = "real_photo" | "real_ai_polish" | "branded_composite" | "lifestyle"

const SUBFOLDER_BY_STYLE: Record<SlotStyle, string[]> = {
  real_photo: ["Client content"],
  real_ai_polish: ["Client content + AI", "Client content"],
  branded_composite: ["AI Content"],
  // Lifestyle leans on client photos with cinematic light - Client content
  // gives the most authentic reference, with Client + AI as fallback.
  lifestyle: ["Client content", "Client content + AI"],
}

const CACHE_TTL_MS = 60 * 60 * 1000
type CacheEntry = {
  fetchedAt: number
  files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>
}
const subfolderCache = new Map<string, CacheEntry>()

/** Read the configured inspiration root folder id. Null when the admin
 *  hasn't set it - the calling code should fall back gracefully. */
export async function getInspirationFolderId(): Promise<string | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "pedro_inspiration_folder_id")
      .maybeSingle<{ value: string | null }>()
    const raw = data?.value
    if (typeof raw === "string" && raw.trim().length > 0) return raw.trim()
    return null
  } catch {
    return null
  }
}

/** List the immediate subfolders of the inspiration root. Used by the
 *  Settings UI to surface "which categories are detected" and for the
 *  picker below to map style → folder id. */
async function listInspirationSubfolders(
  rootFolderId: string,
): Promise<Array<{ id: string; name: string }>> {
  const cacheKey = `subfolders:${rootFolderId}`
  const cached = subfolderCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.files.map((f) => ({ id: f.id, name: f.name }))
  }
  const files = await listFolderFiles(rootFolderId).catch(() => [])
  const subfolders = files.filter(
    (f) => f.mimeType === "application/vnd.google-apps.folder",
  )
  subfolderCache.set(cacheKey, {
    fetchedAt: Date.now(),
    files: subfolders,
  })
  return subfolders.map((f) => ({ id: f.id, name: f.name }))
}

function normaliseName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim()
}

/** Find a subfolder by approximate name match. Drive folder names
 *  occasionally drift ("Client content+AI" vs "Client content + AI");
 *  we normalise spaces and do a substring check rather than exact. */
function findSubfolderByName(
  subfolders: Array<{ id: string; name: string }>,
  candidates: string[],
): { id: string; name: string } | null {
  const normCandidates = candidates.map(normaliseName)
  for (const cand of normCandidates) {
    const hit = subfolders.find((s) => normaliseName(s.name) === cand)
    if (hit) return hit
  }
  // Loose match: subfolder name CONTAINS the candidate (handles trailing
  // emojis, dashes, or copy suffixes the CM might have added).
  for (const cand of normCandidates) {
    const hit = subfolders.find((s) => normaliseName(s.name).includes(cand))
    if (hit) return hit
  }
  return null
}

/** List image files under a subfolder, recursing one level deep so a CM
 *  can group sub-categories ("AI Content/Tech", "AI Content/Wellness")
 *  without hiding the files from us. */
async function listImagesUnderFolder(
  folderId: string,
): Promise<Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>> {
  const cacheKey = `images:${folderId}`
  const cached = subfolderCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.files
  }

  const all: CacheEntry["files"] = []
  const seen = new Set<string>()
  async function walk(id: string, depth: number): Promise<void> {
    if (depth > 1) return
    const items = await listFolderFiles(id).catch(() => [])
    for (const f of items) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      if (
        f.mimeType === "image/jpeg" ||
        f.mimeType === "image/png" ||
        f.mimeType === "image/webp"
      ) {
        all.push(f)
      } else if (f.mimeType === "application/vnd.google-apps.folder") {
        await walk(f.id, depth + 1)
      }
    }
  }
  await walk(folderId, 0)

  subfolderCache.set(cacheKey, { fetchedAt: Date.now(), files: all })
  return all
}

/** Pick a random image from the matching subfolder, with a light bias
 *  toward the 20 most recently modified files (auto-promote-on-push
 *  pushes winners there, so newer = battle-tested). */
function pickRandomRecent(
  files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string }>,
): { id: string; name: string; mimeType: string } | null {
  if (files.length === 0) return null
  const sorted = [...files].sort(
    (a, b) =>
      new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime(),
  )
  const pool = sorted.slice(0, Math.min(20, sorted.length))
  const idx = Math.floor(Math.random() * pool.length)
  return pool[idx]
}

export type InspirationRef = {
  bytes: Buffer
  mimeType: "image/jpeg" | "image/png"
  subfolderName: string
  fileName: string
}

/**
 * Fetch one inspiration reference image for the given slot style.
 * Returns null when:
 *  - the inspiration root isn't configured
 *  - the matching subfolder doesn't exist
 *  - the subfolder is empty
 *  - Drive throws
 *
 * Calling code MUST handle null and fall back to its existing reference
 * pool - the visual library is an enhancement, not a requirement.
 */
export async function fetchInspirationRefForStyle(
  style: SlotStyle,
): Promise<InspirationRef | null> {
  const rootId = await getInspirationFolderId()
  if (!rootId) return null

  try {
    const subfolders = await listInspirationSubfolders(rootId)
    if (subfolders.length === 0) return null

    const target = findSubfolderByName(subfolders, SUBFOLDER_BY_STYLE[style])
    if (!target) return null

    const images = await listImagesUnderFolder(target.id)
    const picked = pickRandomRecent(images)
    if (!picked) return null

    const bytes = await downloadDriveFileBytes(picked.id)
    if (!bytes) return null

    const mimeType: "image/jpeg" | "image/png" = picked.mimeType.includes("png")
      ? "image/png"
      : "image/jpeg"
    return {
      bytes,
      mimeType,
      subfolderName: target.name,
      fileName: picked.name,
    }
  } catch (e) {
    console.error(
      "[pedro/visual-reference-library] fetchInspirationRefForStyle failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }
}
