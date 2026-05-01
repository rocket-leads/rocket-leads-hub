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

import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { createAdminClient } from "@/lib/supabase/server"

export type WatchCategory = "action" | "watch" | "good" | "no-data"

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
 * CPA was previously included in the worst-case calculation but is left out for
 * now — see the file header for context on the appointment-data reliability gap.
 */
export function severityScore(kpi: KpiSummary): number {
  const spend = kpi.adSpend
  if (spend > 50 && kpi.leads === 0) return spend * 3

  const cplPct = kpi.prevCpl > 0 ? Math.abs((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0
  return spend * Math.max(cplPct / 30, 1)
}

export function categorize(client: MondayClient, kpi: KpiSummary | undefined): { category: WatchCategory; insight: string } {
  if (kpi?.rlAccountNoCampaign) {
    return { category: "no-data", insight: "RL ad account — no campaigns selected. Pick campaigns in client settings to start tracking." }
  }

  if (!client.metaAdAccountId) {
    return { category: "no-data", insight: "No Meta ad account configured for this client." }
  }

  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { category: "no-data", insight: "No spend or leads in the last 7d — campaign paused, ad account issue, or genuinely idle." }
  }

  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return { category: "action", insight: `€${kpi.adSpend.toFixed(0)} spent, 0 leads in 7d` }
  }

  // CPL is the only trend driving categorization for now. CPA branches were removed
  // because appointment data is too sparse to be a reliable signal — see file header.
  const hasCplTrend = kpi.cpl > 0 && kpi.prevCpl > 0
  const cplPct = hasCplTrend ? ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0

  const { watchPct, actionPct } = getThresholds(kpi.adSpend)

  if (hasCplTrend && cplPct >= actionPct) {
    return { category: "action", insight: `CPL up ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} vs €${kpi.prevCpl.toFixed(2)} prev week` }
  }
  if (hasCplTrend && cplPct >= watchPct) {
    return { category: "watch", insight: `CPL rising ${cplPct.toFixed(0)}% — €${kpi.cpl.toFixed(2)} from €${kpi.prevCpl.toFixed(2)}` }
  }

  if (kpi.leads > 0) {
    const parts: string[] = []
    if (hasCplTrend && cplPct < -10) {
      parts.push(`CPL dropped ${Math.abs(cplPct).toFixed(0)}% to €${kpi.cpl.toFixed(2)}`)
    } else if (hasCplTrend && cplPct >= -10 && cplPct < 10) {
      parts.push(`CPL stable at €${kpi.cpl.toFixed(2)}`)
    } else if (kpi.cpl > 0) {
      parts.push(`CPL €${kpi.cpl.toFixed(2)}`)
    }
    parts.push(`${kpi.leads} leads from €${kpi.adSpend.toFixed(0)} spend`)
    if (kpi.appointments > 0) parts.push(`${kpi.appointments} appts`)
    return { category: "good", insight: parts.join(" · ") }
  }

  return { category: "good", insight: "Running — no leads yet" }
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
