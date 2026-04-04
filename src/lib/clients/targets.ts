/**
 * KPI Target thresholds for conditional coloring of KPI cards.
 *
 * Independent metrics (user-editable): CPL, QR%, SU%, CR%
 * Derived metrics (auto-calculated):   CPBA, CPTA, CPD
 *
 * Cost metrics: lower is better  → value ≤ green = green, ≤ orange = orange, else red
 * Rate metrics: higher is better → value ≥ green = green, ≥ orange = orange, else red
 */

export type TargetRange = { green: number; orange: number }

export type KpiTargets = {
  cpl: TargetRange
  qr: TargetRange
  cpba: TargetRange
  su: TargetRange
  cpta: TargetRange
  cr: TargetRange
  cpd: TargetRange
}

export const DEFAULT_TARGETS: KpiTargets = {
  cpl:  { green: 30, orange: 50 },
  qr:   { green: 15, orange: 10 },
  cpba: { green: 200, orange: 300 },
  su:   { green: 85, orange: 70 },
  cpta: { green: 200, orange: 300 },
  cr:   { green: 15, orange: 5 },
  cpd:  { green: 1250, orange: 2000 },
}

/** Keys that the user directly edits — the rest are derived. */
export const INDEPENDENT_KEYS = ["cpl", "qr", "su", "cr"] as const
export const DERIVED_KEYS = ["cpba", "cpta", "cpd"] as const

/**
 * Recalculate derived thresholds from independent ones.
 *
 * Formulas (using green-threshold cost / varying rate thresholds):
 *   CPBA  = CPL   / (QR% / 100)
 *   CPTA  = CPBA  / (SU% / 100)
 *   CPD   = CPTA  / (CR% / 100)
 */
export function deriveTargets(t: KpiTargets): KpiTargets {
  const cpba_green  = Math.round(t.cpl.green / (t.qr.green / 100))
  const cpba_orange = Math.round(t.cpl.green / (t.qr.orange / 100))

  const cpta_green  = Math.round(cpba_green / (t.su.green / 100))
  const cpta_orange = Math.round(cpba_green / (t.su.orange / 100))

  const cpd_green  = Math.round(cpta_green / (t.cr.green / 100))
  const cpd_orange = Math.round(cpta_green / (t.cr.orange / 100))

  return {
    ...t,
    cpba: { green: cpba_green, orange: cpba_orange },
    cpta: { green: cpta_green, orange: cpta_orange },
    cpd:  { green: cpd_green, orange: cpd_orange },
  }
}

/** Map from KpiResult key → target key. Only keys with targets are listed. */
const KPI_TO_TARGET: Record<string, { target: keyof KpiTargets; direction: "cost" | "rate" }> = {
  costPerLead:       { target: "cpl",  direction: "cost" },
  qrPercent:         { target: "qr",   direction: "rate" },
  costPerBookedCall: { target: "cpba", direction: "cost" },
  suPercent:         { target: "su",   direction: "rate" },
  costPerTakenCall:  { target: "cpta", direction: "cost" },
  crPercent:         { target: "cr",   direction: "rate" },
  costPerDeal:       { target: "cpd",  direction: "cost" },
}

export type TargetStatus = "green" | "orange" | "red"

/**
 * Evaluate a KPI value against its target thresholds.
 * Returns null for KPIs that have no target (adSpend, leads, revenue, roi).
 */
export function evaluateKpi(kpiKey: string, value: number, targets: KpiTargets): TargetStatus | null {
  const mapping = KPI_TO_TARGET[kpiKey]
  if (!mapping) return null
  if (!isFinite(value) || value === 0) return null

  const range = targets[mapping.target]

  if (mapping.direction === "cost") {
    // Lower is better: ≤ green = green, ≤ orange = orange, else red
    if (value <= range.green) return "green"
    if (value <= range.orange) return "orange"
    return "red"
  }

  // Rate: higher is better: ≥ green = green, ≥ orange = orange, else red
  if (value >= range.green) return "green"
  if (value >= range.orange) return "orange"
  return "red"
}

/** Merge global targets with optional per-client overrides (partial). */
export function mergeTargets(global: KpiTargets, overrides?: Partial<KpiTargets> | null): KpiTargets {
  if (!overrides) return global
  const merged = { ...global }
  for (const key of Object.keys(overrides) as (keyof KpiTargets)[]) {
    if (overrides[key]) {
      merged[key] = { ...merged[key], ...overrides[key] }
    }
  }
  return merged
}

/** Target metric display configuration for settings UI. */
export const TARGET_METRICS = [
  { key: "cpl" as const,  label: "Cost per Lead",              unit: "€", direction: "cost" as const, derived: false },
  { key: "qr" as const,   label: "QR%",                        unit: "%", direction: "rate" as const, derived: false },
  { key: "cpba" as const, label: "Cost per Booked Appointment", unit: "€", direction: "cost" as const, derived: true },
  { key: "su" as const,   label: "SU% (Show Up)",              unit: "%", direction: "rate" as const, derived: false },
  { key: "cpta" as const, label: "Cost per Taken Appointment",  unit: "€", direction: "cost" as const, derived: true },
  { key: "cr" as const,   label: "CR%",                        unit: "%", direction: "rate" as const, derived: false },
  { key: "cpd" as const,  label: "Cost per Deal",              unit: "€", direction: "cost" as const, derived: true },
] as const
