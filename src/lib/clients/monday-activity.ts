import type { MondayLeadItem } from "@/lib/integrations/monday"

/**
 * Auto-detect whether a Monday CRM board is actively being used.
 *
 * Active = someone is updating statuses, scheduling appointments, or closing deals.
 * Inactive = leads are flowing in via Zapier but nobody is working them.
 *
 * Signals (strongest → weakest):
 * 1. Any item has dateAppointment filled → appointments are being scheduled
 * 2. Any item has a non-default leadStatus2 → call outcomes are tracked
 * 3. 3+ different leadStatus values → statuses are being updated
 * 4. Any item has dateDeal filled → deals are being tracked
 */
export function detectMondayActivity(items: MondayLeadItem[]): boolean {
  if (items.length === 0) return false

  // Signal 1: Any appointments scheduled
  const hasAppointments = items.some((i) => i.dateAppointment !== "")
  if (hasAppointments) return true

  // Signal 2: Any deals tracked
  const hasDeals = items.some((i) => i.dateDeal !== "")
  if (hasDeals) return true

  // Signal 3: Non-default leadStatus2 values (someone is tracking call outcomes)
  const status2Values = new Set(items.map((i) => i.leadStatus2).filter(Boolean))
  if (status2Values.size > 1) return true

  // Signal 4: Diverse leadStatus values (not all the same default)
  const statusValues = new Set(items.map((i) => i.leadStatus).filter(Boolean))
  if (statusValues.size >= 3) return true

  return false
}
