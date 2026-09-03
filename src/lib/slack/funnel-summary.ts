import type { AppointmentRow } from "./sales-fetcher"

// ─── Formatting ─────────────────────────────────────────────────────────────

/** Whole-euro amount with thousands separators: 1000 → "€1,000". */
export function eur0(n: number): string {
  return `€${Math.round(n).toLocaleString("en-GB")}`
}

/** Cost-per amount: no decimals when whole, else two. 10 → "€10", 12.375 → "€12.38". */
export function eurCost(n: number): string {
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? `€${r}` : `€${r.toFixed(2)}`
}

/** Ratio as a whole percent. Returns "–" when the denominator is 0 (no data), not "0%". */
export function pct(num: number, den: number): string {
  if (den <= 0) return "–"
  return `${Math.round((num / den) * 100)}%`
}

// ─── Line builders ──────────────────────────────────────────────────────────

/**
 * Top-of-funnel marketing line. Opt-ins (not raw Meta leads) is the headline
 * metric with cost-per-opt-in, matching the Targets dashboard, so BR reconciles
 * with the opt-ins figure on the same line. BR = booked / opt-ins.
 */
export function marketingLine(input: { spend: number; optIns: number; booked: number }): string {
  const { spend, optIns, booked } = input
  const costPerOptIn = optIns > 0 ? spend / optIns : 0
  const cbc = booked > 0 ? spend / booked : 0
  return `${eur0(spend)} spend · ${optIns} opt-ins (${eurCost(costPerOptIn)}) · ${booked} booked (${eurCost(cbc)}) · ${pct(booked, optIns)} BR`
}

/** One outcome-decomposed row of a sales funnel (top-level or per-closer). */
export type SalesCounts = {
  scheduled: number
  noShowCancel: number
  taken: number
  deals: number
  empty: number
}

/** Team sales line: scheduled · no show/cancel · taken (take%) · deal (conv%) · empty outcome. */
export function salesLine(c: SalesCounts): string {
  return `${c.scheduled} scheduled · ${c.noShowCancel} no show/cancel · ${c.taken} taken calls (${pct(c.taken, c.scheduled)}) · ${c.deals} deal (${pct(c.deals, c.taken)}) · ${c.empty} empty outcome`
}

/** One per-closer bullet, same fields as the team sales line. */
export function closerLine(name: string, c: SalesCounts): string {
  return `• ${name}: ${c.scheduled} scheduled, ${c.noShowCancel} no show/cancel, ${c.taken} taken (${pct(c.taken, c.scheduled)}), ${c.deals} deal (${pct(c.deals, c.taken)}), ${c.empty} empty outcome`
}

/**
 * Renders the per-closer block from already-computed rows. Rows are expected
 * pre-filtered to active closers; sorted by scheduled desc then deals desc.
 * Returns the empty-state line when there's nothing to show.
 */
export function closerLinesFrom(
  rows: Array<{ name: string; counts: SalesCounts }>,
  emptyLabel: string,
): { text: string; count: number } {
  const active = [...rows]
    .filter((r) => r.counts.scheduled > 0 || r.counts.deals > 0)
    .sort((a, b) => b.counts.scheduled - a.counts.scheduled || b.counts.deals - a.counts.deals)
  if (active.length === 0) return { text: emptyLabel, count: 0 }
  return { text: active.map((r) => closerLine(r.name, r.counts)).join("\n"), count: active.length }
}

/**
 * Agenda block: one bullet per appointment with time, closer (wie_), lead name,
 * company name (bedrijfsnaam) and a Monday deep-link. Each piece is omitted
 * cleanly when absent. Falls back to `emptyLabel` when there are no appointments.
 */
export function appointmentLines(appts: AppointmentRow[], emptyLabel: string): string {
  if (appts.length === 0) return emptyLabel
  return appts
    .map((a) => {
      const timePart = a.time ? `${a.time}: ` : ""
      const closerPart = a.closer ? `${a.closer} - ` : ""
      const companyPart = a.companyName ? ` (${a.companyName})` : ""
      return `• ${timePart}${closerPart}${a.name}${companyPart} - <${a.url}|Bekijk in Monday>`
    })
    .join("\n")
}
