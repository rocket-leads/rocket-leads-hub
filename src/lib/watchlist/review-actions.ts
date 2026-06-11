// Watch List action review pass.
//
// Closes the inbox-zero workflow loop: when an open action's review_due_at
// has passed, compare the live KPI snapshot to what the CM was looking at
// when they acted, derive an outcome (recovered / improved / unchanged /
// worse), stamp the audit row, and clear the active_action pointer on
// watchlist_client_state so the next categorize() call no longer applies
// the "in review" override.
//
// Designed to be called from `refresh-cache` (daily) right BEFORE
// `updateWatchlistClientState` so the state writer that follows sees the
// pure-rules verdict and re-anchors since_date if the natural bucket
// shifted while the action was being monitored.
//
// Runs cheap (one indexed select + a handful of upserts) and never throws -
// any failure logs and the next cron tick retries the same ripe actions.

import type { createAdminClient } from "@/lib/supabase/server"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

type ActionRow = {
  id: string
  monday_item_id: string
  action_category: "creative" | "pause" | "angle" | "funnel" | "other"
  action_text: string
  kpi_snapshot: {
    adSpend?: number | null
    leads?: number | null
    cpl?: number | null
    prevCpl?: number | null
  } | null
  created_at: string
  review_due_at: string
}

export type ActionOutcome = "recovered" | "improved" | "unchanged" | "worse"

/** CPL ≤ 75% of snapshot = recovered (matches the 25% noise threshold the
 *  rest of the system uses, applied as a hard improvement). */
const RECOVERED_CPL_RATIO = 0.75
/** CPL ≤ 90% of snapshot = improved (mild trend in the right direction). */
const IMPROVED_CPL_RATIO = 0.9
/** CPL ≥ 110% of snapshot = worse (mild trend in the wrong direction). */
const WORSE_CPL_RATIO = 1.1

/**
 * Pick an outcome enum based on CPL drift since the action was logged.
 * Used by the cron review step + exposed for tests.
 *
 * - "recovered" — current bucket is good/watch AND CPL dropped ≥25%.
 * - "improved"  — current bucket is good/watch AND CPL dropped ≥10%.
 * - "worse"     — current bucket is action AND CPL rose ≥10%.
 * - "unchanged" — anything else (still in the same place, noise either way).
 */
export function deriveOutcome(args: {
  snapshotCpl: number | null
  currentCpl: number | null
  currentCategory: "action" | "watch" | "good" | "no-data"
}): ActionOutcome {
  const { snapshotCpl, currentCpl, currentCategory } = args

  // No-data current bucket = either Meta failed for this client this tick,
  // or campaign genuinely paused. Without a current CPL there's no signal
  // to call "recovered" - treat as unchanged and let the next tick re-check.
  if (currentCategory === "no-data") return "unchanged"

  // Bucket flipped away from Action - that's the primary signal of recovery,
  // even when CPL noise hides the magnitude.
  if (currentCategory === "good" || currentCategory === "watch") {
    if (snapshotCpl != null && snapshotCpl > 0 && currentCpl != null) {
      if (currentCpl <= snapshotCpl * RECOVERED_CPL_RATIO) return "recovered"
      if (currentCpl <= snapshotCpl * IMPROVED_CPL_RATIO) return "improved"
    }
    // Bucket recovered even without a clean CPL delta - still call it recovered;
    // the natural categorizer wouldn't have flipped without a real reason.
    return "recovered"
  }

  // Still Action - did it get worse, or just stay stuck?
  if (snapshotCpl != null && snapshotCpl > 0 && currentCpl != null) {
    if (currentCpl >= snapshotCpl * WORSE_CPL_RATIO) return "worse"
  }
  return "unchanged"
}

function formatOutcomeNote(args: {
  outcome: ActionOutcome
  snapshotCpl: number | null
  currentCpl: number | null
  currentCategory: "action" | "watch" | "good" | "no-data"
}): string {
  const snap = args.snapshotCpl != null && args.snapshotCpl > 0
    ? `€${args.snapshotCpl.toFixed(2)}`
    : "—"
  const now = args.currentCpl != null && args.currentCpl > 0
    ? `€${args.currentCpl.toFixed(2)}`
    : "—"
  const bucketLabel = args.currentCategory === "action"
    ? "still concerning"
    : args.currentCategory === "watch"
      ? "monitoring"
      : args.currentCategory === "good"
        ? "healthy"
        : "no data"
  return `CPL ${snap} (snapshot) → ${now} (now). Verdict: ${bucketLabel}.`
}

/**
 * Run the review pass over all open actions with review_due_at <= now.
 * Returns counts so the caller can log a summary.
 *
 * Must be called with a fresh `kpiSummaries` map keyed by monday_item_id +
 * the rules-based `categoryByClient` map that the same cron tick has just
 * computed (categorize() WITHOUT activeAction extras). Decoupling the
 * category lookup from a re-call keeps this function pure-ish and avoids
 * the categorize-twice trap.
 */
export async function reviewDueActions(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  kpiSummaries: Record<string, KpiSummary>,
  categoryByClient: Map<string, "action" | "watch" | "good" | "no-data">,
): Promise<{ reviewed: number; recovered: number; worse: number; unchanged: number; improved: number }> {
  const nowIso = new Date().toISOString()

  const { data: ripe, error } = await supabase
    .from("watchlist_actions")
    .select("id, monday_item_id, action_category, action_text, kpi_snapshot, created_at, review_due_at")
    .lte("review_due_at", nowIso)
    .is("reviewed_at", null)
    .is("superseded_at", null)

  if (error) {
    console.error("[review-actions] select failed:", error.message)
    return { reviewed: 0, recovered: 0, worse: 0, unchanged: 0, improved: 0 }
  }

  const rows = (ripe ?? []) as ActionRow[]
  if (rows.length === 0) {
    return { reviewed: 0, recovered: 0, worse: 0, unchanged: 0, improved: 0 }
  }

  const totals = { reviewed: 0, recovered: 0, worse: 0, unchanged: 0, improved: 0 }

  for (const row of rows) {
    const kpi = kpiSummaries[row.monday_item_id]
    // Meta failed for this client this tick - don't review on stale data.
    // Push the review_due_at out by 12h so the next cron retries.
    if (!kpi || kpi.metaFetchFailed) {
      const retryAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
      await supabase
        .from("watchlist_actions")
        .update({ review_due_at: retryAt })
        .eq("id", row.id)
      continue
    }

    const currentCategory = categoryByClient.get(row.monday_item_id) ?? "no-data"
    const snapshotCpl = row.kpi_snapshot?.cpl ?? null
    const currentCpl = kpi.cpl ?? null
    const outcome = deriveOutcome({ snapshotCpl, currentCpl, currentCategory })
    const outcomeNote = formatOutcomeNote({ outcome, snapshotCpl, currentCpl, currentCategory })

    const { error: updErr } = await supabase
      .from("watchlist_actions")
      .update({
        reviewed_at: nowIso,
        outcome,
        outcome_note: outcomeNote,
        outcome_kpi_snapshot: {
          adSpend: kpi.adSpend ?? null,
          leads: kpi.leads ?? null,
          cpl: kpi.cpl ?? null,
          prevCpl: kpi.prevCpl ?? null,
        },
      })
      .eq("id", row.id)
    if (updErr) {
      console.error("[review-actions] update action row failed:", updErr.message)
      continue
    }

    // Clear the denormalized pointer on watchlist_client_state - the next
    // categorize() call no longer applies the "in review" override. The
    // state writer that runs after this pass will (re)write the natural
    // category derived from KPIs.
    const { error: stateErr } = await supabase
      .from("watchlist_client_state")
      .update({
        active_action_id: null,
        active_action_review_due_at: null,
        updated_at: nowIso,
      })
      .eq("monday_item_id", row.monday_item_id)
      .eq("active_action_id", row.id) // only clear if still pointing at THIS action
    if (stateErr) {
      console.error("[review-actions] clear state pointer failed:", stateErr.message)
    }

    totals.reviewed++
    totals[outcome]++
  }

  return totals
}
