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

  // Two separate revenue tracks, each against its own target: closed deal value
  // and cash collected. The dashboard renders one progress bar for each.
  // Roy 2026-07-23.
  const closedProgress = useMemo(
    () => getRevenueProgress(monday?.closedRevenue ?? 0, targets?.revenue ?? 0, range),
    [monday?.closedRevenue, targets?.revenue, range],
  )
  const collectedProgress = useMemo(
    () => getRevenueProgress(monday?.collectedRevenue ?? 0, targets?.collectedRevenue ?? 0, range),
    [monday?.collectedRevenue, targets?.collectedRevenue, range],
  )

  return { kpiGroups, closedProgress, collectedProgress }
}
