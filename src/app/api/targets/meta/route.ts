import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache } from "@/lib/cache"
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

  try {
    const result = await fetchMetaTargets(startDate, endDate)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/meta]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
