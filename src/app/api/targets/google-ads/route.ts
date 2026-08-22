import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readCache, writeCache } from "@/lib/cache"
import { fetchGoogleAdsSpend } from "@/lib/targets/fetchers"
import type { GoogleAdsSpend } from "@/types/targets"

// Google Ads spend comes from a Google Sheet (Actual tab). A single sheet read
// is fast, but it's still a network round-trip on every range switch, so mirror
// the Meta/Monday routes with a keyed per-range cache to make repeat loads and
// preset switches instant. fetchGoogleAdsSpend never throws (it returns
// { spend: 0, error } on failure) so the Marketing tab degrades to Meta-only
// spend if the sheet isn't shared with the service account yet.
export const maxDuration = 60

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const forceRefresh = searchParams.get("refresh") === "1"

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  const rangeCacheKey = `targets_google_ads:${startDate}:${endDate}`
  const RANGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
  if (!forceRefresh) {
    const cached = await readCache<GoogleAdsSpend>(rangeCacheKey, RANGE_CACHE_TTL_MS)
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  const result = await fetchGoogleAdsSpend(startDate, endDate)
  // Only cache clean reads - a sheet-read error returns { spend: 0, error } and
  // must not be persisted, or the range would show €0 for the rest of the TTL.
  if (!result.error) void writeCache(rangeCacheKey, result)
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
  })
}
