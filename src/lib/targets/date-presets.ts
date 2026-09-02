import { startOfMonth, endOfMonth, subMonths, subDays } from "date-fns"
import type { QuickPreset } from "@/types/targets"

/**
 * Single source of truth for the quick date-range presets. Shared by the header
 * preset chips ([use-date-range.ts](src/app/(dashboard)/targets/_hooks/use-date-range.ts))
 * AND the date picker's quick-choice rail so the two can never drift.
 *
 * All ranges end at YESTERDAY except MTD, which is the running month and ends
 * today - source data (Meta + Monday) is only complete up to yesterday, and the
 * rolling-window presets are comparison baselines where a partial current day
 * would skew the ratio. MTD is intentionally "this month so far".
 */
function yesterday(): Date {
  return subDays(new Date(), 1)
}

export function getDatePresets(): QuickPreset[] {
  return [
    { label: "Yesterday", getRange: () => ({ startDate: yesterday(), endDate: yesterday() }) },
    { label: "Last 7 Days", getRange: () => ({ startDate: subDays(new Date(), 7), endDate: yesterday() }) },
    { label: "Last 14 Days", getRange: () => ({ startDate: subDays(new Date(), 14), endDate: yesterday() }) },
    { label: "Last 30 Days", getRange: () => ({ startDate: subDays(new Date(), 30), endDate: yesterday() }) },
    { label: "MTD", getRange: () => ({ startDate: startOfMonth(new Date()), endDate: new Date() }) },
    {
      label: "Last Month",
      getRange: () => ({
        startDate: startOfMonth(subMonths(new Date(), 1)),
        endDate: endOfMonth(subMonths(new Date(), 1)),
      }),
    },
    { label: "Last 3 Months", getRange: () => ({ startDate: startOfMonth(subMonths(new Date(), 2)), endDate: yesterday() }) },
  ]
}
