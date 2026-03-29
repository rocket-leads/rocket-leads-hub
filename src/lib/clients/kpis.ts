import type { MondayLeadItem } from "@/lib/integrations/monday"

export type KpiResult = {
  adSpend: number
  leads: number
  costPerLead: number
  qrPercent: number
  bookedCalls: number
  costPerBookedCall: number
  suPercent: number
  takenCalls: number
  costPerTakenCall: number
  deals: number
  crPercent: number
  costPerDeal: number
  revenue: number
  roi: number
  utmBreakdown: UtmRow[]
}

export type UtmRow = {
  utm: string
  leads: number
  bookedCalls: number
  takenCalls: number
  deals: number
  revenue: number
}

function inRange(dateStr: string, start: string, end: string): boolean {
  if (!dateStr) return false
  return dateStr >= start && dateStr <= end
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
  takenCallStatusValue: string
): KpiResult {
  const leads = items.filter((i) => inRange(i.dateCreated, startDate, endDate)).length
  const bookedCalls = items.filter((i) => inRange(i.dateAppointment, startDate, endDate)).length
  const takenCalls = items.filter(
    (i) => inRange(i.dateAppointment, startDate, endDate) && i.leadStatus2 === takenCallStatusValue
  ).length
  const dealItems = items.filter((i) => inRange(i.dateDeal, startDate, endDate))
  const deals = dealItems.length
  const revenue = dealItems.reduce((sum, i) => sum + i.dealValue, 0)

  // UTM breakdown
  const utmMap = new Map<string, UtmRow>()
  for (const item of items) {
    const utm = item.utm || "(no UTM)"
    if (!utmMap.has(utm)) {
      utmMap.set(utm, { utm, leads: 0, bookedCalls: 0, takenCalls: 0, deals: 0, revenue: 0 })
    }
    const row = utmMap.get(utm)!
    if (inRange(item.dateCreated, startDate, endDate)) row.leads++
    if (inRange(item.dateAppointment, startDate, endDate)) row.bookedCalls++
    if (inRange(item.dateAppointment, startDate, endDate) && item.leadStatus2 === takenCallStatusValue) row.takenCalls++
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
    qrPercent: safe(bookedCalls, leads) * 100,
    bookedCalls,
    costPerBookedCall: safe(adSpend, bookedCalls),
    suPercent: safe(takenCalls, bookedCalls) * 100,
    takenCalls,
    costPerTakenCall: safe(adSpend, takenCalls),
    deals,
    crPercent: safe(deals, takenCalls) * 100,
    costPerDeal: safe(adSpend, deals),
    revenue,
    roi: safe(revenue, adSpend),
    utmBreakdown,
  }
}
