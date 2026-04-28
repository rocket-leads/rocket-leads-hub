import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache, writeCache } from "@/lib/cache"
import { fetchMondayTargets, getMtdRange } from "@/lib/targets/fetchers"
import type { MondayTargetsByCountry } from "@/types/targets"

// Cached entries from before the closers shape existed (qualifiedCalls / upcomingCalls /
// notUpdated) are stale. Also detect the old takenCalls semantic — after the recent
// change Not Updated is folded into Taken, so a closer with notUpdated > 0 must have
// takenCalls >= notUpdated. Old caches violate that invariant.
function hasFreshSchema(cached: MondayTargetsByCountry | null): boolean {
  const closers = cached?.all?.closers
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

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate && !forceRefresh) {
    const cached = await readCache<MondayTargetsByCountry>("targets_marketing_monday")
    if (cached && hasFreshSchema(cached)) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_monday:YYYY-MM`
  const periodMonth = getRangeCalendarMonth(startDate, endDate)
  if (periodMonth && isPastCalendarMonth(periodMonth.year, periodMonth.month)) {
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

  try {
    const result = await fetchMondayTargets(startDate, endDate)
    // Refresh the cron cache when this is the current MTD range, so the next
    // request hits warm cache instead of paying for another live fetch.
    if (startDate === mtd.startDate && endDate === mtd.endDate) {
      void writeCache("targets_marketing_monday", result)
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/monday]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
