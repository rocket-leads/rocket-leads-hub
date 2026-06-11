/**
 * Billing-cycle date helpers - used by both the edit pipeline (write
 * derived invoice date when the user edits the cycle) and the cron drift
 * corrector (rewrite Monday's invoice column when it falls out of sync).
 *
 * The relationship is fixed: invoice date = cycle start - 7 days. Cycle is
 * the single source of truth; invoice date is always derived. Finance pays
 * 7 days ahead so the new period can't begin until payment lands.
 */

/** Days between cycle start and invoice send date. Spec, not a default. */
export const INVOICE_LEAD_DAYS = 7

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Subtract `days` from a `YYYY-MM-DD` string, returning a `YYYY-MM-DD`. Uses
 * UTC arithmetic so the result doesn't drift on DST boundaries (which
 * `new Date("YYYY-MM-DD")` would, since it's parsed as local).
 */
export function subtractDaysIso(yyyy_mm_dd: string, days: number): string | null {
  if (!DATE_RE.test(yyyy_mm_dd)) return null
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d) - days * 24 * 60 * 60 * 1000
  const result = new Date(ms)
  const yy = result.getUTCFullYear().toString().padStart(4, "0")
  const mm = (result.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = result.getUTCDate().toString().padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}

/** Compute the invoice date for a given cycle start. Returns null when the
 *  cycle is unset or malformed - the caller is expected to clear Monday's
 *  invoice column too in that case. */
export function deriveInvoiceDate(cycleStartDate: string | null | undefined): string | null {
  if (!cycleStartDate) return null
  return subtractDaysIso(cycleStartDate, INVOICE_LEAD_DAYS)
}

/**
 * Add `months` to a `YYYY-MM-DD` and clamp the day to the target month's
 * last day so 31 Jan + 1 month → 28/29 Feb (rather than overflowing into
 * March). Used to advance the cycle date one period forward right after
 * an invoice is sent.
 */
export function addMonthsIso(yyyy_mm_dd: string, months: number): string | null {
  if (!DATE_RE.test(yyyy_mm_dd)) return null
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number)
  const totalMonths = (m - 1) + months
  const targetYear = y + Math.floor(totalMonths / 12)
  const targetMonthIdx = ((totalMonths % 12) + 12) % 12 // 0-indexed, handles negatives
  // Last day of the target month - Date.UTC(year, monthIdx + 1, 0) gives the
  // last day of monthIdx because day=0 rolls back into the previous month.
  const lastDay = new Date(Date.UTC(targetYear, targetMonthIdx + 1, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  const yy = targetYear.toString().padStart(4, "0")
  const mm = (targetMonthIdx + 1).toString().padStart(2, "0")
  const dd = day.toString().padStart(2, "0")
  return `${yy}-${mm}-${dd}`
}
