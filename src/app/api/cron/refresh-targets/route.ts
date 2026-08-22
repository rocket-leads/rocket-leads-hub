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
  fetchGoogleAdsSpend,
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

  // Flush the MTD writes NOW, before the (slower) preset warming below. Otherwise
  // a preset fetch that runs long could push the function past maxDuration and the
  // MTD writes - queued after it - would never land, breaking the thing this cron
  // exists to guarantee. Presets are a best-effort bonus on top of a warm MTD.
  await Promise.all(writes)

  // Warm the rolling-window presets (Last 7/14/30 Days, Last 3 Months) so the
  // dashboard's default range and preset switches hit the warm per-range caches
  // instead of paying a cold live fetch. We warm ALL THREE data sources per
  // preset - Monday (`targets_monday:START:END`), Meta (`targets_meta:START:END`)
  // and Google Ads (`targets_google_ads:START:END`) - because the Marketing/Sales
  // tabs read all three and a cold Meta hit was the main reason a preset switch
  // (esp. the L7D default) lagged even though Monday painted instantly. Monday's
  // board items are already cached in-process from the MTD fetch above, so its
  // preset fetch only re-aggregates; Meta + Google are independent API/sheet reads.
  // Ranges + date formatting mirror use-date-range.ts exactly so the keys line up
  // with what the client sends. All end at yesterday (source data complete to then).
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

  // Meta presets - apply the same all-zero guard as the MTD write so a transient
  // empty payload never poisons a preset cache.
  const metaPresetResults = await Promise.allSettled(
    presetRanges.map((r) => fetchMetaTargets(r.start, r.end)),
  )
  metaPresetResults.forEach((res, i) => {
    const r = presetRanges[i]
    if (res.status === "fulfilled") {
      const total = res.value.all
      const hasSignal = (total?.spend ?? 0) > 0 || (total?.impressions ?? 0) > 0 || (total?.clicks ?? 0) > 0
      if (hasSignal) {
        writes.push(writeCache(`targets_meta:${r.start}:${r.end}`, res.value))
        status[`preset_meta_${r.label}`] = "ok"
      } else {
        status[`preset_meta_${r.label}`] = "empty-skipped"
      }
    } else {
      console.error(`[refresh-targets] preset meta ${r.label} failed:`, res.reason)
      status[`preset_meta_${r.label}`] = "failed"
    }
  })

  // Google Ads presets - fetchGoogleAdsSpend never throws; skip caching a read
  // that carries an error so a range doesn't show €0 for the whole TTL.
  const googlePresetResults = await Promise.allSettled(
    presetRanges.map((r) => fetchGoogleAdsSpend(r.start, r.end)),
  )
  googlePresetResults.forEach((res, i) => {
    const r = presetRanges[i]
    if (res.status === "fulfilled" && !res.value.error) {
      writes.push(writeCache(`targets_google_ads:${r.start}:${r.end}`, res.value))
      status[`preset_google_${r.label}`] = "ok"
    } else {
      status[`preset_google_${r.label}`] = res.status === "fulfilled" ? "error-skipped" : "failed"
    }
  })

  await Promise.all(writes)
  return NextResponse.json({ ok: true, status })
}
