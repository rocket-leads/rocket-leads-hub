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

  const revenueProgress = useMemo(
    () => getRevenueProgress(monday?.closedRevenue ?? 0, range, targets),
    [monday?.closedRevenue, range, targets],
  )

  return { kpiGroups, revenueProgress }
}
