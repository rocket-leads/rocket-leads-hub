import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

/**
 * Pexels stock-photo integration.
 *
 * Auth: API key stored encrypted in `api_tokens` (service="pexels").
 * Free tier limits: 200 requests/h, 20k/month - plenty for Pedro's
 * ~3 search calls per refresh.
 *
 * Why Pexels not Unsplash: Pexels has no UTM-attribution requirement
 * and a permissive license that allows generated derivative ads. The
 * photographer credit is appended to Pedro's "References used" UI but
 * not required on the ad itself.
 *
 * Pedro 2026-06-10 design: when `useStock=true` voor een klant, vullen
 * we Drive-resultaten aan met Pexels candidates. Vision-rerank dezelfde
 * Haiku pipeline kiest de top kandidaten. Resultaat: voor klanten met
 * een dunne Drive (of waar de Drive vooral logo's en screenshots
 * bevat) krijgt Pedro alsnog échte foto's als reference.
 *
 * Roy 2026-06-10.
 */

const PEXELS_API_BASE = "https://api.pexels.com/v1"

async function getApiKey(): Promise<string | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("api_tokens")
      .select("token_encrypted")
      .eq("service", "pexels")
      .maybeSingle()
    if (!data) return null
    return decrypt(data.token_encrypted)
  } catch {
    return null
  }
}

export type PexelsPhoto = {
  /** Unique Pexels photo id (stable across sessions - usable as cache key
   *  for the vision-relevance description, identical to Drive file_id). */
  id: string
  /** Display name we synthesize from photographer + alt text - keeps the
   *  rest of the reference pipeline (which expects a `name` field)
   *  source-agnostic. */
  name: string
  /** Photographer credit. Surfaced in the "References used" UI so the
   *  CM can attribute when shipping. */
  photographer: string
  /** Pexels page URL - usable as canonical link if we ever surface it. */
  pageUrl: string
  /** Source URL we actually downloaded (large size, JPEG). Kept for
   *  debug / caching. */
  sourceUrl: string
  mimeType: "image/jpeg" | "image/png"
  bytes: Buffer
}

/**
 * Search Pexels for photos relevant to the given query. Returns up to
 * `limit` results, downloaded as Buffers so callers can plug them into
 * the same reference pipeline as Drive photos.
 *
 * Failure modes:
 *  - No API key configured → empty array (logged, not thrown).
 *  - Pexels API down or rate-limited → empty array.
 *  - Individual photo download fail → skip + continue.
 *
 * Caller decides what to do with an empty result (typically: just rely
 * on the other source - Drive or AI prompt-only).
 */
export async function searchPexelsPhotos(
  query: string,
  limit = 4,
): Promise<PexelsPhoto[]> {
  const q = query.trim()
  if (!q) return []

  const apiKey = await getApiKey()
  if (!apiKey) {
    console.error("[pexels] No API key configured (Settings → API Tokens → service=pexels)")
    return []
  }

  // Pexels search - `per_page` is what we want; their API also supports
  // orientation + size filters but we keep it broad for now.
  const url = `${PEXELS_API_BASE}/search?query=${encodeURIComponent(q)}&per_page=${Math.max(1, Math.min(20, limit * 2))}&size=large`
  let json: {
    photos?: Array<{
      id?: number
      alt?: string
      photographer?: string
      url?: string
      src?: {
        large?: string
        large2x?: string
        medium?: string
        original?: string
      }
    }>
  } = {}
  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      next: { revalidate: 3600 },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[pexels] search ${res.status}: ${text.slice(0, 200)}`)
      return []
    }
    json = await res.json()
  } catch (e) {
    console.error("[pexels] search fail:", e instanceof Error ? e.message : e)
    return []
  }

  const photos = json.photos ?? []
  const results: PexelsPhoto[] = []
  for (const p of photos) {
    if (results.length >= limit) break
    const photoId = p.id ? String(p.id) : null
    // Prefer `large` (~940px) - big enough for Gemini reference but
    // small enough to stay under the 4MB-per-image cap.
    const sourceUrl = p.src?.large ?? p.src?.large2x ?? p.src?.medium ?? p.src?.original
    if (!photoId || !sourceUrl) continue

    try {
      const dl = await fetch(sourceUrl)
      if (!dl.ok) continue
      const buf = Buffer.from(await dl.arrayBuffer())
      if (buf.length < 10 * 1024 || buf.length > 8 * 1024 * 1024) continue
      const ct = dl.headers.get("content-type") ?? ""
      const mimeType: "image/jpeg" | "image/png" = ct.includes("png")
        ? "image/png"
        : "image/jpeg"
      const altText = (p.alt ?? "").replace(/\s+/g, " ").trim()
      const photographer = (p.photographer ?? "Pexels").trim()
      const displayName = altText
        ? `${altText} (Pexels - ${photographer})`
        : `Pexels stock - ${photographer}`
      results.push({
        id: `pexels:${photoId}`,
        name: displayName.slice(0, 160),
        photographer,
        pageUrl: p.url ?? `https://www.pexels.com/photo/${photoId}/`,
        sourceUrl,
        mimeType,
        bytes: buf,
      })
    } catch (e) {
      console.error(
        `[pexels] photo ${photoId} download fail (skipping):`,
        e instanceof Error ? e.message : e,
      )
    }
  }
  return results
}

/**
 * Derive Pexels search queries from variant + campaign context.
 *
 * Strategy: campaign name + topic label first (most specific), then
 * sector keywords if we have a brief, then a broad fallback. Dedupe
 * but preserve order so the most-specific query runs first.
 *
 * Example for Zumex / "Gast vraag" variant:
 *   1. "verse sappen horeca"        ← topic + sector
 *   2. "sappenautomaat restaurant"  ← campaign + sector
 *   3. "horeca eigenaar"            ← fallback persona
 */
export function deriveStockQueries(args: {
  campaignName?: string | null
  topicLabel?: string | null
  sector?: string | null
  /** Optional client positioning short string ("verse sappen voor horeca")
   *  derived elsewhere - when present, it's the strongest signal. */
  positioning?: string | null
}): string[] {
  const queries: string[] = []
  const seen = new Set<string>()
  const push = (q: string | null | undefined) => {
    if (!q) return
    const norm = q.toLowerCase().replace(/\s+/g, " ").trim()
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    queries.push(q.replace(/\s+/g, " ").trim())
  }

  if (args.positioning) push(args.positioning)
  if (args.topicLabel && args.sector) push(`${args.topicLabel} ${args.sector}`)
  if (args.topicLabel) push(args.topicLabel)
  if (args.campaignName && args.sector) push(`${args.campaignName} ${args.sector}`)
  if (args.sector) push(args.sector)

  return queries.slice(0, 3)
}
