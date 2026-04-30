import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache } from "@/lib/cache"
import { fetchDelivery, getMtdRange } from "@/lib/targets/fetchers"
import type { DeliveryOverview } from "@/types/targets"

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

  // Cache hit only for MTD
  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate && !forceRefresh) {
    const cached = await readCache<DeliveryOverview>("targets_delivery")
    // Reject pre-split-shape cache entries so the user sees fee/ad-budget split immediately
    // instead of waiting for the next cron pass to overwrite this key.
    if (cached && "adBudget" in (cached as object)) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_delivery:YYYY-MM`
  const periodMonth = getRangeCalendarMonth(startDate, endDate)
  if (periodMonth && isPastCalendarMonth(periodMonth.year, periodMonth.month)) {
    try {
      const result = await cachedHistoricalMonth(
        "targets_delivery",
        periodMonth.year,
        periodMonth.month,
        () => fetchDelivery(startDate, endDate),
        {
          forceRefresh,
          // Old cache entries from before the fee/ad-budget split lack `adBudget`.
          // Treat those as a miss so they get refreshed with the new shape.
          validate: (c) => c !== null && typeof c === "object" && "adBudget" in (c as object),
        },
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=86400" },
      })
    } catch (error) {
      console.error("[targets/delivery]", error)
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
    }
  }

  try {
    const result = await fetchDelivery(startDate, endDate)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/delivery]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
