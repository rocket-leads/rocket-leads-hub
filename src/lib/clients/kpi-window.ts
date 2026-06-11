/**
 * Pure date-window helpers extracted from /api/kpi-summaries so they can be
 * unit-tested without dragging in NextRequest / NextResponse / Supabase.
 *
 * Used by:
 *   - /api/kpi-summaries (live + cache fall-through paths)
 *   - /api/cron/refresh-kpi (daily KPI cache build)
 *   - /api/cron/refresh-cache (daily watchlist context)
 *
 * Keep this module dependency-free.
 */

/** Threshold for "prev period had substantial activity" - see isPrevPeriodReliable. */
export const PREV_PERIOD_COVERAGE_THRESHOLD = 0.8

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00Z").getTime()
  const end = new Date(endDate + "T00:00:00Z").getTime()
  return Math.round((end - start) / 86400000) + 1
}

/**
 * Returns true when the prev period was live for ≥80% of its days AND had
 * total spend > 0. Both conditions matter - a single high-spend day in an
 * otherwise-dead window passes "spend > 0" but fails the coverage check.
 *
 * The UI uses this flag to decide whether the "vs prev 7d" delta is real
 * signal or just an artefact of the client not having been live yet during
 * the comparison window. When false, every consumer must hide CPL/CPA
 * change indicators rather than display a wild +/- swing.
 */
export function isPrevPeriodReliable(
  prevStartDate: string,
  prevEndDate: string,
  prevDaysWithActivity: number,
  prevAdSpend: number,
): boolean {
  const totalDays = daysBetween(prevStartDate, prevEndDate)
  if (totalDays <= 0) return false
  if (prevAdSpend <= 0) return false
  return prevDaysWithActivity / totalDays >= PREV_PERIOD_COVERAGE_THRESHOLD
}
