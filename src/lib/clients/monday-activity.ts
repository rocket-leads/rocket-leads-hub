import type { MondayLeadItem } from "@/lib/integrations/monday"

/**
 * Auto-detect whether a Monday CRM board is actively being used.
 *
 * Active = someone is updating statuses or closing deals.
 * Inactive = leads are flowing in via Zapier but nobody is working them.
 *
 * Signals (strongest → weakest):
 * 1. Any item has dateDeal filled → deals are being tracked
 * 2. 3+ different leadStatus values → statuses are being updated
 *
 * Appointment-based signals were removed 2026-05 alongside the broader
 * appointments-tracking decommission (see knowledge/vision-rocketleads-hub.md).
 */
export function detectMondayActivity(items: MondayLeadItem[]): boolean {
  if (items.length === 0) return false

  // Signal 1: Any deals tracked
  const hasDeals = items.some((i) => i.dateDeal !== "")
  if (hasDeals) return true

  // Signal 2: Diverse leadStatus values (not all the same default)
  const statusValues = new Set(items.map((i) => i.leadStatus).filter(Boolean))
  if (statusValues.size >= 3) return true

  return false
}
