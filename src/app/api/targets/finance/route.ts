import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { cachedHistoricalMonth, getRangeCalendarMonth, isPastCalendarMonth, readCache } from "@/lib/cache"
import { fetchFinance } from "@/lib/targets/fetchers"
import type { FinanceOverview } from "@/types/targets"

function isCurrentCalendarMonth(startDate: string, endDate: string): boolean {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const start = `${year}-${String(month).padStart(2, "0")}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
  return startDate === start && endDate === end
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

  // Cache hit only for current calendar month
  // Skip cache if it doesn't have credit_old support (stale from before same-month/cross-month fix)
  if (isCurrentCalendarMonth(startDate, endDate) && !forceRefresh) {
    const cached = await readCache<FinanceOverview>("targets_finance")
    const hasLatestCreditLogic = cached?.details?.some((d) => d.status === "credit_prev" || d.status === "credit_old") ?? false
    const hasAnyCredits = cached?.details?.some((d) => d.status.startsWith("credit")) ?? false
    if (cached && cached.details && (hasLatestCreditLogic || !hasAnyCredits)) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Historical month: cache forever in cache_store under `targets_finance:YYYY-MM`
  const periodMonth = getRangeCalendarMonth(startDate, endDate)
  if (periodMonth && isPastCalendarMonth(periodMonth.year, periodMonth.month)) {
    try {
      const result = await cachedHistoricalMonth(
        "targets_finance",
        periodMonth.year,
        periodMonth.month,
        () => fetchFinance(startDate, endDate),
        { forceRefresh },
      )
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=3600, stale-while-revalidate=86400" },
      })
    } catch (error) {
      console.error("[targets/finance]", error)
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
    }
  }

  try {
    const result = await fetchFinance(startDate, endDate)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/finance]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
