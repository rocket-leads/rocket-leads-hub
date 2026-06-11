"use client"

import { useCallback, useMemo, useState } from "react"
import { format, startOfMonth, subDays, subMonths } from "date-fns"
import type { DateRange, QuickPreset } from "@/types/targets"

/**
 * Session-only date range for the client slide-over. Same shape as
 * `useDateRange` (targets), with two intentional differences:
 *
 *  1. **No localStorage persistence.** Every slide-over open starts on
 *     "Last 7 Days". Without this, the user's choice on the All Clients
 *     overview / targets dashboards leaked into the slide-over and the
 *     KPI cards silently showed MTD numbers under a Watch List link that
 *     promised 7d (Roy 2026-05).
 *
 *  2. **No cross-component module cache.** Each call gets its own state.
 *     Two different tabs of the slide-over (Home, Campaigns) intentionally
 *     keep their own picker because they answer different questions.
 *
 * Persistence is fine on /targets and /billing where the user runs
 * analysis sessions - that's why the shared `useDateRange` hook keeps
 * its module cache + localStorage. Clients-facing surfaces use this hook
 * instead so they always default to the canonical 7d window.
 */
function yesterday(): Date {
  return subDays(new Date(), 1)
}

function defaultStart(): Date {
  return subDays(new Date(), 7)
}

export function useClientDateRange() {
  const [startDate, setStartDate] = useState<Date>(() => defaultStart())
  const [endDate, setEndDate] = useState<Date>(() => yesterday())

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
      label: "Last 30 Days",
      getRange: () => ({ startDate: subDays(new Date(), 30), endDate: yesterday() }),
    },
    {
      label: "Last Month",
      getRange: () => {
        const lastMonth = subMonths(new Date(), 1)
        return {
          startDate: startOfMonth(lastMonth),
          endDate: subDays(startOfMonth(new Date()), 1),
        }
      },
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
