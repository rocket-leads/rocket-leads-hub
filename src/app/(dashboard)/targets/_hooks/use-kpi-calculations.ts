"use client"

import { useMemo } from "react"
import type { MondayTargetsData, MetaTargetsData, DateRange } from "@/types/targets"
import { calculateKpiGroups, getRevenueProgress } from "@/lib/targets/calculations"

export function useKpiCalculations(
  monday: MondayTargetsData | null,
  meta: MetaTargetsData | null,
  range: DateRange,
  mondayLoading: boolean,
  metaLoading: boolean,
  mondayError: string | null,
  metaError: string | null,
) {
  const kpiGroups = useMemo(
    () => calculateKpiGroups(monday, meta, range, mondayLoading, metaLoading, mondayError, metaError),
    [monday, meta, range, mondayLoading, metaLoading, mondayError, metaError],
  )

  const revenueProgress = useMemo(
    () => getRevenueProgress(monday?.closedRevenue ?? 0, range),
    [monday?.closedRevenue, range],
  )

  return { kpiGroups, revenueProgress }
}
