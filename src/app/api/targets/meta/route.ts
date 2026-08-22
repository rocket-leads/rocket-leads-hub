import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache, writeCache } from "@/lib/cache"
import { fetchMetaTargets, getMtdRange } from "@/lib/targets/fetchers"
import type { MetaTargetsByCountry } from "@/types/targets"

// Match the Monday targets route: allow the full Pro budget so a cold fetch
// completes instead of 504-ing into blank cards.
export const maxDuration = 300

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

  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate && !forceRefresh) {
    const cached = await readCache<MetaTargetsByCountry>("targets_marketing_meta")
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_meta:YYYY-MM`
  const periodMonth = getRangeCalendarMonth(startDate, endDate)
  if (periodMonth && isPastCalendarMonth(periodMonth.year, periodMonth.month)) {
    try {
      const result = await cachedHistoricalMonth(
        "targets_meta",
        periodMonth.year,
        periodMonth.month,
        () => fetchMetaTargets(startDate, endDate),
        { forceRefresh },
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=86400" },
      })
    } catch (error) {
      console.error("[targets/meta]", error)
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
    }
  }

  // Arbitrary current-period ranges (Last 7/14/30 Days, Last 3 Months, ad-hoc
  // custom ranges) miss both the MTD warm cache and the historical-month cache
  // above. Before this, every such load paid a live Meta Graph API pagination -
  // and since the Hub's DEFAULT range is Last 7 Days, that meant a live Meta hit
  // on nearly every cold page load while Monday (cron-warmed) painted instantly.
  // A keyed per-range cache mirrors what the Monday route already does so preset
  // switches and repeat loads of the same window are instant. The rolling presets
  // are additionally cron-warmed by `refresh-targets`, so a read there is always
  // ≤30min old. TTL 6h matches Monday: ranges end at yesterday (complete data),
  // and the refresh button (?refresh=1) forces a recompute when data moves.
  const rangeCacheKey = `targets_meta:${startDate}:${endDate}`
  const RANGE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
  if (!forceRefresh) {
    const cached = await readCache<MetaTargetsByCountry>(rangeCacheKey, RANGE_CACHE_TTL_MS)
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  try {
    const result = await fetchMetaTargets(startDate, endDate)
    // Warm the per-range cache so subsequent loads of the same window are instant.
    // Guard against a transient all-zero payload poisoning the cache (same guard
    // the cron applies): only cache when there's real signal.
    const total = result.all
    const hasSignal = (total?.spend ?? 0) > 0 || (total?.impressions ?? 0) > 0 || (total?.clicks ?? 0) > 0
    if (hasSignal) void writeCache(rangeCacheKey, result)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/meta]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
