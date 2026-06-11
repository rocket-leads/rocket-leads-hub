"use client"

import { useState, useCallback, useEffect, useMemo } from "react"
import { startOfMonth, endOfMonth, subMonths, subDays, format } from "date-fns"
import type { DateRange, QuickPreset } from "@/types/targets"

/**
 * Two-layer persistence for the chosen date range:
 *  1. `cachedRange` (module scope) - survives tab switches within a page load, no flash
 *     when re-mounting the hook because state is read synchronously from this var.
 *  2. `localStorage` - survives full page refreshes. Loaded into module cache on the
 *     first mount of the hook, then kept in sync on every change.
 *
 * Default is **Last 7 Days** across the platform so KPI cards, Pedro insights, and
 * Watch List signals all read the same window - no more "Pedro says stable, dashboard
 * says spike" because two surfaces drift apart. Targets users who want MTD can flip
 * via the preset; this only changes the cold-start default.
 *
 * Storage key is versioned (`-v2`) so the L7D default takes effect for users who had
 * an old MTD range persisted from before this change.
 */
let cachedRange: { start: Date; end: Date } | null = null

const STORAGE_KEY = "rl-hub-date-range-v2"

/** All ranges end at yesterday: source data (Meta + Monday) is only complete up to yesterday. */
function yesterday(): Date {
  return subDays(new Date(), 1)
}

/** Default range across the Hub: last 7 days, ending yesterday. Anchored to the
 *  same window the Pedro insight + Watch List categorizer use. */
function defaultStart(): Date {
  return subDays(new Date(), 7)
}

function readPersistedRange(): { start: Date; end: Date } | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { start: string; end: string }
    const s = new Date(parsed.start)
    const e = new Date(parsed.end)
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null
    return { start: s, end: e }
  } catch {
    return null
  }
}

function writePersistedRange(start: Date, end: Date) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ start: start.toISOString(), end: end.toISOString() }),
    )
  } catch {}
}

/**
 * Snapshot read of the cached range - for non-reactive callers like the page-level
 * refresh button which just needs "what's the user looking at right now". Falls back
 * to localStorage, then to MTD defaults.
 */
export function getCachedDateRangeSnapshot(): { startDate: Date; endDate: Date } {
  if (cachedRange) return { startDate: cachedRange.start, endDate: cachedRange.end }
  const persisted = readPersistedRange()
  if (persisted) {
    cachedRange = persisted
    return { startDate: persisted.start, endDate: persisted.end }
  }
  return { startDate: defaultStart(), endDate: yesterday() }
}

export function useDateRange() {
  const [startDate, setStartDate] = useState<Date>(() => cachedRange?.start ?? defaultStart())
  const [endDate, setEndDate] = useState<Date>(() => cachedRange?.end ?? yesterday())

  // First-mount hydration: SSR and the client's first render both use the MTD default
  // (localStorage isn't available on the server), so we pull the persisted range here
  // after mount. Only fires when the module cache is still empty for this tab - once
  // hydrated, subsequent uses of the hook in the same page lifecycle skip this path.
  useEffect(() => {
    if (cachedRange) return
    const persisted = readPersistedRange()
    if (persisted) {
      cachedRange = persisted
      setStartDate(persisted.start)
      setEndDate(persisted.end)
    }
  }, [])

  // Persist every change to both module cache and localStorage so the next tab and the
  // next page load pick up the user's last-chosen range.
  useEffect(() => {
    cachedRange = { start: startDate, end: endDate }
    writePersistedRange(startDate, endDate)
  }, [startDate, endDate])

  const range: DateRange = useMemo(() => ({ startDate, endDate }), [startDate, endDate])

  const presets: QuickPreset[] = useMemo(() => [
    {
      // MTD intentionally ends TODAY (not yesterday). Server-side getMtdRange()
      // also uses today, so the UI key matches the cron-warmed cache exactly
      // and the page renders instantly from cache instead of paying a live
      // Meta + Monday fetch every load. Intraday partial spend is fine here
      // - MTD is meant to be a running "this month so far" view. The other
      // rolling-window presets stay at yesterday because they're comparison
      // baselines where partial-day data would skew the ratio.
      label: "MTD",
      getRange: () => ({ startDate: startOfMonth(new Date()), endDate: new Date() }),
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
