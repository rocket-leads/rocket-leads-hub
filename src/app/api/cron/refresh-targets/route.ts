import { NextRequest, NextResponse } from "next/server"
import { format, subDays, startOfMonth, subMonths } from "date-fns"
import { writeCache } from "@/lib/cache"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import {
  fetchMondayTargets,
  fetchMetaTargets,
  fetchFinance,
  fetchCosts,
  fetchDelivery,
  getMtdRange,
} from "@/lib/targets/fetchers"

// Dedicated, lightweight warmer for the Targets dashboard caches. The big
// `refresh-cache` cron also warms these, but it runs once a day and reliably
// bumps its 5-min budget on the KPI batch loop before it gets here - leaving
// the Targets MTD cache stale or unwritten, which forced every dashboard load
// into the slow (~minutes) live board fetch. Running this on its own frequent
// schedule keeps MTD warm so the page paints instantly. Roy 2026-07-23.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const mtd = getMtdRange()
  const monthStart = `${mtd.year}-${String(mtd.month).padStart(2, "0")}-01`
  const lastDay = new Date(mtd.year, mtd.month, 0).getDate()
  const monthEnd = `${mtd.year}-${String(mtd.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

  const results = await Promise.allSettled([
    fetchMondayTargets(mtd.startDate, mtd.endDate),
    fetchMetaTargets(mtd.startDate, mtd.endDate),
    fetchFinance(monthStart, monthEnd),
    fetchCosts(mtd.year, mtd.month),
    fetchDelivery(mtd.startDate, mtd.endDate),
  ])
  const [mondayResult, metaResult, financeResult, costsResult, deliveryResult] = results

  const writes: Array<Promise<void>> = []
  const status: Record<string, string> = {}

  if (mondayResult.status === "fulfilled") {
    writes.push(writeCache("targets_marketing_monday", mondayResult.value))
    status.monday = "ok"
  } else {
    console.error("[refresh-targets] monday failed:", mondayResult.reason)
    status.monday = "failed"
  }

  if (metaResult.status === "fulfilled") {
    // Same zero-guard as refresh-cache: Meta occasionally returns an all-zero
    // payload on a transient hiccup. Don't poison the warm cache with €0 spend
    // everywhere - keep the previous value and flag it.
    const total = metaResult.value.all
    const hasSignal = (total?.spend ?? 0) > 0 || (total?.impressions ?? 0) > 0 || (total?.clicks ?? 0) > 0
    if (hasSignal) {
      writes.push(writeCache("targets_marketing_meta", metaResult.value))
      status.meta = "ok"
    } else {
      console.warn("[refresh-targets] meta empty (spend/impressions/clicks all 0) - keeping previous cache")
      status.meta = "empty-skipped"
    }
  } else {
    console.error("[refresh-targets] meta failed:", metaResult.reason)
    status.meta = "failed"
  }

  if (financeResult.status === "fulfilled") {
    writes.push(writeCache("targets_finance", financeResult.value))
    status.finance = "ok"
  } else {
    console.error("[refresh-targets] finance failed:", financeResult.reason)
    status.finance = "failed"
  }

  if (costsResult.status === "fulfilled") {
    writes.push(writeCache("targets_costs", costsResult.value))
    status.costs = "ok"
  } else {
    console.error("[refresh-targets] costs failed:", costsResult.reason)
    status.costs = "failed"
  }

  if (deliveryResult.status === "fulfilled") {
    writes.push(writeCache("targets_delivery_v3", deliveryResult.value))
    status.delivery = "ok"
  } else {
    console.error("[refresh-targets] delivery failed:", deliveryResult.reason)
    status.delivery = "failed"
  }

  // Warm the rolling-window presets (Last 7/14/30 Days, Last 3 Months) so the
  // dashboard's default range and preset switches hit the warm per-range cache
  // (`targets_monday:START:END`) instead of paying the cold board fetch. The
  // board items are already cached in-process from the MTD fetch above, so each
  // preset only re-aggregates (+ its own Stripe cross-check). Ranges + date
  // formatting mirror use-date-range.ts exactly so the keys line up with what
  // the client sends. All end at yesterday (source data is complete to yesterday).
  const fmt = (d: Date) => format(d, "yyyy-MM-dd")
  const now = new Date()
  const yesterday = fmt(subDays(now, 1))
  const presetRanges: Array<{ label: string; start: string; end: string }> = [
    { label: "l7d", start: fmt(subDays(now, 7)), end: yesterday },
    { label: "l14d", start: fmt(subDays(now, 14)), end: yesterday },
    { label: "l30d", start: fmt(subDays(now, 30)), end: yesterday },
    { label: "l3m", start: fmt(startOfMonth(subMonths(now, 2))), end: yesterday },
  ]
  const presetResults = await Promise.allSettled(
    presetRanges.map((r) => fetchMondayTargets(r.start, r.end)),
  )
  presetResults.forEach((res, i) => {
    const r = presetRanges[i]
    if (res.status === "fulfilled") {
      writes.push(writeCache(`targets_monday:${r.start}:${r.end}`, res.value))
      status[`preset_${r.label}`] = "ok"
    } else {
      console.error(`[refresh-targets] preset ${r.label} failed:`, res.reason)
      status[`preset_${r.label}`] = "failed"
    }
  })

  await Promise.all(writes)
  return NextResponse.json({ ok: true, status })
}
