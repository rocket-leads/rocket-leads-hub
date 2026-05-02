"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { startOfMonth, endOfMonth, subMonths, subDays, format } from "date-fns"
import type { DateRange, QuickPreset } from "@/types/targets"

/**
 * In-memory cache of the most recently chosen date range. Lives at module scope
 * so it survives tab switches (Marketing → Delivery → Finance) within the same
 * page load. A real page refresh wipes the JS module, returning the default to
 * MTD — which matches Roy's expectation that "switching tabs keeps the range,
 * refresh resets it".
 */
let cachedRange: { start: Date; end: Date } | null = null

/** All ranges end at yesterday: source data (Meta + Monday) is only complete up to yesterday. */
function yesterday(): Date {
  return subDays(new Date(), 1)
}

/**
 * Snapshot read of the cached range — for non-reactive callers like the page-level
 * refresh button which just needs "what's the user looking at right now". Falls back
 * to MTD defaults when the cache is empty (initial page load with no tab visited yet).
 */
export function getCachedDateRangeSnapshot(): { startDate: Date; endDate: Date } {
  if (cachedRange) return { startDate: cachedRange.start, endDate: cachedRange.end }
  return { startDate: startOfMonth(new Date()), endDate: yesterday() }
}

export function useDateRange() {
  const [startDate, setStartDate] = useState<Date>(() => cachedRange?.start ?? startOfMonth(new Date()))
  const [endDate, setEndDate] = useState<Date>(() => cachedRange?.end ?? yesterday())

  // Persist every change so the next tab's instance picks it up on mount.
  useEffect(() => {
    cachedRange = { start: startDate, end: endDate }
  }, [startDate, endDate])

  const range: DateRange = useMemo(() => ({ startDate, endDate }), [startDate, endDate])

  const presets: QuickPreset[] = useMemo(() => [
    {
      label: "MTD",
      getRange: () => ({ startDate: startOfMonth(new Date()), endDate: yesterday() }),
    },
    {
      label: "Last 7 Days",
      getRange: () => ({ startDate: subDays(new Date(), 7), endDate: yesterday() }),
    },
    {
      label: "Last 14 Days",
      getRange: () => ({ startDate: subDays(new Date(), 14), endDate: yesterday() }),
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
        endDate: yesterday(),
      }),
    },
  ], [])

  const applyPreset = useCallback((preset: QuickPreset) => {
    const { startDate: s, endDate: e } = preset.getRange()
    setStartDate(s)
    setEndDate(e)
  }, [])

  const setRange = useCallback((s: Date, e: Date) => {
    setStartDate(s)
    setEndDate(e)
  }, [])

  const formatDate = useCallback((d: Date) => format(d, "yyyy-MM-dd"), [])

  return { range, setStartDate, setEndDate, setRange, presets, applyPreset, formatDate }
}
