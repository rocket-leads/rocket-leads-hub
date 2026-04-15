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
  const prCalls = t ? Math.round(getProRataTarget(t.calls, range)) : undefined
  const prQualified = t ? Math.round(getProRataTarget(t.qualifiedCalls, range)) : undefined
  const prTaken = t ? Math.round(getProRataTarget(t.takenCalls, range)) : undefined
  const prDeals = t ? Math.round(getProRataTarget(t.deals, range)) : undefined
  const prRevenue = t ? Math.round(getProRataTarget(t.revenue, range)) : undefined

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
          target: 0.75,
          targetFormatted: `${formatPercent(safeDivide(qualifiedCalls, calls))} of 75%`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "Show-up Rate",
          value: safeDivide(takenCalls, qualifiedCalls),
          formatted: formatPercent(safeDivide(takenCalls, qualifiedCalls)),
          target: 0.80,
          targetFormatted: `${formatPercent(safeDivide(takenCalls, qualifiedCalls))} of 80%`,
          variant: "volume",
          isLoading: mondayLoading,
          error: mondayError,
        },
        {
          label: "ROAS",
          value: safeDivide(closedRevenue, spend),
          formatted: formatMultiplier(safeDivide(closedRevenue, spend)),
          target: 4,
          targetFormatted: `${formatMultiplier(safeDivide(closedRevenue, spend))} of 4.0×`,
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
