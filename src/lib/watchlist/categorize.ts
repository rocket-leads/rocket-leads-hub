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

/** Locale-bound insight strings for categorize(). Inlined here rather than
 *  routed through the global dictionary so this foundational module stays
 *  free of the UI-layer i18n dependency. Currently English + Dutch only —
 *  match LOCALES in lib/i18n/types if we ever add a third. */
type CategorizeLocale = "nl" | "en"

const INSIGHT_STRINGS = {
  rl_no_campaign: {
    en: "RL ad account — no campaigns selected. Pick campaigns in client settings to start tracking.",
    nl: "RL ad account — geen campagnes geselecteerd. Kies campagnes in client-instellingen om tracking te starten.",
  },
  no_meta_account: {
    en: "No Meta ad account configured for this client.",
    nl: "Geen Meta ad account geconfigureerd voor deze klant.",
  },
  no_spend_or_leads: {
    en: "No spend or leads (7d) — campaign paused, ad account issue, or genuinely idle.",
    nl: "Geen spend of leads (7d) — campagne gepauzeerd, ad account probleem, of echt inactief.",
  },
  no_leads_with_spend: {
    en: (spend: string) => `€${spend} spent, 0 leads (7d)`,
    nl: (spend: string) => `€${spend} uitgegeven, 0 leads (7d)`,
  },
  cpl_up: {
    en: (pct: string, cpl: string, prev: string) =>
      `CPL up ${pct}% — €${cpl} (7d) vs €${prev} (prev 7d)`,
    nl: (pct: string, cpl: string, prev: string) =>
      `CPL omhoog ${pct}% — €${cpl} (7d) vs €${prev} (vorige 7d)`,
  },
  cpl_rising: {
    en: (pct: string, cpl: string, prev: string) =>
      `CPL rising ${pct}% — €${cpl} (7d) from €${prev} (prev 7d)`,
    nl: (pct: string, cpl: string, prev: string) =>
      `CPL stijgt ${pct}% — €${cpl} (7d) van €${prev} (vorige 7d)`,
  },
  cpl_dropped: {
    en: (pct: string, cpl: string) => `CPL dropped ${pct}% to €${cpl} (7d)`,
    nl: (pct: string, cpl: string) => `CPL daalde ${pct}% naar €${cpl} (7d)`,
  },
  cpl_stable: {
    en: (cpl: string) => `CPL stable at €${cpl} (7d)`,
    nl: (cpl: string) => `CPL stabiel op €${cpl} (7d)`,
  },
  cpl_plain: {
    en: (cpl: string) => `CPL €${cpl} (7d)`,
    nl: (cpl: string) => `CPL €${cpl} (7d)`,
  },
  leads_from_spend: {
    en: (leads: number, spend: string) => `${leads} leads from €${spend} spend (7d)`,
    nl: (leads: number, spend: string) => `${leads} leads uit €${spend} spend (7d)`,
  },
  appts_count: {
    en: (n: number) => `${n} appts (7d)`,
    nl: (n: number) => `${n} appts (7d)`,
  },
  running_no_leads: {
    en: "Running — no leads yet (7d)",
    nl: "Loopt — nog geen leads (7d)",
  },
  cpl_recovered: {
    en: (cpl7d: string, recent: string, win: string, baseline: string) =>
      `CPL recovered — €${cpl7d} (7d) but €${recent} (${win}) ≈ €${baseline} (prev 7d) baseline. Monitor.`,
    nl: (cpl7d: string, recent: string, win: string, baseline: string) =>
      `CPL hersteld — €${cpl7d} (7d) maar €${recent} (${win}) ≈ €${baseline} (vorige 7d) baseline. Monitoren.`,
  },
  fresh_spike: {
    en: (recent: string, win: string, baseline: string, cpl7d: string) =>
      `Fresh CPL spike — €${recent} (${win}) vs €${baseline} (prev 7d). 7d avg still €${cpl7d}.`,
    nl: (recent: string, win: string, baseline: string, cpl7d: string) =>
      `Verse CPL spike — €${recent} (${win}) vs €${baseline} (vorige 7d). 7d gemiddelde nog €${cpl7d}.`,
  },
  cpl_recovering: {
    en: (cpl7d: string, recent: string, win: string) =>
      `CPL recovering — €${cpl7d} (7d) but €${recent} (${win}) back at baseline.`,
    nl: (cpl7d: string, recent: string, win: string) =>
      `CPL herstelt — €${cpl7d} (7d) maar €${recent} (${win}) terug op baseline.`,
  },
  recent_window_label: {
    en: (n: 1 | 2 | 3) => `last ${n}d`,
    nl: (n: 1 | 2 | 3) => `laatste ${n}d`,
  },
} as const

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

/**
 * `categorize` defaults locale to 'en' so existing AI-prompt call sites
 * (registry user prompts, watchlist narrative facts block, etc) keep
 * receiving English without needing to thread locale through. The Watch
 * List UI passes the user's locale explicitly to localise insight cells.
 */
export function categorize(
  client: MondayClient,
  kpi: KpiSummary | undefined,
  locale: CategorizeLocale = "en",
): { category: WatchCategory; insight: string } {
  if (kpi?.rlAccountNoCampaign) {
    return { category: "no-data", insight: INSIGHT_STRINGS.rl_no_campaign[locale] }
  }

  if (!client.metaAdAccountId) {
    return { category: "no-data", insight: INSIGHT_STRINGS.no_meta_account[locale] }
  }

  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { category: "no-data", insight: INSIGHT_STRINGS.no_spend_or_leads[locale] }
  }

  // Zero-leads-with-spend is unrecoverable by definition (a recent window with leads
  // would mean leads exist). Always Action — no recovery override applies.
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return {
      category: "action",
      insight: INSIGHT_STRINGS.no_leads_with_spend[locale](kpi.adSpend.toFixed(0)),
    }
  }

  // CPL is the only trend driving categorization for now. CPA branches were removed
  // because appointment data is too sparse to be a reliable signal — see file header.
  const hasCplTrend = kpi.cpl > 0 && kpi.prevCpl > 0
  const cplPct = hasCplTrend ? ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100 : 0
  const { watchPct, actionPct } = getThresholds(kpi.adSpend)

  const cpl2 = kpi.cpl.toFixed(2)
  const prevCpl2 = kpi.prevCpl.toFixed(2)
  const cplPctAbs = Math.abs(cplPct).toFixed(0)
  const cplPctSigned = cplPct.toFixed(0)

  // Compute the 7d-only verdict first; the recent-window override flips it afterwards.
  let category: WatchCategory
  let insight: string

  if (hasCplTrend && cplPct >= actionPct) {
    category = "action"
    insight = INSIGHT_STRINGS.cpl_up[locale](cplPctSigned, cpl2, prevCpl2)
  } else if (hasCplTrend && cplPct >= watchPct) {
    category = "watch"
    insight = INSIGHT_STRINGS.cpl_rising[locale](cplPctSigned, cpl2, prevCpl2)
  } else if (kpi.leads > 0) {
    category = "good"
    const parts: string[] = []
    if (hasCplTrend && cplPct < -10) {
      parts.push(INSIGHT_STRINGS.cpl_dropped[locale](cplPctAbs, cpl2))
    } else if (hasCplTrend && cplPct >= -10 && cplPct < 10) {
      parts.push(INSIGHT_STRINGS.cpl_stable[locale](cpl2))
    } else if (kpi.cpl > 0) {
      parts.push(INSIGHT_STRINGS.cpl_plain[locale](cpl2))
    }
    parts.push(INSIGHT_STRINGS.leads_from_spend[locale](kpi.leads, kpi.adSpend.toFixed(0)))
    if (kpi.appointments > 0) parts.push(INSIGHT_STRINGS.appts_count[locale](kpi.appointments))
    insight = parts.join(" · ")
  } else {
    category = "good"
    insight = INSIGHT_STRINGS.running_no_leads[locale]
  }

  // Recent-window override — the shortest trustworthy window beats the 7d verdict.
  // We only flip on a recovery (action → watch) or a fresh spike (good → watch);
  // watch stays watch in both directions because it's already the "monitor" bucket.
  const recent = getRecentSignal(kpi)
  if (recent && kpi.prevCpl > 0) {
    const recentVsPrev = recent.recentCpl / kpi.prevCpl
    const win = INSIGHT_STRINGS.recent_window_label[locale](recent.windowDays)
    const recentCpl2 = recent.recentCpl.toFixed(2)

    if (category === "action" && recentVsPrev <= RECOVERY_RATIO) {
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.cpl_recovered[locale](cpl2, recentCpl2, win, prevCpl2),
      }
    }

    if (
      category === "good" &&
      recentVsPrev >= FRESH_SPIKE_RATIO &&
      recent.recentSpend >= FRESH_SPIKE_MIN_SPEND
    ) {
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.fresh_spike[locale](recentCpl2, win, prevCpl2, cpl2),
      }
    }

    if (category === "watch" && recentVsPrev <= RECOVERY_RATIO) {
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.cpl_recovering[locale](cpl2, recentCpl2, win),
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
