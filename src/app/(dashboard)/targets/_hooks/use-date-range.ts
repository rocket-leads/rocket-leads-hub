"use client"

import { useState, useCallback, useMemo } from "react"
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns"
import type { DateRange, QuickPreset } from "@/types/targets"

export function useDateRange() {
  const now = new Date()
  const [startDate, setStartDate] = useState<Date>(startOfMonth(now))
  const [endDate, setEndDate] = useState<Date>(now)

  const range: DateRange = useMemo(() => ({ startDate, endDate }), [startDate, endDate])

  const presets: QuickPreset[] = useMemo(() => [
    {
      label: "MTD",
      getRange: () => ({ startDate: startOfMonth(new Date()), endDate: new Date() }),
    },
    {
      label: "Last Month",
      getRange: () => ({
        startDate: startOfMonth(subMonths(new Date(), 1)),
        endDate: endOfMonth(subMonths(new Date(), 1)),
      }),
    },
    {
      label: "Last 3 Months",
      getRange: () => ({
        startDate: startOfMonth(subMonths(new Date(), 2)),
        endDate: new Date(),
      }),
    },
  ], [])

  const applyPreset = useCallback((preset: QuickPreset) => {
    const { startDate: s, endDate: e } = preset.getRange()
    setStartDate(s)
    setEndDate(e)
  }, [])

  const formatDate = useCallback((d: Date) => format(d, "yyyy-MM-dd"), [])

  return { range, setStartDate, setEndDate, presets, applyPreset, formatDate }
}
