import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, isPastCalendarMonth, readCache } from "@/lib/cache"
import { fetchCosts } from "@/lib/targets/fetchers"
import type { CostData } from "@/types/targets"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const yearStr = searchParams.get("year")
  const monthStr = searchParams.get("month")
  const forceRefresh = searchParams.get("refresh") === "1"

  if (!yearStr || !monthStr) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 })
  }

  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)

  // Cache hit for current calendar month
  const now = new Date()
  if (year === now.getFullYear() && month === now.getMonth() + 1 && !forceRefresh) {
    const cached = await readCache<CostData>("targets_costs")
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_costs:YYYY-MM`
  if (isPastCalendarMonth(year, month)) {
    try {
      const result = await cachedHistoricalMonth(
        "targets_costs",
        year,
        month,
        () => fetchCosts(year, month),
        { forceRefresh },
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=86400" },
      })
    } catch (error) {
      console.error("[targets/costs]", error)
      return NextResponse.json({ error: error instanceof Error ? error.message : "Costs error" }, { status: 500 })
    }
  }

  try {
    const result = await fetchCosts(year, month)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/costs]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Costs error" }, { status: 500 })
  }
}
