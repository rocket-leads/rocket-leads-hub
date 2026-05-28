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
import type { ClientStatus } from "@/lib/clients/status"

export type WatchCategory = "action" | "watch" | "good" | "no-data"

/** Optional context that lets categorize/severityScore detect the
 *  "Live but no spend yesterday" trigger. Pass when callers know the
 *  Hub-canonical status — without it the live-but-dark path is silently
 *  skipped (existing call sites keep working unchanged). */
export type CategorizeExtras = {
  clientStatus?: ClientStatus | null
  /** Override "today" for deterministic tests. */
  now?: Date
  /** Active manual override — when present and not expired (7d max OR KPI
   *  shift >25% from snapshot), the categorizer short-circuits and returns
   *  this bucket with an override insight string instead of the rules-based
   *  verdict. The state-route already filters out time-expired overrides;
   *  the KPI-shift check happens here because we need the live KPI snapshot. */
  manualOverride?: ManualOverrideExtras | null
  /** AI-suggested adjustment derived from past CM overrides — applied only
   *  when no hard manual override is active. Lets the categorizer "learn"
   *  from accumulated overrides without retraining: the cron computes per
   *  client whether the team would likely have moved this row based on
   *  precedent, and stashes the suggestion here. */
  aiAdjustment?: AiAdjustmentExtras | null
}

export type ManualOverrideExtras = {
  category: "action" | "watch" | "good"
  reason: string
  overriddenAt: string
  expiresAt: string
  kpiSnapshot: {
    adSpend?: number | null
    leads?: number | null
    cpl?: number | null
    prevCpl?: number | null
    cpa?: number | null
    appts?: number | null
  } | null
}

export type AiAdjustmentExtras = {
  /** Bucket the AI thinks fits better than the rules-based verdict. Only
   *  applied when confidence ≥ AI_ADJUSTMENT_MIN_CONFIDENCE. */
  suggestedCategory: "action" | "watch" | "good"
  /** Short rationale referencing the override patterns the AI matched. */
  reason: string
  /** 0–1, how confident the AI is the pattern applies. */
  confidence: number
}

/** Threshold above which AI adjustment overrides the rules-based verdict.
 *  Conservative on purpose — better to leave the rules verdict alone than
 *  to confuse the CM by silently moving rows on a weak signal. */
const AI_ADJUSTMENT_MIN_CONFIDENCE = 0.75

/** Relative KPI shift that invalidates a manual override before its 7d TTL.
 *  Matches the 25% noise threshold defined in knowledge/campaigns.md — once
 *  CPL or spend moves beyond ruis, the snapshot the CM was looking at is no
 *  longer the data we have, and the override should release. */
const OVERRIDE_KPI_SHIFT_RATIO = 0.25

/** Returns true when the live KPI's CPL or spend has moved more than
 *  OVERRIDE_KPI_SHIFT_RATIO away from the snapshot. Either direction counts
 *  — a 30% improvement also means "this isn't the situation you were
 *  looking at anymore." */
function overrideStillFitsKpi(
  snapshot: ManualOverrideExtras["kpiSnapshot"],
  live: KpiSummary | undefined,
): boolean {
  if (!snapshot || !live) return true // no snapshot or no live data → trust the time-based TTL
  const shiftedBeyondNoise = (snap: number | null | undefined, now: number | null | undefined): boolean => {
    if (snap == null || snap <= 0) return false
    if (now == null) return false
    const ratio = Math.abs(now - snap) / snap
    return ratio > OVERRIDE_KPI_SHIFT_RATIO
  }
  if (shiftedBeyondNoise(snapshot.cpl, live.cpl)) return false
  if (shiftedBeyondNoise(snapshot.adSpend, live.adSpend)) return false
  return true
}

/** Severity floor applied when the live-but-dark trigger fires, so these
 *  clients always sort above CPL-spike severity in Action Needed. The
 *  number is intentionally well above realistic spend × CPL-delta scores. */
export const LIVE_BUT_DARK_SEVERITY_FLOOR = 10_000

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
  manual_override: {
    en: (reason: string, daysLeft: number) =>
      `Manual override · ${daysLeft}d left — ${reason}`,
    nl: (reason: string, daysLeft: number) =>
      `Handmatige override · nog ${daysLeft}d — ${reason}`,
  },
  ai_adjustment: {
    en: (reason: string, confidencePct: number, baseInsight: string) =>
      `AI adjustment (${confidencePct}% match) — ${reason} · rules said: ${baseInsight}`,
    nl: (reason: string, confidencePct: number, baseInsight: string) =>
      `AI bijstelling (${confidencePct}% match) — ${reason} · regels zeiden: ${baseInsight}`,
  },
  recent_window_label: {
    en: (n: 1 | 2 | 3) => `last ${n}d`,
    nl: (n: 1 | 2 | 3) => `laatste ${n}d`,
  },
  live_but_dark: {
    en: "Live but no spend yesterday — campaign likely paused in Meta.",
    nl: "Live maar geen spend gisteren — campagne staat waarschijnlijk uit in Meta.",
  },
  // ─── HomeTab Health-vs-baseline strings ──────────────────────────────
  // Selected window vs 30d baseline. Always carries both window labels so
  // the user knows what's being compared and contradictions with the KPI
  // cards above are impossible.
  hb_cpl_spike: {
    en: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL up ${pct}% — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL omhoog ${pct}% — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_cpl_dropped: {
    en: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL down ${pct}% — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL omlaag ${pct}% — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_cpl_stable: {
    en: (cur: string, curWin: string, base: string, baseWin: string) =>
      `CPL stable — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string) =>
      `CPL stabiel — €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_no_leads_with_spend: {
    en: (spend: string, win: string) => `€${spend} (${win}) spent, 0 leads`,
    nl: (spend: string, win: string) => `€${spend} (${win}) uitgegeven, 0 leads`,
  },
  hb_no_spend_either: {
    en: (win: string) => `No spend or leads (${win}) — campaign paused, ad account issue, or idle.`,
    nl: (win: string) => `Geen spend of leads (${win}) — campagne gepauzeerd, ad account probleem, of inactief.`,
  },
  hb_no_baseline: {
    en: (cur: string, curWin: string, baseWin: string) =>
      `CPL €${cur} (${curWin}) — not enough baseline activity (${baseWin}) to compare yet`,
    nl: (cur: string, curWin: string, baseWin: string) =>
      `CPL €${cur} (${curWin}) — nog onvoldoende baseline-activiteit (${baseWin}) om te vergelijken`,
  },
  // Baseline drift warning — appended to the main insight when the baseline
  // window is itself notably worse than the long-baseline. Tells the user
  // the "improvement" they see vs baseline isn't necessarily real; they may
  // just be back to a still-degraded number from a worse-degraded one.
  hb_baseline_drifted: {
    en: (base: string, baseWin: string, longBase: string, longWin: string, pct: string) =>
      `⚠ ${baseWin} baseline €${base} is itself ${pct}% above €${longBase} (${longWin}) — structurally off-track`,
    nl: (base: string, baseWin: string, longBase: string, longWin: string, pct: string) =>
      `⚠ ${baseWin} baseline €${base} ligt zelf ${pct}% boven €${longBase} (${longWin}) — structureel off-track`,
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

/**
 * "Live but dark" — Hub status = Live but no spend on the most recent
 * complete day (yesterday UTC). Likely a campaign paused in Meta while
 * the Hub status still says Live. Binary signal, no thresholds.
 *
 * Returns `false` when:
 *  - status is not Live (onboarding / on_hold / churned / null skip cleanly)
 *  - dailyTrend is missing (kpi cache absent — can't tell)
 *  - the last dailyTrend entry isn't actually yesterday (stale data — don't false-alarm)
 *  - the last entry has spend > 0
 */
export function detectLiveButDark(
  kpi: KpiSummary | undefined,
  extras: CategorizeExtras | undefined,
): boolean {
  if (!extras || extras.clientStatus !== "live") return false
  // If the Meta fetch failed for this client during the most recent cron, we
  // genuinely don't know whether the client is dark — every dailyTrend day
  // would be 0 simply because we have no data. Treating that as "dark"
  // blanket-flagged every Live client as Action on the Meta outage of
  // 2026-05-28 and the morning Slack digest reported 47 action / 0 healthy.
  if (kpi?.metaFetchFailed) return false
  const trend = kpi?.dailyTrend
  if (!trend || trend.length === 0) return false
  const last = trend[trend.length - 1]
  const now = extras.now ?? new Date()
  const yesterdayUtc = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  if (last.date !== yesterdayUtc) return false
  return last.spend === 0
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
export function severityScore(kpi: KpiSummary, extras?: CategorizeExtras): number {
  // Live-but-dark gets a fixed floor so it sorts above CPL-spike severity in
  // Action Needed. The CPL math below would otherwise score 0 (no spend
  // yesterday means tiny spend on the day that matters), pushing these
  // clients to the bottom of the bucket — the opposite of what we want.
  if (detectLiveButDark(kpi, extras)) return LIVE_BUT_DARK_SEVERITY_FLOOR

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
  extras?: CategorizeExtras,
): { category: WatchCategory; insight: string } {
  // Manual override beats every rules-based check below — that's the entire
  // point of the override system. The state-route already filters out
  // time-expired overrides; we additionally check the KPI snapshot here so
  // the override releases the moment the data the CM was looking at has
  // moved beyond ruis (the 25% threshold defined in knowledge/campaigns.md).
  // We do NOT re-categorize on snapshot drift — we just step aside and let
  // the rules verdict take over.
  if (extras?.manualOverride && overrideStillFitsKpi(extras.manualOverride.kpiSnapshot, kpi)) {
    const m = extras.manualOverride
    const daysLeft = Math.max(
      0,
      Math.ceil((new Date(m.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    )
    return {
      category: m.category,
      insight: INSIGHT_STRINGS.manual_override[locale](m.reason, daysLeft),
    }
  }

  if (kpi?.rlAccountNoCampaign) {
    return { category: "no-data", insight: INSIGHT_STRINGS.rl_no_campaign[locale] }
  }

  if (!client.metaAdAccountId) {
    return { category: "no-data", insight: INSIGHT_STRINGS.no_meta_account[locale] }
  }

  // Live-but-dark fires BEFORE the no-spend-no-leads no-data check, because a
  // client that's been completely off for a week would otherwise sink into
  // no-data instead of surfacing as the urgent "campaign paused while Hub
  // still says Live" signal we want.
  if (detectLiveButDark(kpi, extras)) {
    return { category: "action", insight: INSIGHT_STRINGS.live_but_dark[locale] }
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

  // AI adjustment — applied last, only when no hard manual override is active
  // (the early return above handles that case). The cron computes per client
  // whether the team has consistently overridden similar situations in the
  // past 30d and stashes a suggestion in extras. When confidence is high
  // enough we apply it; otherwise the rules verdict stands.
  //
  // This is the "learning" half of the feedback loop: every time a CM hits
  // the Move button, the audit log grows. The next cron tick feeds the new
  // examples into the AI which may now recognise the same pattern on a
  // different client — surfacing the suggested bucket without any human
  // intervention. The more overrides logged, the better the suggestions get.
  if (
    extras?.aiAdjustment &&
    extras.aiAdjustment.confidence >= AI_ADJUSTMENT_MIN_CONFIDENCE &&
    extras.aiAdjustment.suggestedCategory !== category
  ) {
    return {
      category: extras.aiAdjustment.suggestedCategory,
      insight: INSIGHT_STRINGS.ai_adjustment[locale](
        extras.aiAdjustment.reason,
        Math.round(extras.aiAdjustment.confidence * 100),
        insight,
      ),
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
  /** Per-client Hub status map. When provided, enables the live-but-dark
   *  override in categorize(). When absent, behaviour matches the previous
   *  implementation exactly (no live-but-dark flag, no false alarms). */
  statusByClient?: Map<string, ClientStatus | null>,
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
  let skippedDueToMetaFailure = 0

  for (const client of clients) {
    const kpi = kpiSummaries[client.mondayItemId]
    // Skip clients whose Meta fetch failed this run — categorize() would have
    // forced them into the "no-data" or live-but-dark paths with zero-spend
    // input that doesn't reflect reality, and the resulting state write would
    // poison the morning Slack digest the next time it reads this table.
    // Preserve the prior categorization until the next successful fetch.
    if (kpi?.metaFetchFailed) {
      skippedDueToMetaFailure++
      continue
    }
    const clientStatus = statusByClient?.get(client.mondayItemId) ?? null
    // categorize() takes a full MondayClient; only `metaAdAccountId` and `mondayItemId`
    // are read, so a minimal cast is safe here.
    const { category } = categorize(
      client as MondayClient,
      kpi,
      "en",
      statusByClient ? { clientStatus } : undefined,
    )
    const prev = existing.get(client.mondayItemId)

    if (!prev) {
      upserts.push({ monday_item_id: client.mondayItemId, category, prev_category: null, since_date: today, updated_at: nowIso })
    } else if (prev.category !== category) {
      upserts.push({ monday_item_id: client.mondayItemId, category, prev_category: prev.category, since_date: today, updated_at: nowIso })
    }
  }

  if (skippedDueToMetaFailure > 0) {
    console.warn(
      `[watchlist_client_state] skipped ${skippedDueToMetaFailure}/${clients.length} client state writes — Meta fetch failed for those clients. Prior state preserved.`,
    )
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

/**
 * Home tab Health card categorizer. Compares the user-selected window's CPL
 * against a longer-window baseline (typically 30d). The big difference from
 * `categorize()` above: every emitted insight string includes BOTH window
 * labels inline, so the Health card on the slide-over can never contradict
 * the KPI cards next to it. ("CPL €383 (7d) vs €20.44 baseline (30d) — up
 * 1775%" — you immediately see which lens is which.)
 *
 * This is intentionally separate from `categorize()`:
 *  - `categorize` runs cross-client on the Watch List, always 7d vs prev-7d
 *  - `categorizeHealthVsBaseline` runs per-client on the slide-over, selected
 *    vs 30d baseline, with explicit window labels
 *
 * Kept locale-aware via the same INSIGHT_STRINGS table so output language
 * mirrors the rest of the Health card chrome.
 */
/** Baseline-drift detection thresholds. Any baseline CPL more than
 *  `DRIFT_PCT_THRESHOLD`% above the long-baseline (typically 90d) triggers
 *  the drift warning. 25% mirrors the Watch List noise band — anything
 *  smaller is normal Meta wobble, not a structural shift. */
const DRIFT_PCT_THRESHOLD = 25

export function categorizeHealthVsBaseline(args: {
  currentCpl: number
  currentLeads: number
  currentSpend: number
  currentWindowLabel: string
  baselineCpl: number
  baselineLeads: number
  baselineSpend: number
  baselineWindowLabel: string
  /** Optional long-window reference (typically 90d). When provided AND the
   *  shorter baseline is materially higher than this, the insight is
   *  extended with a "baseline drifted high" warning so a "good" verdict
   *  against a degraded baseline doesn't read as genuine recovery. Also
   *  downgrades the category from `good` → `watch` in that case. */
  longBaselineCpl?: number
  longBaselineLeads?: number
  longBaselineSpend?: number
  longBaselineWindowLabel?: string
  /** When the user picked a long range (≥ baseline window length), there's no
   *  meaningful baseline to compare against. Pass true to suppress comparison
   *  and show a plain "current CPL" insight instead. */
  suppressComparison?: boolean
  locale?: CategorizeLocale
}): { category: WatchCategory; insight: string } {
  const locale = args.locale ?? "en"

  // No activity in either window — nothing useful to say beyond "idle".
  if (args.currentSpend === 0 && args.currentLeads === 0) {
    return {
      category: "no-data",
      insight: INSIGHT_STRINGS.hb_no_spend_either[locale](args.currentWindowLabel),
    }
  }

  // Spend without leads in the current window — always action (€ burning).
  if (args.currentSpend > 0 && args.currentLeads === 0) {
    return {
      category: "action",
      insight: INSIGHT_STRINGS.hb_no_leads_with_spend[locale](
        args.currentSpend.toFixed(0),
        args.currentWindowLabel,
      ),
    }
  }

  // Suppressed (selected range overlaps / equals baseline) OR baseline has
  // insufficient activity to compare against — emit a "no baseline yet"
  // insight so the user knows why no delta is shown.
  if (
    args.suppressComparison ||
    args.baselineLeads === 0 ||
    args.baselineSpend === 0 ||
    args.baselineCpl <= 0
  ) {
    return {
      category: "good",
      insight: INSIGHT_STRINGS.hb_no_baseline[locale](
        args.currentCpl.toFixed(2),
        args.currentWindowLabel,
        args.baselineWindowLabel,
      ),
    }
  }

  // We have both signals — compute the delta and pick a bucket. Thresholds
  // mirror the Watch List's: ±25% is normal Meta noise, 25-50% is "watch",
  // 50%+ is "action".
  const pctChange = ((args.currentCpl - args.baselineCpl) / args.baselineCpl) * 100
  const absPct = Math.abs(pctChange)

  let category: WatchCategory
  if (absPct < 25) {
    category = "good"
  } else if (pctChange < 0) {
    // CPL dropped >25% — that's good news, not a concern.
    category = "good"
  } else if (pctChange < 50) {
    category = "watch"
  } else {
    category = "action"
  }

  // Pick the right insight string variant based on direction + magnitude.
  let insight: string
  if (absPct < 25) {
    insight = INSIGHT_STRINGS.hb_cpl_stable[locale](
      args.currentCpl.toFixed(2),
      args.currentWindowLabel,
      args.baselineCpl.toFixed(2),
      args.baselineWindowLabel,
    )
  } else if (pctChange > 0) {
    insight = INSIGHT_STRINGS.hb_cpl_spike[locale](
      args.currentCpl.toFixed(2),
      args.currentWindowLabel,
      args.baselineCpl.toFixed(2),
      args.baselineWindowLabel,
      pctChange.toFixed(0),
    )
  } else {
    insight = INSIGHT_STRINGS.hb_cpl_dropped[locale](
      args.currentCpl.toFixed(2),
      args.currentWindowLabel,
      args.baselineCpl.toFixed(2),
      args.baselineWindowLabel,
      absPct.toFixed(0),
    )
  }

  // Baseline-drift cross-check. When the long baseline has real activity and
  // the shorter baseline is materially above it, we're comparing against a
  // degraded reference period — a "down 50%" verdict here is recovery from
  // bad, not return to good. Append a warning to the insight AND downgrade
  // a `good` verdict to `watch` so the user can't read it as all-clear.
  const longCpl = args.longBaselineCpl ?? 0
  const longLeads = args.longBaselineLeads ?? 0
  const longSpend = args.longBaselineSpend ?? 0
  const longLabel = args.longBaselineWindowLabel
  if (longLabel && longCpl > 0 && longLeads > 0 && longSpend > 0) {
    const driftPct = ((args.baselineCpl - longCpl) / longCpl) * 100
    if (driftPct > DRIFT_PCT_THRESHOLD) {
      insight = `${insight}. ${INSIGHT_STRINGS.hb_baseline_drifted[locale](
        args.baselineCpl.toFixed(2),
        args.baselineWindowLabel,
        longCpl.toFixed(2),
        longLabel,
        driftPct.toFixed(0),
      )}`
      if (category === "good") category = "watch"
    }
  }

  return { category, insight }
}
