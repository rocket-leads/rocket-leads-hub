"use client"

import { useMemo } from "react"
import type { MondayTargetsData, MetaTargetsData, DateRange, TargetsConfig } from "@/types/targets"
import { calculateKpiGroups, getRevenueProgress } from "@/lib/targets/calculations"

export function useKpiCalculations(
  monday: MondayTargetsData | null,
  meta: MetaTargetsData | null,
  range: DateRange,
  mondayLoading: boolean,
  metaLoading: boolean,
  mondayError: string | null,
  metaError: string | null,
  targets?: TargetsConfig,
) {
  const kpiGroups = useMemo(
    () => calculateKpiGroups(monday, meta, range, mondayLoading, metaLoading, mondayError, metaError, targets),
    [monday, meta, range, mondayLoading, metaLoading, mondayError, metaError, targets],
  )

  // Collected revenue (actually-collected cash) is the primary Revenue figure
  // now - the progress bar tracks it against target. Closed deal value is still
  // shown as a secondary reference on the bar + card. Roy 2026-07-23.
  const revenueProgress = useMemo(
    () => getRevenueProgress(monday?.collectedRevenue ?? 0, range, targets),
    [monday?.collectedRevenue, range, targets],
  )

  return { kpiGroups, revenueProgress }
}
