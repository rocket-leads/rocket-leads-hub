import { differenceInDays, startOfMonth, getDaysInMonth, max } from "date-fns"
import type { MondayTargetsData, MetaTargetsData, KpiGroup, DateRange, TargetsConfig } from "@/types/targets"
import { formatCurrency, formatCurrencyDecimal, formatNumber, formatPercent, formatMultiplier, safeDivide } from "./formatters"

export function getEffectiveDays(range: DateRange): number {
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = max([range.startDate, refMonthStart])
  return differenceInDays(range.endDate, effectiveStart) + 1
}

function getProRataTarget(monthlyTarget: number, range: DateRange): number {
  const days = getEffectiveDays(range)
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

/**
 * Derive volume and ratio targets from the Settings inputs.
 *
 * Inputs (from Settings - Marketing/Sales): deals, revenue, cpOptIn, cbc, ctc, cpd.
 * Everything below is derived.
 *
 *   target ad spend  = deals × cpd
 *   target opt-ins   = ad spend / cpOptIn
 *   target booked    = ad spend / cbc
 *   target taken     = ad spend / ctc
 *   booking rate     = cpOptIn / cbc          (Booked / Opt-ins)
 *   show-up rate     = cbc / ctc              (Taken / Booked)
 *   conversion rate  = ctc / cpd              (Deals / Taken)
 *   roas             = revenue / ad spend
 *
 * 2026-05-27: qualification stage removed from the funnel - Booked → Taken
 * directly. `cqc` and `qualRate` are no longer part of TargetsConfig /
 * DerivedTargets, and `showUpRate` is now `cbc / ctc` instead of `cqc / ctc`.
 */
export interface DerivedTargets {
  adSpend: number
  /** Opt-ins volume target = adSpend / cpOptIn. */
  optIns: number
  calls: number
  takenCalls: number
  /** Min appointment booking rate (booked / opt-ins) - derived as
   *  cpOptIn / cbc. E.g. €5 opt-in × €25 booked → 20% target rate. */
  bookingRate: number
  /** Min show-up rate (taken / booked) - derived as cbc / ctc. */
  showUpRate: number
  convRate: number
  roas: number
}

export function deriveTargets(t: TargetsConfig | null | undefined): DerivedTargets {
  if (!t) {
    return { adSpend: 0, optIns: 0, calls: 0, takenCalls: 0, bookingRate: 0, showUpRate: 0, convRate: 0, roas: 0 }
  }
  const adSpend = t.deals > 0 && t.cpd > 0 ? t.deals * t.cpd : 0
  const optIns = adSpend > 0 && t.cpOptIn > 0 ? adSpend / t.cpOptIn : 0
  const calls = adSpend > 0 && t.cbc > 0 ? adSpend / t.cbc : 0
  const takenCalls = adSpend > 0 && t.ctc > 0 ? adSpend / t.ctc : 0
  const bookingRate = t.cpOptIn > 0 && t.cbc > 0 ? t.cpOptIn / t.cbc : 0
  const showUpRate = t.cbc > 0 && t.ctc > 0 ? t.cbc / t.ctc : 0
  const convRate = t.ctc > 0 && t.cpd > 0 ? t.ctc / t.cpd : 0
  const roas = t.revenue > 0 && adSpend > 0 ? t.revenue / adSpend : 0
  return { adSpend, optIns, calls, takenCalls, bookingRate, showUpRate, convRate, roas }
}

export function calculateKpiGroups(
  monday: MondayTargetsData | null,
  meta: MetaTargetsData | null,
  range: DateRange,
  mondayLoading: boolean,
  metaLoading: boolean,
  mondayError: string | null,
  metaError: string | null,
  targets?: TargetsConfig | null,
): KpiGroup[] {
  const spend = meta?.spend ?? 0
  const leads = monday?.leads ?? 0
  const calls = monday?.calls ?? 0
  const takenCalls = monday?.takenCalls ?? 0
  const deals = monday?.deals ?? 0
  const closedRevenue = monday?.closedRevenue ?? 0
  // Collected (actually-paid) revenue is the primary Revenue + ROAS figure;
  // closedRevenue (total contract value) rides along as a secondary reference.
  const collectedRevenue = monday?.collectedRevenue ?? 0

  const t = targets ?? null
  const derived = deriveTargets(t)

  // Volume targets are derived (calls/taken) - only deals & revenue come straight from Settings.
  const prCalls = derived.calls > 0 ? Math.round(getProRataTarget(derived.calls, range)) : undefined
  const prTaken = derived.takenCalls > 0 ? Math.round(getProRataTarget(derived.takenCalls, range)) : undefined
  const prDeals = t && t.deals > 0 ? Math.round(getProRataTarget(t.deals, range)) : undefined
  const prRevenue = t && t.revenue > 0 ? Math.round(getProRataTarget(t.revenue, range)) : undefined

  // Ratio targets derived from the cost ladder (cbc / ctc / cpd)
  const showUpRateTarget = derived.showUpRate > 0 ? derived.showUpRate : undefined
  const convRateTarget = derived.convRate > 0 ? derived.convRate : undefined
  const roasTarget = derived.roas > 0 ? derived.roas : undefined

  return [
    {
      title: "Volume",
      kpis: [
        {
          label: "Booked Calls",
          value: calls,
          formatted: formatNumber(calls),
          target: prCalls,
          targetFormatted: prCalls != null ? `${formatNumber(calls)} of ${formatNumber(prCalls)}` : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Taken Calls",
          value: takenCalls,
          formatted: formatNumber(takenCalls),
          target: prTaken,
          targetFormatted: prTaken != null ? `${formatNumber(takenCalls)} of ${formatNumber(prTaken)}` : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Deals",
          value: deals,
          formatted: formatNumber(deals),
          target: prDeals,
          targetFormatted: prDeals != null ? `${formatNumber(deals)} of ${formatNumber(prDeals)}` : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Revenue",
          value: collectedRevenue,
          formatted: formatCurrency(collectedRevenue),
          target: prRevenue,
          targetFormatted:
            prRevenue != null
              ? `${formatCurrency(collectedRevenue)} of ${formatCurrency(prRevenue)} · closed ${formatCurrency(closedRevenue)}`
              : `closed ${formatCurrency(closedRevenue)}`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
      ],
    },
    {
      title: "Costs",
      kpis: [
        {
          label: "Ad Spend",
          value: spend,
          formatted: formatCurrencyDecimal(spend),
          variant: "neutral",
          isLoading: metaLoading,
          error: metaError,
        },
        {
          label: "CPL",
          value: safeDivide(spend, leads),
          formatted: formatCurrencyDecimal(safeDivide(spend, leads)),
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CBC",
          value: safeDivide(spend, calls),
          formatted: formatCurrencyDecimal(safeDivide(spend, calls)),
          target: t?.cbc,
          targetFormatted: t ? `${formatCurrencyDecimal(safeDivide(spend, calls))} of ${formatCurrencyDecimal(t.cbc)}` : undefined,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CTC",
          value: safeDivide(spend, takenCalls),
          formatted: formatCurrencyDecimal(safeDivide(spend, takenCalls)),
          target: t?.ctc,
          targetFormatted: t ? `${formatCurrencyDecimal(safeDivide(spend, takenCalls))} of ${formatCurrencyDecimal(t.ctc)}` : undefined,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CPD",
          value: safeDivide(spend, deals),
          formatted: formatCurrencyDecimal(safeDivide(spend, deals)),
          target: t?.cpd,
          targetFormatted: t ? `${formatCurrencyDecimal(safeDivide(spend, deals))} of ${formatCurrencyDecimal(t.cpd)}` : undefined,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
      ],
    },
    {
      title: "Ratios",
      kpis: [
        {
          // Show-up rate is now Taken / Booked (was Taken / Qualified). The
          // booked-call denominator excludes nothing - Planned/Qualified
          // still-open items get counted as taken by the fetcher when their
          // appointment date is past, so the rate isn't gamed by closers
          // skipping the status update.
          label: "Show-up Rate",
          value: safeDivide(takenCalls, calls),
          formatted: formatPercent(safeDivide(takenCalls, calls)),
          target: showUpRateTarget,
          targetFormatted: showUpRateTarget != null
            ? `${formatPercent(safeDivide(takenCalls, calls))} of ${formatPercent(showUpRateTarget)}`
            : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Conversion Rate",
          value: safeDivide(deals, takenCalls),
          formatted: formatPercent(safeDivide(deals, takenCalls)),
          target: convRateTarget,
          targetFormatted: convRateTarget != null
            ? `${formatPercent(safeDivide(deals, takenCalls))} of ${formatPercent(convRateTarget)}`
            : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "ROAS",
          value: safeDivide(collectedRevenue, spend),
          formatted: formatMultiplier(safeDivide(collectedRevenue, spend)),
          target: roasTarget,
          targetFormatted: roasTarget != null
            ? `${formatMultiplier(safeDivide(collectedRevenue, spend))} of ${formatMultiplier(roasTarget)} · closed ${formatMultiplier(safeDivide(closedRevenue, spend))}`
            : `closed ${formatMultiplier(safeDivide(closedRevenue, spend))}`,
          variant: "volume",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
      ],
    },
  ]
}

export function getRevenueProgress(
  closedRevenue: number,
  range: DateRange,
  targets?: TargetsConfig | null,
): { current: number; proRata: number; monthlyTarget: number; pct: number } {
  const monthlyTarget = targets?.revenue ?? 0
  const proRata = monthlyTarget > 0 ? getProRataTarget(monthlyTarget, range) : 0
  return {
    current: closedRevenue,
    proRata,
    monthlyTarget,
    pct: safeDivide(closedRevenue, proRata),
  }
}
