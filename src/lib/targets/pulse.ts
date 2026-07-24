import { differenceInDays } from "date-fns"
import { deriveTargets } from "./calculations"
import { formatCurrency, formatCurrencyDecimal, formatPercent, safeDivide } from "./formatters"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

export interface PillarStatus {
  name: string
  onTrack: boolean | null // null = not enough data / no target
  /** One-line diagnostic shown in the pulse banner. */
  hint: string
  /** Formatted current value, for optional display next to the name. */
  metric: string
  /** Formatted target value, for optional display. */
  target: string
  /**
   * Root-cause of an off-track OUTCOME pillar, one funnel step deeper. Cost per
   * Booked Call is not itself a lever - it's CostPerOptIn ÷ BookingRate. When CBC
   * is off we trace which of those two is actually to blame so the banner points
   * at the real thing to fix, not the symptom. Null for leaf pillars (Booking /
   * Show-up / Conversion are already root levers) or when it can't be decomposed
   * (no opt-in data, e.g. under a country filter). Roy 2026-07-24.
   */
  driver?: { name: string; detail: string } | null
}

export interface ForecastInfo {
  paceFactor: number
  projectedRevenue: number
  targetRevenue: number
  currentRevenue: number
  daysElapsed: number
  daysRemaining: number
  totalDays: number
  isClosed: boolean
  summary: string
}

export interface PulseResult {
  pillars: PillarStatus[]
  onTrackPillars: PillarStatus[]
  offTrackPillars: PillarStatus[]
  evaluatedCount: number
  forecast: ForecastInfo | null
}

const HINTS = {
  cbc: { good: "Ad efficiency healthy", bad: "Creatives or audience need rework" },
  booking: { good: "Opt-ins converting into calls", bad: "Calendar / follow-up friction" },
  showUp: { good: "Leads are showing up", bad: "Reminders or scheduling issue" },
  conv: { good: "Sales team converting well", bad: "Sales or proposition issue" },
} as const

/**
 * Compute the marketing/sales health pulse: per-pillar status with diagnostic hints,
 * plus a revenue pace forecast. The banner derives layout (full-width vs split) from
 * the on/off pillar counts.
 */
export function calculatePulse(
  monday: MondayTargetsData | null,
  meta: MetaTargetsData | null,
  targets: TargetsConfig | null,
  range: DateRange,
): PulseResult | null {
  if (!monday || !meta || !targets) return null

  const derived = deriveTargets(targets)
  const spend = meta.spend
  const optIns = monday.optIns
  const calls = monday.calls
  const taken = monday.takenCalls
  const deals = monday.deals
  const revenue = monday.closedRevenue

  const cbc = safeDivide(spend, calls)
  // 2026-05-27: qualification pillar dropped - booking rate (Booked/Opt-ins)
  // takes its place and show-up rate uses booked as denominator.
  const bookingRate = safeDivide(calls, optIns)
  const showUpRate = safeDivide(taken, calls)
  const convRate = safeDivide(deals, taken)

  const cbcCheck = spend > 0 && targets.cbc > 0 && calls > 3 ? cbc <= targets.cbc : null
  const bookingCheck = optIns > 3 && derived.bookingRate > 0 ? bookingRate >= derived.bookingRate : null
  const showUpCheck = calls > 3 && derived.showUpRate > 0 ? showUpRate >= derived.showUpRate : null
  const convCheck = taken > 3 && derived.convRate > 0 ? convRate >= derived.convRate : null

  // ── CBC root-cause decomposition ──────────────────────────────────────────
  // CBC = spend/booked = (spend/opt-ins) ÷ (booked/opt-ins) = CostPerOptIn ÷ BookingRate.
  // So the only two ways to move CBC are cheaper opt-ins or a higher booking rate.
  // When CBC is off we check which of the two is the culprit and name it - the
  // banner then flags the real lever instead of the CBC symptom.
  const cpo = safeDivide(spend, optIns)
  const cpoTarget = targets.cpOptIn
  const cpoOnTrack = optIns > 3 && cpoTarget > 0 ? cpo <= cpoTarget : null
  const cbcDriver = (): PillarStatus["driver"] => {
    if (cbcCheck !== false) return null // only decompose an off-track CBC
    if (cpoOnTrack === null || bookingCheck === null) return null // no opt-in data to trace with
    const cpoStr = `${formatCurrencyDecimal(cpo)} (target ${formatCurrencyDecimal(cpoTarget)})`
    const brStr = `${formatPercent(bookingRate)} (target ${formatPercent(derived.bookingRate)})`
    if (!cpoOnTrack && bookingCheck === true) {
      return {
        name: "Cost per Opt-in",
        detail: `Opt-ins too expensive at ${cpoStr}; booking rate on track at ${formatPercent(bookingRate)}. Lower cost-per-opt-in via creatives / targeting.`,
      }
    }
    if (cpoOnTrack && bookingCheck === false) {
      return {
        name: "Appointment Booking Rate",
        detail: `Booking rate low at ${brStr}; opt-in cost on track at ${formatCurrencyDecimal(cpo)}. Fix the opt-in → call step: calendar friction, follow-up speed, form-to-booking handoff.`,
      }
    }
    if (!cpoOnTrack && bookingCheck === false) {
      return {
        name: "Cost per Opt-in + Booking Rate",
        detail: `Both off: opt-ins ${cpoStr} and booking ${brStr}. Cheaper opt-ins AND a smoother opt-in → call step both needed.`,
      }
    }
    return null // both on track but CBC off (rounding) - no clear single lever
  }

  const pillars: PillarStatus[] = [
    {
      name: "Cost per Booked Call",
      onTrack: cbcCheck,
      hint: cbcCheck === true ? HINTS.cbc.good : HINTS.cbc.bad,
      metric: calls > 0 ? formatCurrencyDecimal(cbc) : "-",
      target: targets.cbc > 0 ? formatCurrencyDecimal(targets.cbc) : "-",
      driver: cbcDriver(),
    },
    {
      name: "Booking Rate",
      onTrack: bookingCheck,
      hint: bookingCheck === true ? HINTS.booking.good : HINTS.booking.bad,
      metric: optIns > 0 ? formatPercent(bookingRate) : "-",
      target: derived.bookingRate > 0 ? formatPercent(derived.bookingRate) : "-",
    },
    {
      name: "Show-up Rate",
      onTrack: showUpCheck,
      hint: showUpCheck === true ? HINTS.showUp.good : HINTS.showUp.bad,
      metric: calls > 0 ? formatPercent(showUpRate) : "-",
      target: derived.showUpRate > 0 ? formatPercent(derived.showUpRate) : "-",
    },
    {
      name: "Conversion Rate",
      onTrack: convCheck,
      hint: convCheck === true ? HINTS.conv.good : HINTS.conv.bad,
      metric: taken > 0 ? formatPercent(convRate) : "-",
      target: derived.convRate > 0 ? formatPercent(derived.convRate) : "-",
    },
  ]

  const evaluated = pillars.filter((p) => p.onTrack !== null)
  const onTrackPillars = evaluated.filter((p) => p.onTrack === true)
  const offTrackPillars = evaluated.filter((p) => p.onTrack === false)

  // ── Forecast based on revenue pace ──
  const now = new Date()
  const totalDays = Math.max(1, differenceInDays(range.endDate, range.startDate) + 1)
  const daysElapsedRaw = differenceInDays(now, range.startDate) + 1
  const daysElapsed = Math.max(1, Math.min(daysElapsedRaw, totalDays))
  const daysRemaining = Math.max(0, totalDays - daysElapsed)
  const isClosed = range.endDate < now && daysRemaining === 0
  const proRataFactor = isClosed ? 1 : daysElapsed / totalDays

  const targetRevenue = targets.revenue
  let forecast: ForecastInfo | null = null
  if (targetRevenue > 0) {
    const projectedRevenue = isClosed || proRataFactor >= 1 ? revenue : revenue / proRataFactor
    const paceFactor = projectedRevenue / targetRevenue
    let summary: string
    if (isClosed) {
      summary = revenue >= targetRevenue
        ? `Closed at ${formatCurrency(revenue)} - hit ${formatCurrency(targetRevenue)} target`
        : `Closed at ${formatCurrency(revenue)} - ${formatCurrency(targetRevenue - revenue)} short of ${formatCurrency(targetRevenue)} target`
    } else if (paceFactor >= 1.05) {
      summary = `Ahead of pace · projected ${formatCurrency(projectedRevenue)} (${Math.round(paceFactor * 100)}% of target)`
    } else if (paceFactor >= 0.95) {
      summary = `On pace · projected ${formatCurrency(projectedRevenue)} of ${formatCurrency(targetRevenue)} target`
    } else {
      const gap = targetRevenue - revenue
      const dailyNeeded = daysRemaining > 0 ? gap / daysRemaining : 0
      summary = `Behind pace · ${Math.round(paceFactor * 100)}% of target · need ${formatCurrency(dailyNeeded)}/day for remaining ${daysRemaining} days`
    }
    forecast = {
      paceFactor,
      projectedRevenue,
      targetRevenue,
      currentRevenue: revenue,
      daysElapsed,
      daysRemaining,
      totalDays,
      isClosed,
      summary,
    }
  }

  return {
    pillars,
    onTrackPillars,
    offTrackPillars,
    evaluatedCount: evaluated.length,
    forecast,
  }
}
