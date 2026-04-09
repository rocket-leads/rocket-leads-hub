import { differenceInDays, startOfMonth, getDaysInMonth, max } from "date-fns"
import type { MondayTargetsData, MetaTargetsData, KpiCardData, KpiGroup, DateRange } from "@/types/targets"
import { formatCurrency, formatCurrencyDecimal, formatNumber, formatPercent, formatMultiplier, safeDivide } from "./formatters"

export const MONTHLY_TARGETS = {
  calls: 141,
  qualifiedCalls: 113,
  takenCalls: 90,
  deals: 15,
  revenue: 52500,
  cbc: 62.5,
  cqc: 76,
  ctc: 93,
  cpd: 513,
}

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

export function calculateKpiGroups(
  monday: MondayTargetsData | null,
  meta: MetaTargetsData | null,
  range: DateRange,
  mondayLoading: boolean,
  metaLoading: boolean,
  mondayError: string | null,
  metaError: string | null,
): KpiGroup[] {
  const spend = meta?.spend ?? 0
  const leads = monday?.leads ?? 0
  const calls = monday?.calls ?? 0
  const qualifiedCalls = monday?.qualifiedCalls ?? 0
  const takenCalls = monday?.takenCalls ?? 0
  const deals = monday?.deals ?? 0
  const closedRevenue = monday?.closedRevenue ?? 0

  const prCalls = Math.round(getProRataTarget(MONTHLY_TARGETS.calls, range))
  const prQualified = Math.round(getProRataTarget(MONTHLY_TARGETS.qualifiedCalls, range))
  const prTaken = Math.round(getProRataTarget(MONTHLY_TARGETS.takenCalls, range))
  const prDeals = Math.round(getProRataTarget(MONTHLY_TARGETS.deals, range))
  const prRevenue = Math.round(getProRataTarget(MONTHLY_TARGETS.revenue, range))

  return [
    {
      title: "Volume",
      kpis: [
        {
          label: "Booked Calls",
          value: calls,
          formatted: formatNumber(calls),
          target: prCalls,
          targetFormatted: `${formatNumber(calls)} of ${formatNumber(prCalls)}`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Qualified Calls",
          value: qualifiedCalls,
          formatted: formatNumber(qualifiedCalls),
          target: prQualified,
          targetFormatted: `${formatNumber(qualifiedCalls)} of ${formatNumber(prQualified)}`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Taken Calls",
          value: takenCalls,
          formatted: formatNumber(takenCalls),
          target: prTaken,
          targetFormatted: `${formatNumber(takenCalls)} of ${formatNumber(prTaken)}`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Deals",
          value: deals,
          formatted: formatNumber(deals),
          target: prDeals,
          targetFormatted: `${formatNumber(deals)} of ${formatNumber(prDeals)}`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Revenue",
          value: closedRevenue,
          formatted: formatCurrency(closedRevenue),
          target: prRevenue,
          targetFormatted: `${formatCurrency(closedRevenue)} of ${formatCurrency(prRevenue)}`,
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
          target: MONTHLY_TARGETS.cbc,
          targetFormatted: `${formatCurrencyDecimal(safeDivide(spend, calls))} of ${formatCurrencyDecimal(MONTHLY_TARGETS.cbc)}`,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CQC",
          value: safeDivide(spend, qualifiedCalls),
          formatted: formatCurrencyDecimal(safeDivide(spend, qualifiedCalls)),
          target: MONTHLY_TARGETS.cqc,
          targetFormatted: `${formatCurrencyDecimal(safeDivide(spend, qualifiedCalls))} of ${formatCurrencyDecimal(MONTHLY_TARGETS.cqc)}`,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CTC",
          value: safeDivide(spend, takenCalls),
          formatted: formatCurrencyDecimal(safeDivide(spend, takenCalls)),
          target: MONTHLY_TARGETS.ctc,
          targetFormatted: `${formatCurrencyDecimal(safeDivide(spend, takenCalls))} of ${formatCurrencyDecimal(MONTHLY_TARGETS.ctc)}`,
          variant: "cost",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "CPD",
          value: safeDivide(spend, deals),
          formatted: formatCurrencyDecimal(safeDivide(spend, deals)),
          target: MONTHLY_TARGETS.cpd,
          targetFormatted: `${formatCurrencyDecimal(safeDivide(spend, deals))} of ${formatCurrencyDecimal(MONTHLY_TARGETS.cpd)}`,
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
          variant: "neutral",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Show-up Rate",
          value: safeDivide(takenCalls, qualifiedCalls),
          formatted: formatPercent(safeDivide(takenCalls, qualifiedCalls)),
          variant: "neutral",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "ROI",
          value: safeDivide(closedRevenue, spend),
          formatted: formatMultiplier(safeDivide(closedRevenue, spend)),
          variant: "neutral",
          isLoading: mondayLoading || metaLoading,
          error: mondayError || metaError,
        },
        {
          label: "ROAS",
          value: safeDivide(closedRevenue, spend),
          formatted: formatMultiplier(safeDivide(closedRevenue, spend)),
          variant: "neutral",
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
): { current: number; proRata: number; monthlyTarget: number; pct: number } {
  const proRata = getProRataTarget(MONTHLY_TARGETS.revenue, range)
  return {
    current: closedRevenue,
    proRata,
    monthlyTarget: MONTHLY_TARGETS.revenue,
    pct: safeDivide(closedRevenue, proRata),
  }
}
