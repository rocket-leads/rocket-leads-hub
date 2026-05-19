import type { MondayLeadItem } from "@/lib/integrations/monday"

// Appointments tracking removed 2026-05 — see knowledge/vision-rocketleads-hub.md.
// Anything that used to depend on `bookedCalls` / `takenCalls` / `costPerBookedCall`
// / `costPerTakenCall` / `qrPercent` / `crPercent` either uses deals (independent
// concept) or has been removed from the UI.
export type KpiResult = {
  adSpend: number
  leads: number
  costPerLead: number
  deals: number
  costPerDeal: number
  revenue: number
  roi: number
  utmBreakdown: UtmRow[]
}

export type UtmRow = {
  utm: string
  leads: number
  deals: number
  revenue: number
}

// Monday's GraphQL `text` for date columns can include a time component
// ("2026-05-17 06:50:00") when the column is configured as date+time. A pure
// lexicographic `dateStr <= end` then fails for items on the end date — the
// trailing " 06:50:00" sorts *after* "2026-05-17" and the item drops out of
// the window. Normalize to the YYYY-MM-DD prefix before comparing.
function inRange(dateStr: string, start: string, end: string): boolean {
  if (!dateStr) return false
  const day = dateStr.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  if (!day) return false
  return day >= start && day <= end
}

function safe(n: number, d: number): number {
  if (!d || !isFinite(d)) return 0
  return n / d
}

export function calculateKpis(
  adSpend: number,
  items: MondayLeadItem[],
  startDate: string,
  endDate: string,
): KpiResult {
  const leads = items.filter((i) => inRange(i.dateCreated, startDate, endDate)).length
  const dealItems = items.filter((i) => inRange(i.dateDeal, startDate, endDate))
  const deals = dealItems.length
  const revenue = dealItems.reduce((sum, i) => sum + i.dealValue, 0)

  // UTM breakdown
  const utmMap = new Map<string, UtmRow>()
  for (const item of items) {
    const utm = item.utm || "(no UTM)"
    if (!utmMap.has(utm)) {
      utmMap.set(utm, { utm, leads: 0, deals: 0, revenue: 0 })
    }
    const row = utmMap.get(utm)!
    if (inRange(item.dateCreated, startDate, endDate)) row.leads++
    if (inRange(item.dateDeal, startDate, endDate)) {
      row.deals++
      row.revenue += item.dealValue
    }
  }

  const utmBreakdown = Array.from(utmMap.values())
    .filter((r) => r.leads > 0 || r.deals > 0)
    .sort((a, b) => b.leads - a.leads)

  return {
    adSpend,
    leads,
    costPerLead: safe(adSpend, leads),
    deals,
    costPerDeal: safe(adSpend, deals),
    revenue,
    roi: safe(revenue, adSpend),
    utmBreakdown,
  }
}
