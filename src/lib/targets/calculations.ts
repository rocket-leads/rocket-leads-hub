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
 * Inputs (from Settings — Marketing/Sales): deals, revenue, cbc, cqc, ctc, cpd.
 * Everything below is derived.
 *
 *   target ad spend = deals × cpd
 *   target booked   = ad spend / cbc
 *   target qualified = ad spend / cqc
 *   target taken    = ad spend / ctc
 *   qualification rate = cbc / cqc
 *   show-up rate    = cqc / ctc
 *   conversion rate = ctc / cpd
 *   roas            = revenue / ad spend
 */
export interface DerivedTargets {
  adSpend: number
  calls: number
  qualifiedCalls: number
  takenCalls: number
  qualRate: number
  showUpRate: number
  convRate: number
  roas: number
}

export function deriveTargets(t: TargetsConfig | null | undefined): DerivedTargets {
  if (!t) {
    return { adSpend: 0, calls: 0, qualifiedCalls: 0, takenCalls: 0, qualRate: 0, showUpRate: 0, convRate: 0, roas: 0 }
  }
  const adSpend = t.deals > 0 && t.cpd > 0 ? t.deals * t.cpd : 0
  const calls = adSpend > 0 && t.cbc > 0 ? adSpend / t.cbc : 0
  const qualifiedCalls = adSpend > 0 && t.cqc > 0 ? adSpend / t.cqc : 0
  const takenCalls = adSpend > 0 && t.ctc > 0 ? adSpend / t.ctc : 0
  const qualRate = t.cbc > 0 && t.cqc > 0 ? t.cbc / t.cqc : 0
  const showUpRate = t.cqc > 0 && t.ctc > 0 ? t.cqc / t.ctc : 0
  const convRate = t.ctc > 0 && t.cpd > 0 ? t.ctc / t.cpd : 0
  const roas = t.revenue > 0 && adSpend > 0 ? t.revenue / adSpend : 0
  return { adSpend, calls, qualifiedCalls, takenCalls, qualRate, showUpRate, convRate, roas }
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
  const qualifiedCalls = monday?.qualifiedCalls ?? 0
  const takenCalls = monday?.takenCalls ?? 0
  const deals = monday?.deals ?? 0
  const closedRevenue = monday?.closedRevenue ?? 0

  const t = targets ?? null
  const derived = deriveTargets(t)

  // Volume targets are derived (calls/qualified/taken) — only deals & revenue come straight from Settings.
  const prCalls = derived.calls > 0 ? Math.round(getProRataTarget(derived.calls, range)) : undefined
  const prQualified = derived.qualifiedCalls > 0 ? Math.round(getProRataTarget(derived.qualifiedCalls, range)) : undefined
  const prTaken = derived.takenCalls > 0 ? Math.round(getProRataTarget(derived.takenCalls, range)) : undefined
  const prDeals = t && t.deals > 0 ? Math.round(getProRataTarget(t.deals, range)) : undefined
  const prRevenue = t && t.revenue > 0 ? Math.round(getProRataTarget(t.revenue, range)) : undefined

  // Ratio targets derived from the cost ladder (cbc / cqc / ctc / cpd)
  const qualRateTarget = derived.qualRate > 0 ? derived.qualRate : undefined
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
          label: "Qualified Calls",
          value: qualifiedCalls,
          formatted: formatNumber(qualifiedCalls),
          target: prQualified,
          targetFormatted: prQualified != null ? `${formatNumber(qualifiedCalls)} of ${formatNumber(prQualified)}` : undefined,
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
          value: closedRevenue,
          formatted: formatCurrency(closedRevenue),
          target: prRevenue,
          targetFormatted: prRevenue != null ? `${formatCurrency(closedRevenue)} of ${formatCurrency(prRevenue)}` : undefined,
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
          label: "CQC",
          value: safeDivide(spend, qualifiedCalls),
          formatted: formatCurrencyDecimal(safeDivide(spend, qualifiedCalls)),
          target: t?.cqc,
          targetFormatted: t ? `${formatCurrencyDecimal(safeDivide(spend, qualifiedCalls))} of ${formatCurrencyDecimal(t.cqc)}` : undefined,
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
          label: "Qualification Rate",
          value: safeDivide(qualifiedCalls, calls),
          formatted: formatPercent(safeDivide(qualifiedCalls, calls)),
          target: qualRateTarget,
          targetFormatted: qualRateTarget != null
            ? `${formatPercent(safeDivide(qualifiedCalls, calls))} of ${formatPercent(qualRateTarget)}`
            : undefined,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Show-up Rate",
          value: safeDivide(takenCalls, qualifiedCalls),
          formatted: formatPercent(safeDivide(takenCalls, qualifiedCalls)),
          target: showUpRateTarget,
          targetFormatted: showUpRateTarget != null
            ? `${formatPercent(safeDivide(takenCalls, qualifiedCalls))} of ${formatPercent(showUpRateTarget)}`
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
          value: safeDivide(closedRevenue, spend),
          formatted: formatMultiplier(safeDivide(closedRevenue, spend)),
          target: roasTarget,
          targetFormatted: roasTarget != null
            ? `${formatMultiplier(safeDivide(closedRevenue, spend))} of ${formatMultiplier(roasTarget)}`
            : undefined,
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
