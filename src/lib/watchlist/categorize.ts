// Watch List bucket logic — shared between the UI (live categorization on the dashboard)
// and the cron (state-table updates). Keep this module pure and dependency-free so it
// can run on both server and client without dragging in fetch/auth machinery.
//
// Buckets:
//   - action   : urgent — CPL spike above the action threshold, or zero leads with spend
//   - watch    : trending wrong — CPL rising above the watch threshold but not yet action-grade
//   - good     : healthy — has leads, CPL stable or improving
//   - no-data  : nothing actionable to compute (no spend & no leads, or no Meta account)
//
// CPA (cost per appointment) is intentionally excluded from this signal path — Monday
// appointment data is too sparse / inconsistent right now and was producing noisy flips.
// CPA is still computed and stored on the KPI summary for future use; just not driving
// concerns/actions until the underlying data is reliable.
//
// `severityScore` ranks within Action/Watch by potential € impact.
//
// Recent-window override: a 7d-only verdict has tunnel vision. We optimise daily, so a
// 7d CPL spike that has already recovered in the last 1-3 days is no longer urgent.
// Conversely a fresh spike yesterday is invisible in a 7d average. `getRecentSignal()`
// extracts the shortest reliable window (1d → 2d → 3d) from `dailyTrend` and we apply
// two flips on top of the 7d verdict:
//   - action + recovery   → watch  ("CPL spiked but recovered to baseline — monitor")
//   - good   + fresh spike → watch  ("CPL spiking last 1-3d while 7d still calm")

import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { createAdminClient } from "@/lib/supabase/server"

export type WatchCategory = "action" | "watch" | "good" | "no-data"

/**
 * Recent CPL from the shortest trustworthy window (1d → 2d → 3d). "Trustworthy"
 * means the window has at least 2 leads and >€0 spend — anything thinner is too
 * noisy to flip a bucket on.
 *
 * Returns `null` when even 3d doesn't clear the bar. Callers should fall back to
 * the 7d verdict in that case.
 */
export type RecentSignal = {
  recentCpl: number
  windowDays: 1 | 2 | 3
  recentSpend: number
  recentLeads: number
}

export function getRecentSignal(kpi: KpiSummary): RecentSignal | null {
  const trend = kpi.dailyTrend
  if (!trend || trend.length === 0) return null

  for (const windowDays of [1, 2, 3] as const) {
    if (trend.length < windowDays) continue
    const slice = trend.slice(-windowDays)
    const recentSpend = slice.reduce((s, d) => s + d.spend, 0)
    const recentLeads = slice.reduce((s, d) => s + d.leads, 0)
    if (recentLeads >= 2 && recentSpend > 0) {
      return { recentCpl: recentSpend / recentLeads, windowDays, recentSpend, recentLeads }
    }
  }
  return null
}

/** Recent CPL within 25% of the prev-7d baseline = recovered. */
const RECOVERY_RATIO = 1.25
/** Recent CPL ≥1.5× prev-7d baseline while 7d hasn't tripped Watch yet = fresh spike. */
const FRESH_SPIKE_RATIO = 1.5
/** Min spend in the recent window before we'll promote good → watch on a fresh spike. */
const FRESH_SPIKE_MIN_SPEND = 30

/**
 * Tiered Watch/Action thresholds based on actual 7d ad spend. Smaller accounts have
 * inherently noisier week-over-week swings; larger accounts deserve a more sensitive
 * signal because % moves on big spend = real € lost.
 */
export function getThresholds(adSpend7d: number): { watchPct: number; actionPct: number } {
  if (adSpend7d < 250) return { watchPct: 15, actionPct: 40 }
  if (adSpend7d < 1000) return { watchPct: 10, actionPct: 30 }
  return { watchPct: 5, actionPct: 20 }
}

/**
 * Severity score for ranking within Action/Watch buckets.
 *   score = adSpend × max(cplDelta_pct / 30, 1) × (zero-leads-with-spend ? 3 : 1)
 * Bigger spend × bigger CPL spike floats to the top. Zero-leads-with-spend is
 * pure waste, so it gets a 3× multiplier on raw spend.
 *
 * Recovery dampener: when the recent (1-3d) window shows CPL back at baseline
 * (≤RECOVERY_RATIO × prevCpl), halve the score so demoted-from-action-to-watch
 * clients sink toward the bottom of the Watch bucket. Genuinely-still-bad
 * clients stay at the top.
 *
 * CPA was previously included in the worst-case calculation but is left out for
 * now — see the file header for context on the appointment-data reliability gap.
 */
export function severityScore(kpi: KpiSummary): number {
  const spend = kpi.adSpend
  if (spend > 50 && kpi.leads === 0) return spend * 3

  const cplPct = kpi.prevCpl > 0 ? Math.abs((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0
  let score = spend * Math.max(cplPct / 30, 1)

  if (kpi.prevCpl > 0) {
    const recent = getRecentSignal(kpi)
    if (recent && recent.recentCpl <= kpi.prevCpl * RECOVERY_RATIO) {
      score *= 0.5
    }
  }
  return score
}

export function categorize(client: MondayClient, kpi: KpiSummary | undefined): { category: WatchCategory; insight: string } {
  if (kpi?.rlAccountNoCampaign) {
    return { category: "no-data", insight: "RL ad account — no campaigns selected. Pick campaigns in client settings to start tracking." }
  }

  if (!client.metaAdAccountId) {
    return { category: "no-data", insight: "No Meta ad account configured for this client." }
  }

  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { category: "no-data", insight: "No spend or leads (7d) — campaign paused, ad account issue, or genuinely idle." }
  }

  // Zero-leads-with-spend is unrecoverable by definition (a recent window with leads
  // would mean leads exist). Always Action — no recovery override applies.
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return { category: "action", insight: `€${kpi.adSpend.toFixed(0)} spent, 0 leads (7d)` }
  }

  // CPL is the only trend driving categorization for now. CPA branches were removed
  // because appointment data is too sparse to be a reliable signal — see file header.
  const hasCplTrend = kpi.cpl > 0 && kpi.prevCpl > 0
  const cplPct = hasCplTrend ? ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0
  const { watchPct, actionPct } = getThresholds(kpi.adSpend)

  // Compute the 7d-only verdict first; the recent-window override flips it afterwards.
  let category: WatchCategory
  let insight: string

  if (hasCplTrend && cplPct >= actionPct) {
    category = "action"
    insight = `CPL up ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} (7d) vs €${kpi.prevCpl.toFixed(2)} (prev 7d)`
  } else if (hasCplTrend && cplPct >= watchPct) {
    category = "watch"
    insight = `CPL rising ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} (7d) from €${kpi.prevCpl.toFixed(2)} (prev 7d)`
  } else if (kpi.leads > 0) {
    category = "good"
    const parts: string[] = []
    if (hasCplTrend && cplPct < -10) {
      parts.push(`CPL dropped ${Math.abs(cplPct).toFixed(0)}% to €${kpi.cpl.toFixed(2)} (7d)`)
    } else if (hasCplTrend && cplPct >= -10 && cplPct < 10) {
      parts.push(`CPL stable at €${kpi.cpl.toFixed(2)} (7d)`)
    } else if (kpi.cpl > 0) {
      parts.push(`CPL €${kpi.cpl.toFixed(2)} (7d)`)
    }
    parts.push(`${kpi.leads} leads from €${kpi.adSpend.toFixed(0)} spend (7d)`)
    if (kpi.appointments > 0) parts.push(`${kpi.appointments} appts (7d)`)
    insight = parts.join(" · ")
  } else {
    category = "good"
    insight = "Running — no leads yet (7d)"
  }

  // Recent-window override — the shortest trustworthy window beats the 7d verdict.
  // We only flip on a recovery (action → watch) or a fresh spike (good → watch);
  // watch stays watch in both directions because it's already the "monitor" bucket.
  const recent = getRecentSignal(kpi)
  if (recent && kpi.prevCpl > 0) {
    const recentVsPrev = recent.recentCpl / kpi.prevCpl
    const win = `last ${recent.windowDays}d`

    // Recovery: 7d still flags Action but recent CPL is at/below baseline. The spike
    // already passed — demote to Watch so the Action bucket only shows live problems.
    if (category === "action" && recentVsPrev <= RECOVERY_RATIO) {
      return {
        category: "watch",
        insight: `CPL recovered — €${kpi.cpl.toFixed(2)} (7d) but €${recent.recentCpl.toFixed(2)} (${win}) ≈ €${kpi.prevCpl.toFixed(2)} (prev 7d) baseline. Monitor.`,
      }
    }

    // Fresh spike: 7d still looks fine but the last 1-3d are running hot. Promote
    // good → watch so the CM catches it before the 7d average catches up.
    if (
      category === "good" &&
      recentVsPrev >= FRESH_SPIKE_RATIO &&
      recent.recentSpend >= FRESH_SPIKE_MIN_SPEND
    ) {
      return {
        category: "watch",
        insight: `Fresh CPL spike — €${recent.recentCpl.toFixed(2)} (${win}) vs €${kpi.prevCpl.toFixed(2)} (prev 7d). 7d avg still €${kpi.cpl.toFixed(2)}.`,
      }
    }

    // Watch + recovery: keep in Watch but rewrite the insight so the CM sees the
    // recovery context instead of the now-stale 7d framing.
    if (category === "watch" && recentVsPrev <= RECOVERY_RATIO) {
      return {
        category: "watch",
        insight: `CPL recovering — €${kpi.cpl.toFixed(2)} (7d) but €${recent.recentCpl.toFixed(2)} (${win}) back at baseline.`,
      }
    }
  }

  return { category, insight }
}

/**
 * Categorize a list of clients and write any bucket transitions to the
 * `watchlist_client_state` table. Idempotent — only writes when a client's
 * category changed (or there's no existing row), so `since_date` stays anchored
 * at the original transition date.
 *
 * Called from two places:
 *   1. The refresh-cache cron (every 30 min) — full set of clients
 *   2. The kpi-summaries `?force=1` path — subset visible to the user, so the
 *      refresh button populates state without waiting for the next cron tick.
 *
 * The categorize logic only needs `metaAdAccountId` from the client object, so
 * the input type is the minimal `StateWritableClient` rather than the full
 * `MondayClient` — both cron and kpi-summaries can satisfy it.
 */
export type StateWritableClient = {
  mondayItemId: string
  metaAdAccountId: string | null
}

export async function updateWatchlistClientState(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  clients: StateWritableClient[],
  kpiSummaries: Record<string, KpiSummary>,
): Promise<{ written: number }> {
  if (clients.length === 0) return { written: 0 }

  const today = new Date().toISOString().slice(0, 10)
  const itemIds = clients.map((c) => c.mondayItemId)

  const { data: existingRows } = await supabase
    .from("watchlist_client_state")
    .select("monday_item_id, category, since_date")
    .in("monday_item_id", itemIds)

  const existing = new Map<string, { category: string; since_date: string }>()
  for (const row of existingRows ?? []) {
    existing.set(row.monday_item_id, { category: row.category, since_date: row.since_date })
  }

  const upserts: Array<{ monday_item_id: string; category: string; prev_category: string | null; since_date: string; updated_at: string }> = []
  const nowIso = new Date().toISOString()

  for (const client of clients) {
    const kpi = kpiSummaries[client.mondayItemId]
    // categorize() takes a full MondayClient; only `metaAdAccountId` and `mondayItemId`
    // are read, so a minimal cast is safe here.
    const { category } = categorize(client as MondayClient, kpi)
    const prev = existing.get(client.mondayItemId)

    if (!prev) {
      upserts.push({ monday_item_id: client.mondayItemId, category, prev_category: null, since_date: today, updated_at: nowIso })
    } else if (prev.category !== category) {
      upserts.push({ monday_item_id: client.mondayItemId, category, prev_category: prev.category, since_date: today, updated_at: nowIso })
    }
  }

  if (upserts.length === 0) return { written: 0 }

  const { error } = await supabase
    .from("watchlist_client_state")
    .upsert(upserts, { onConflict: "monday_item_id" })
  if (error) {
    console.error("watchlist_client_state upsert failed:", error.message)
    return { written: 0 }
  }
  return { written: upserts.length }
}
