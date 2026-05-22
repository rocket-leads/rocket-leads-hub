import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache, writeCache } from "@/lib/cache"
import { fetchMondayTargets, getMtdRange, invalidateTargetsBoardItems } from "@/lib/targets/fetchers"
import type { MondayTargetsByCountry } from "@/types/targets"

// Cached entries from before the closers shape existed (qualifiedCalls / upcomingCalls /
// notUpdated) are stale. Also detect the old takenCalls semantic — after the recent
// change Not Updated is folded into Taken, so a closer with notUpdated > 0 must have
// takenCalls >= notUpdated. Old caches violate that invariant.
//
// Also requires the Stripe-cross-check fields (`stripeNewBusinessRevenue` and
// `closedDeals`). Earlier code briefly overwrote `closedRevenue` with the Stripe
// service-fee total — those caches still exist and silently mis-render the bar.
// Requiring the new fields forces a fresh fetch with the corrected logic.
function hasFreshSchema(cached: MondayTargetsByCountry | null): boolean {
  if (!cached?.all) return false
  if (!("stripeNewBusinessRevenue" in cached.all)) return false
  if (!Array.isArray(cached.all.closedDeals)) return false

  const closers = cached.all.closers
  if (!Array.isArray(closers)) return false
  if (closers.length === 0) return true
  const first = closers[0]
  const hasFields =
    typeof first.qualifiedCalls === "number"
    && typeof first.upcomingCalls === "number"
    && typeof first.notUpdated === "number"
  if (!hasFields) return false
  // Old takenCalls (held only) doesn't include notUpdated → invariant violation.
  return !closers.some((c) => c.notUpdated > 0 && c.takenCalls < c.notUpdated)
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  const forceRefresh = searchParams.get("refresh") === "1"
  // `closer` filter — when present the dashboard scopes top-level metrics to that
  // person. Cache is unfiltered (cron-warmed for the team), so a filtered request
  // always live-fetches; that's cheap enough since it's a power-user toggle.
  const closer = searchParams.get("closer")?.trim() || null

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  const mtd = getMtdRange()
  if (!closer && startDate === mtd.startDate && endDate === mtd.endDate && !forceRefresh) {
    const cached = await readCache<MondayTargetsByCountry>("targets_marketing_monday")
    if (cached && hasFreshSchema(cached)) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_monday:YYYY-MM`.
  // Skipped when a closer filter is active — historical cache is unfiltered.
  const periodMonth = getRangeCalendarMonth(startDate, endDate)
  if (!closer && periodMonth && isPastCalendarMonth(periodMonth.year, periodMonth.month)) {
    try {
      const result = await cachedHistoricalMonth(
        "targets_monday",
        periodMonth.year,
        periodMonth.month,
        () => fetchMondayTargets(startDate, endDate),
        { forceRefresh, validate: hasFreshSchema },
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=86400" },
      })
    } catch (error) {
      console.error("[targets/monday]", error)
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
    }
  }

  // Arbitrary current-period ranges (e.g. "Last 7 days", "1 May – 18 May") miss both
  // the MTD warm cache above and the historical-month cache. Without this, every load
  // of a custom range pays the full Monday board fetch + Stripe cross-check (~5–10s).
  // A short-TTL keyed cache makes repeat loads of the same range instant — and since
  // multiple users typically land on the same default windows, the second visitor is
  // free even when the first paid for it.
  const rangeCacheKey = `targets_monday:${startDate}:${endDate}`
  const RANGE_CACHE_TTL_MS = 5 * 60 * 1000
  if (!closer && !forceRefresh) {
    const cached = await readCache<MondayTargetsByCountry>(rangeCacheKey, RANGE_CACHE_TTL_MS)
    if (cached && hasFreshSchema(cached)) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  try {
    // Refresh button explicitly wants fresh data — bust the in-process board items
    // cache so this request re-paginates from Monday instead of reusing the items
    // a previous request warmed.
    if (forceRefresh) invalidateTargetsBoardItems()
    console.log("[targets/monday] live fetch:", { startDate, endDate, closer })
    const result = await fetchMondayTargets(startDate, endDate, closer)
    // Refresh the cron cache when this is the current MTD range, so the next
    // request hits warm cache instead of paying for another live fetch.
    // Only when no closer filter is active — the cache stores team-wide data.
    if (!closer && startDate === mtd.startDate && endDate === mtd.endDate) {
      void writeCache("targets_marketing_monday", result)
    }
    // Also warm the per-range cache so subsequent loads of the same window are instant.
    if (!closer) {
      void writeCache(rangeCacheKey, result)
    }
    // Filtered responses must not be cached at any layer — switching closers
    // cycles through them quickly and a stale slice would silently lie. The
    // unfiltered response keeps the short s-maxage so the cron-warmed cache
    // still serves bursts of dashboard loads efficiently.
    return NextResponse.json(result, {
      headers: closer
        ? { "Cache-Control": "private, no-store" }
        : { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/monday]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
