import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache } from "@/lib/cache"
import { fetchDelivery, getMtdRange } from "@/lib/targets/fetchers"
import type { DeliveryOverview } from "@/types/targets"

/**
 * Treats a cache entry as valid only when it has every field the current UI consumes.
 * Bumping the field list here forces a re-fetch on cached entries that predate the new
 * fields — without this guard, stale caches silently render 0/undefined.
 */
const REQUIRED_DELIVERY_FIELDS = ["adBudget", "newClients", "byTeam", "serviceFeePerCustomer"] as const

function isFreshDeliveryShape(cached: unknown): boolean {
  if (cached === null || typeof cached !== "object") return false
  return REQUIRED_DELIVERY_FIELDS.every((field) => field in (cached as object))
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

  // Cache hit only for MTD
  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate && !forceRefresh) {
    const cached = await readCache<DeliveryOverview>("targets_delivery_v2")
    // Reject any cache entry that predates a UI-required field — otherwise stale caches
    // render 0/undefined for newly-added KPIs (e.g. newClients, byTeam) until cron refreshes.
    if (isFreshDeliveryShape(cached)) {
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
        "targets_delivery_v2",
        periodMonth.year,
        periodMonth.month,
        () => fetchDelivery(startDate, endDate),
        {
          forceRefresh,
          validate: isFreshDeliveryShape,
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
