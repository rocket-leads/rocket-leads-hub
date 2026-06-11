// Watch List learning layer - turns the override audit log into an AI
// adjustment signal that the categorizer can apply to FUTURE clients in
// a similar situation.
//
// This is the second half of the feedback loop the user designed:
//   1. CM hits Move → row jumps to the chosen bucket (categorize.ts manual override)
//   2. The override + KPI snapshot lands in `watchlist_overrides` (audit log)
//   3. ↓ THIS MODULE ↓ - for every live client, find the most similar past
//      override by KPI signature. If similar enough (similarity ≥ threshold)
//      AND the team consistently moved that pattern to the same bucket, emit
//      an AI adjustment suggestion. The categorizer then short-circuits the
//      rules verdict when confidence ≥ AI_ADJUSTMENT_MIN_CONFIDENCE.
//
// Pattern matching (rather than LLM) by design:
//   - Zero per-request cost (runs purely on cached data)
//   - Improves the moment a new override lands - no cron lag
//   - Transparent: "matched override on Client X 4 days ago (similarity 0.82)"
//   - Strictly monotonic with data - more overrides = better suggestions
//
// The signature space is intentionally small (cpl_pct_change, recovery_state,
// spend_band). We're not trying to model nuance - just detect "this looks
// like a case the team has already decided on" reliably enough that the UI
// can surface a hint without taking the decision away from the CM.
//
// LLM integration is left for v2 once we have enough overrides to make
// embedding-based similarity (instead of hand-rolled signature matching)
// produce richer suggestions.

import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { AiAdjustmentExtras } from "./categorize"

/** Compact descriptor of "what does this client's signal look like right now?"
 *  - used to find similar past overrides. */
export type ClientSignature = {
  /** Percent change in CPL vs prev-7d, signed (negative = improving). */
  cplPctChange: number | null
  /** Recovery state inferred from recent window: 'recovered' | 'spiking' | 'stable'. */
  recoveryState: "recovered" | "spiking" | "stable" | "unknown"
  /** Spend band: 'low' (<€50), 'mid' (€50-200), 'high' (>€200). 7d total. */
  spendBand: "low" | "mid" | "high"
  /** Has at least one lead in the window - affects which patterns can apply. */
  hasLeads: boolean
}

export type StoredOverride = {
  mondayItemId: string
  toCategory: "action" | "watch" | "good"
  fromCategory: "action" | "watch" | "good" | "no-data" | null
  reason: string
  /** When the override was created. Newer overrides weigh more in the match. */
  createdAt: string
  /** KPI snapshot at decision time - used to build the signature for comparison. */
  kpiSnapshot: {
    adSpend?: number | null
    leads?: number | null
    cpl?: number | null
    prevCpl?: number | null
  } | null
}

const RECOVERY_RATIO = 1.25 // matches categorize.ts
const FRESH_SPIKE_RATIO = 1.5

export function buildSignature(kpi: KpiSummary | undefined): ClientSignature {
  if (!kpi) {
    return { cplPctChange: null, recoveryState: "unknown", spendBand: "low", hasLeads: false }
  }
  const cplPctChange =
    kpi.cpl > 0 && kpi.prevCpl > 0 ? ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : null

  // Recovery state needs the daily trend - approximate via prevCpl ratio for
  // signature compactness. A full implementation would call getRecentSignal()
  // here; the approximation is fine because the categorizer itself runs the
  // recent-window logic and we only need a coarse bucket.
  let recoveryState: ClientSignature["recoveryState"] = "unknown"
  if (cplPctChange !== null) {
    if (cplPctChange <= 25 && cplPctChange >= -25) recoveryState = "stable"
    else if (cplPctChange > 25) recoveryState = "spiking"
    else recoveryState = "recovered"
  }
  const spendBand: ClientSignature["spendBand"] =
    kpi.adSpend < 50 ? "low" : kpi.adSpend < 200 ? "mid" : "high"
  return {
    cplPctChange,
    recoveryState,
    spendBand,
    hasLeads: kpi.leads > 0,
  }
}

/** Same shape derived from the stored KPI snapshot at override time. */
function snapshotSignature(snap: StoredOverride["kpiSnapshot"]): ClientSignature {
  if (!snap) return { cplPctChange: null, recoveryState: "unknown", spendBand: "low", hasLeads: false }
  const cpl = snap.cpl ?? 0
  const prevCpl = snap.prevCpl ?? 0
  const spend = snap.adSpend ?? 0
  const leads = snap.leads ?? 0
  const cplPctChange = cpl > 0 && prevCpl > 0 ? ((cpl - prevCpl) / prevCpl) * 100 : null
  let recoveryState: ClientSignature["recoveryState"] = "unknown"
  if (cplPctChange !== null) {
    if (cplPctChange <= 25 && cplPctChange >= -25) recoveryState = "stable"
    else if (cplPctChange > 25) recoveryState = "spiking"
    else recoveryState = "recovered"
  }
  return {
    cplPctChange,
    recoveryState,
    spendBand: spend < 50 ? "low" : spend < 200 ? "mid" : "high",
    hasLeads: leads > 0,
  }
}

/** Similarity score in [0, 1] between two signatures. Weighted toward the
 *  axes that drove the original override decision (recovery state + CPL %),
 *  with spend band and lead presence as tie-breakers. */
function similarity(a: ClientSignature, b: ClientSignature): number {
  let score = 0
  let weight = 0

  // Recovery state - the dominant axis. Match = full credit, mismatch = 0.
  weight += 0.5
  if (a.recoveryState !== "unknown" && a.recoveryState === b.recoveryState) score += 0.5

  // CPL pct change - gradient, closer = more credit.
  weight += 0.3
  if (a.cplPctChange !== null && b.cplPctChange !== null) {
    const diff = Math.abs(a.cplPctChange - b.cplPctChange)
    // Within 10pp = full credit, within 30pp = half, beyond = 0.
    const cplCredit = diff <= 10 ? 1 : diff <= 30 ? 0.5 : 0
    score += 0.3 * cplCredit
  }

  // Spend band - exact match only.
  weight += 0.15
  if (a.spendBand === b.spendBand) score += 0.15

  // Lead presence - exact match only.
  weight += 0.05
  if (a.hasLeads === b.hasLeads) score += 0.05

  return weight > 0 ? score / weight : 0
}

/** Minimum number of supporting overrides before a pattern can yield a
 *  high-confidence adjustment. One-off overrides shouldn't move other
 *  clients - we need to see the team make the same call twice. */
const MIN_SUPPORTING_OVERRIDES = 2

/** Similarity above which an override counts as "supporting" the pattern. */
const SUPPORTING_SIMILARITY = 0.7

/** Confidence bump applied per supporting override beyond the minimum.
 *  Caps at 0.95 - we never claim full certainty on a pattern match. */
const CONFIDENCE_PER_SUPPORTER = 0.1

/**
 * For a given live client (described by `currentSignature`), find similar
 * past overrides and return an AI adjustment suggestion when the team has
 * consistently moved this pattern to a particular bucket.
 *
 * Returns null when:
 *   - Fewer than MIN_SUPPORTING_OVERRIDES similar past overrides exist
 *   - The supporting overrides don't agree on a target bucket (mixed signal
 *     means "the team treats this case-by-case", so we don't intervene)
 *
 * The categorizer applies the suggestion when confidence ≥ 0.75 (defined
 * in categorize.ts). Below that, the rules verdict stands.
 */
export function suggestAiAdjustment(
  currentSignature: ClientSignature,
  recentOverrides: StoredOverride[],
): AiAdjustmentExtras | null {
  if (recentOverrides.length === 0) return null

  // Score every override against the current signature. Decay older overrides
  // so a 30-day-old precedent doesn't outvote yesterday's correction.
  const now = Date.now()
  const supporters: Array<{ override: StoredOverride; similarity: number; ageWeight: number }> = []
  for (const o of recentOverrides) {
    const sim = similarity(currentSignature, snapshotSignature(o.kpiSnapshot))
    if (sim < SUPPORTING_SIMILARITY) continue
    const ageDays = (now - new Date(o.createdAt).getTime()) / (24 * 60 * 60 * 1000)
    // Linear decay: 100% at 0d, 50% at 14d, 0% at 30d (clamped).
    const ageWeight = Math.max(0, 1 - ageDays / 30)
    supporters.push({ override: o, similarity: sim, ageWeight })
  }

  if (supporters.length < MIN_SUPPORTING_OVERRIDES) return null

  // Vote on target category, weighted by similarity × age.
  const votes: Record<"action" | "watch" | "good", number> = { action: 0, watch: 0, good: 0 }
  for (const s of supporters) {
    votes[s.override.toCategory] += s.similarity * s.ageWeight
  }
  const sorted = (Object.entries(votes) as Array<[keyof typeof votes, number]>).sort(([, a], [, b]) => b - a)
  const [topCat, topScore] = sorted[0]
  const [, runnerScore] = sorted[1] ?? ["watch", 0]

  // The top bucket must outweigh the runner-up by 2× to count as consensus.
  // Otherwise the team isn't agreeing on what to do with this pattern.
  if (topScore < runnerScore * 2) return null
  if (topScore === 0) return null

  // Confidence: base 0.6 (cleared the gate), +0.1 per supporter beyond the
  // minimum, capped at 0.95. Categorizer applies at ≥0.75 - so we need at
  // least 4 supporters to cross the threshold.
  const confidence = Math.min(
    0.95,
    0.6 + (supporters.length - MIN_SUPPORTING_OVERRIDES) * CONFIDENCE_PER_SUPPORTER,
  )

  // Build a human-readable reason citing the strongest supporting override.
  const strongest = supporters.sort((a, b) => b.similarity * b.ageWeight - a.similarity * a.ageWeight)[0]
  const reason = `Matches ${supporters.length} past overrides (e.g. "${strongest.override.reason.slice(0, 80)}")`

  return {
    suggestedCategory: topCat,
    reason,
    confidence,
  }
}
