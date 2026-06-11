// Watch List bucket logic - shared between the UI (live categorization on the dashboard)
// and the cron (state-table updates). Keep this module pure and dependency-free so it
// can run on both server and client without dragging in fetch/auth machinery.
//
// Buckets:
//   - action   : urgent - CPL spike above the action threshold, or zero leads with spend
//   - watch    : trending wrong - CPL rising above the watch threshold but not yet action-grade
//   - good     : healthy - has leads, CPL stable or improving
//   - no-data  : nothing actionable to compute (no spend & no leads, or no Meta account)
//
// Baseline: we compare current 7d against the structural 30d baseline (days 8-37 back).
// Roy 2026-06-09: switched from prev-7d because chronic problems were invisible - a
// client running at €50 CPL for a month had a prev-7d baseline of €50, so a week at
// €95 looked like a spike that "recovered" the moment the last 2 days returned to €50.
// The €50 baseline was itself the problem; the 30d window catches that, and the 90d
// long baseline acts as a drift cross-check (if the 30d itself drifted high, the
// recovery demote is blocked - the client is structurally off-track, not just noisy).
//
// CPA (cost per appointment) is intentionally excluded from this signal path - Monday
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
//   - action + recovery   → watch  ("CPL spiked but recovered to baseline - monitor")
//   - good   + fresh spike → watch  ("CPL spiking last 1-3d while 7d still calm")
// The recovery demote is BLOCKED when the 30d baseline is itself drifted high vs 90d
// - recovery to a structurally-bad baseline isn't recovery, it's "back to still bad."
//
// Fallback: when baselineCpl is missing (older cached entries, or live-fetch path that
// didn't compute baselines) we fall back to prevCpl. Categorize() never crashes; worst
// case is a single cron tick of pre-baseline behaviour until the cache rewrites.

import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { createAdminClient } from "@/lib/supabase/server"
import type { ClientStatus } from "@/lib/clients/status"
import type { BillingHealthVerdict } from "@/lib/clients/billing-health"

export type WatchCategory = "action" | "watch" | "good" | "no-data"

/** Optional context that lets categorize/severityScore detect the
 *  "Live but no spend yesterday" trigger. Pass when callers know the
 *  Hub-canonical status - without it the live-but-dark path is silently
 *  skipped (existing call sites keep working unchanged). */
export type CategorizeExtras = {
  clientStatus?: ClientStatus | null
  /** Override "today" for deterministic tests. */
  now?: Date
  /** Active manual override - when present and not expired (7d max OR KPI
   *  shift >25% from snapshot), the categorizer short-circuits and returns
   *  this bucket with an override insight string instead of the rules-based
   *  verdict. The state-route already filters out time-expired overrides;
   *  the KPI-shift check happens here because we need the live KPI snapshot. */
  manualOverride?: ManualOverrideExtras | null
  /** AI-suggested adjustment derived from past CM overrides - applied only
   *  when no hard manual override is active. Lets the categorizer "learn"
   *  from accumulated overrides without retraining: the cron computes per
   *  client whether the team would likely have moved this row based on
   *  precedent, and stashes the suggestion here. */
  aiAdjustment?: AiAdjustmentExtras | null
  /** Meta ad-account billing-health verdict. When `hasIssue` is true, the
   *  categorizer short-circuits to `action` with a billing-specific
   *  insight - this fires ABOVE every other check (manual override
   *  excepted) because a payment problem makes CPL/CPA/spend signals
   *  noise. The whole reason Roy wants this is that a billing error
   *  reads as "high CPL" in the existing rules and gets the wrong
   *  recommendation. */
  billingHealth?: BillingHealthVerdict | null
  /** Open action loop - CM acted on this client and is monitoring for the
   *  configured review window. While the window is open the categorizer
   *  short-circuits to `watch` ("in review") with an insight summarising
   *  what was done. The override sits between billing_health and the
   *  KPI-based rules: a new billing failure during the window still
   *  surfaces, but live-but-dark / CPL spikes get suppressed (the CM is
   *  already on it). The cron is what closes the loop - when review_due_at
   *  passes, it re-runs categorize() WITHOUT this extra and stamps the
   *  outcome; if the client still rules-as Action, it flips back. */
  activeAction?: ActiveActionExtras | null
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

/** Five canonical action categories, mirroring the Optimisation Proposal
 *  classes documented in knowledge/campaigns.md. Persisted as enum strings
 *  in watchlist_actions.action_category. */
export type ActionCategory = "creative" | "pause" | "angle" | "funnel" | "other"

export type ActiveActionExtras = {
  id: string
  category: ActionCategory
  /** What the CM did - displayed verbatim in the insight (truncated by UI). */
  actionText: string
  /** ISO timestamp - when the action was logged. */
  createdAt: string
  /** ISO timestamp - when the cron re-checks this client. */
  reviewDueAt: string
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
 *  Conservative on purpose - better to leave the rules verdict alone than
 *  to confuse the CM by silently moving rows on a weak signal. */
const AI_ADJUSTMENT_MIN_CONFIDENCE = 0.75

/** Relative KPI shift that invalidates a manual override before its 7d TTL.
 *  Matches the 25% noise threshold defined in knowledge/campaigns.md - once
 *  CPL or spend moves beyond ruis, the snapshot the CM was looking at is no
 *  longer the data we have, and the override should release. */
const OVERRIDE_KPI_SHIFT_RATIO = 0.25

/** Returns true when the live KPI's CPL or spend has moved more than
 *  OVERRIDE_KPI_SHIFT_RATIO away from the snapshot. Either direction counts
 *  - a 30% improvement also means "this isn't the situation you were
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

/** Severity floor for billing-health issues - set above the live-but-dark
 *  floor so a confirmed billing problem (Meta API explicit signal) sorts
 *  above "no spend yesterday" cases in Action Needed. A billing error
 *  affects the whole account, not just one campaign - it's the most
 *  urgent class of signal we have. */
export const BILLING_ERROR_SEVERITY_FLOOR = 50_000
export const BILLING_UNDERSPEND_SEVERITY_FLOOR = 20_000

/** Locale-bound insight strings for categorize(). Inlined here rather than
 *  routed through the global dictionary so this foundational module stays
 *  free of the UI-layer i18n dependency. Currently English + Dutch only -
 *  match LOCALES in lib/i18n/types if we ever add a third. */
type CategorizeLocale = "nl" | "en"

const INSIGHT_STRINGS = {
  rl_no_campaign: {
    en: "RL ad account - no campaigns selected. Pick campaigns in client settings to start tracking.",
    nl: "RL ad account - geen campagnes geselecteerd. Kies campagnes in client-instellingen om tracking te starten.",
  },
  no_meta_account: {
    en: "No Meta ad account configured for this client.",
    nl: "Geen Meta ad account geconfigureerd voor deze klant.",
  },
  no_spend_or_leads: {
    en: "No spend or leads (7d) - campaign paused, ad account issue, or genuinely idle.",
    nl: "Geen spend of leads (7d) - campagne gepauzeerd, ad account probleem, of echt inactief.",
  },
  no_leads_with_spend: {
    en: (spend: string) => `€${spend} spent, 0 leads (7d)`,
    nl: (spend: string) => `€${spend} uitgegeven, 0 leads (7d)`,
  },
  cpl_up: {
    en: (pct: string, cpl: string, prev: string, baseLabel: string) =>
      `CPL up ${pct}% - €${cpl} (7d) vs €${prev} (${baseLabel} baseline)`,
    nl: (pct: string, cpl: string, prev: string, baseLabel: string) =>
      `CPL omhoog ${pct}% - €${cpl} (7d) vs €${prev} (${baseLabel} baseline)`,
  },
  cpl_rising: {
    en: (pct: string, cpl: string, prev: string, baseLabel: string) =>
      `CPL rising ${pct}% - €${cpl} (7d) from €${prev} (${baseLabel} baseline)`,
    nl: (pct: string, cpl: string, prev: string, baseLabel: string) =>
      `CPL stijgt ${pct}% - €${cpl} (7d) van €${prev} (${baseLabel} baseline)`,
  },
  baseline_label: {
    en: (kind: "long" | "short") => (kind === "long" ? "30d" : "prev 7d"),
    nl: (kind: "long" | "short") => (kind === "long" ? "30d" : "vorige 7d"),
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
    en: "Running - no leads yet (7d)",
    nl: "Loopt - nog geen leads (7d)",
  },
  cpl_recovered: {
    en: (cpl7d: string, recent: string, win: string, baseline: string, baseLabel: string) =>
      `CPL recovered - €${cpl7d} (7d) but €${recent} (${win}) ≈ €${baseline} (${baseLabel} baseline). Monitor.`,
    nl: (cpl7d: string, recent: string, win: string, baseline: string, baseLabel: string) =>
      `CPL hersteld - €${cpl7d} (7d) maar €${recent} (${win}) ≈ €${baseline} (${baseLabel} baseline). Monitoren.`,
  },
  /** Fired when last-1-3d returned to the 30d baseline BUT the 30d itself is
   *  drifted high vs 90d - the "recovery" isn't real, the client is
   *  structurally off-track. Stays Action instead of demoting to Watch. */
  cpl_recovered_but_drifted: {
    en: (cpl7d: string, recent: string, win: string, baseline: string, longBaseline: string, driftPct: string) =>
      `CPL recovered to drifted baseline - €${cpl7d} (7d), €${recent} (${win}) ≈ €${baseline} (30d) but 30d is ${driftPct}% above €${longBaseline} (90d). Structurally off-track.`,
    nl: (cpl7d: string, recent: string, win: string, baseline: string, longBaseline: string, driftPct: string) =>
      `CPL terug op gedrifte baseline - €${cpl7d} (7d), €${recent} (${win}) ≈ €${baseline} (30d) maar 30d ligt ${driftPct}% boven €${longBaseline} (90d). Structureel off-track.`,
  },
  fresh_spike: {
    en: (recent: string, win: string, baseline: string, cpl7d: string, baseLabel: string) =>
      `Fresh CPL spike - €${recent} (${win}) vs €${baseline} (${baseLabel} baseline). 7d avg still €${cpl7d}.`,
    nl: (recent: string, win: string, baseline: string, cpl7d: string, baseLabel: string) =>
      `Verse CPL spike - €${recent} (${win}) vs €${baseline} (${baseLabel} baseline). 7d gemiddelde nog €${cpl7d}.`,
  },
  cpl_recovering: {
    en: (cpl7d: string, recent: string, win: string) =>
      `CPL recovering - €${cpl7d} (7d) but €${recent} (${win}) back at baseline.`,
    nl: (cpl7d: string, recent: string, win: string) =>
      `CPL herstelt - €${cpl7d} (7d) maar €${recent} (${win}) terug op baseline.`,
  },
  manual_override: {
    en: (reason: string, daysLeft: number) =>
      `Manual override · ${daysLeft}d left - ${reason}`,
    nl: (reason: string, daysLeft: number) =>
      `Handmatige override · nog ${daysLeft}d - ${reason}`,
  },
  action_in_review: {
    en: (catLabel: string, daysSince: number, daysUntilReview: number, actionText: string) =>
      `Acted ${daysSince}d ago (${catLabel}) · re-eval over ${daysUntilReview}d - ${actionText}`,
    nl: (catLabel: string, daysSince: number, daysUntilReview: number, actionText: string) =>
      `${daysSince}d geleden behandeld (${catLabel}) · her-eval over ${daysUntilReview}d - ${actionText}`,
  },
  action_category_label: {
    en: {
      creative: "creative iteration",
      pause: "ad paused",
      angle: "new angle",
      funnel: "funnel change",
      other: "other",
    } as Record<ActionCategory, string>,
    nl: {
      creative: "creative iteratie",
      pause: "ad gepauzeerd",
      angle: "nieuwe angle",
      funnel: "funnel aanpassing",
      other: "overig",
    } as Record<ActionCategory, string>,
  },
  ai_adjustment: {
    en: (reason: string, confidencePct: number, baseInsight: string) =>
      `AI adjustment (${confidencePct}% match) - ${reason} · rules said: ${baseInsight}`,
    nl: (reason: string, confidencePct: number, baseInsight: string) =>
      `AI bijstelling (${confidencePct}% match) - ${reason} · regels zeiden: ${baseInsight}`,
  },
  recent_window_label: {
    en: (n: 1 | 2 | 3) => `last ${n}d`,
    nl: (n: 1 | 2 | 3) => `laatste ${n}d`,
  },
  live_but_dark: {
    en: "Live but no spend yesterday - campaign likely paused in Meta.",
    nl: "Live maar geen spend gisteren - campagne staat waarschijnlijk uit in Meta.",
  },
  billing_error_direct: {
    en: (statusLabel: string, spend: string, expected: string | null) =>
      expected
        ? `Billing error - Meta account: ${statusLabel}. €${spend} spent (7d) vs €${expected} expected. Contact client.`
        : `Billing error - Meta account: ${statusLabel}. €${spend} spent (7d). Contact client.`,
    nl: (statusLabel: string, spend: string, expected: string | null) =>
      expected
        ? `Betaalfout - Meta account: ${statusLabel}. €${spend} uitgegeven (7d) vs €${expected} verwacht. Klant contacten.`
        : `Betaalfout - Meta account: ${statusLabel}. €${spend} uitgegeven (7d). Klant contacten.`,
  },
  billing_error_underspend: {
    en: (spend: string, expected: string, pct: string) =>
      `Severe underspend - €${spend} spent (7d) vs €${expected} expected (${pct}% of plan). Likely billing error - contact client.`,
    nl: (spend: string, expected: string, pct: string) =>
      `Forse onderbesteding - €${spend} uitgegeven (7d) vs €${expected} verwacht (${pct}% van plan). Waarschijnlijk betaalfout - klant contacten.`,
  },
  // ─── HomeTab Health-vs-baseline strings ──────────────────────────────
  // Selected window vs 30d baseline. Always carries both window labels so
  // the user knows what's being compared and contradictions with the KPI
  // cards above are impossible.
  hb_cpl_spike: {
    en: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL up ${pct}% - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL omhoog ${pct}% - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_cpl_dropped: {
    en: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL down ${pct}% - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string, pct: string) =>
      `CPL omlaag ${pct}% - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_cpl_stable: {
    en: (cur: string, curWin: string, base: string, baseWin: string) =>
      `CPL stable - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
    nl: (cur: string, curWin: string, base: string, baseWin: string) =>
      `CPL stabiel - €${cur} (${curWin}) vs €${base} baseline (${baseWin})`,
  },
  hb_no_leads_with_spend: {
    en: (spend: string, win: string) => `€${spend} (${win}) spent, 0 leads`,
    nl: (spend: string, win: string) => `€${spend} (${win}) uitgegeven, 0 leads`,
  },
  hb_no_spend_either: {
    en: (win: string) => `No spend or leads (${win}) - campaign paused, ad account issue, or idle.`,
    nl: (win: string) => `Geen spend of leads (${win}) - campagne gepauzeerd, ad account probleem, of inactief.`,
  },
  hb_no_baseline: {
    en: (cur: string, curWin: string, baseWin: string) =>
      `CPL €${cur} (${curWin}) - not enough baseline activity (${baseWin}) to compare yet`,
    nl: (cur: string, curWin: string, baseWin: string) =>
      `CPL €${cur} (${curWin}) - nog onvoldoende baseline-activiteit (${baseWin}) om te vergelijken`,
  },
  // Baseline drift warning - appended to the main insight when the baseline
  // window is itself notably worse than the long-baseline. Tells the user
  // the "improvement" they see vs baseline isn't necessarily real; they may
  // just be back to a still-degraded number from a worse-degraded one.
  hb_baseline_drifted: {
    en: (base: string, baseWin: string, longBase: string, longWin: string, pct: string) =>
      `⚠ ${baseWin} baseline €${base} is itself ${pct}% above €${longBase} (${longWin}) - structurally off-track`,
    nl: (base: string, baseWin: string, longBase: string, longWin: string, pct: string) =>
      `⚠ ${baseWin} baseline €${base} ligt zelf ${pct}% boven €${longBase} (${longWin}) - structureel off-track`,
  },
} as const

/**
 * Recent CPL from the shortest trustworthy window (1d → 2d → 3d). "Trustworthy"
 * means the window has at least 2 leads and >€0 spend - anything thinner is too
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
 * "Live but dark" - Hub status = Live but no spend on the most recent
 * complete day (yesterday UTC). Likely a campaign paused in Meta while
 * the Hub status still says Live. Binary signal, no thresholds.
 *
 * Returns `false` when:
 *  - status is not Live (onboarding / on_hold / churned / null skip cleanly)
 *  - dailyTrend is missing (kpi cache absent - can't tell)
 *  - the last dailyTrend entry isn't actually yesterday (stale data - don't false-alarm)
 *  - the last entry has spend > 0
 */
export function detectLiveButDark(
  kpi: KpiSummary | undefined,
  extras: CategorizeExtras | undefined,
): boolean {
  if (!extras || extras.clientStatus !== "live") return false
  // If the Meta fetch failed for this client during the most recent cron, we
  // genuinely don't know whether the client is dark - every dailyTrend day
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

/** Recent CPL within 25% of the baseline = recovered. */
const RECOVERY_RATIO = 1.25
/** Recent CPL ≥1.5× baseline while 7d hasn't tripped Watch yet = fresh spike. */
const FRESH_SPIKE_RATIO = 1.5
/** Min spend in the recent window before we'll promote good → watch on a fresh spike. */
const FRESH_SPIKE_MIN_SPEND = 30

/** 30d baseline ≥1.25× 90d long-baseline ⇒ structurally drifted high - the
 *  client has been off-track for weeks, not just last week. Mirrors the 25%
 *  noise threshold used everywhere else. */
const BASELINE_DRIFT_RATIO = 1.25

/**
 * Resolve which baseline CPL to compare against. Prefers the 30d structural
 * baseline (added 2026-06-09) when present + reliable; falls back to prev-7d
 * for back-compat with older cached entries and the live-fetch path that
 * doesn't compute long baselines.
 *
 * Returns null when neither is usable - caller treats that as "no trend
 * available, default to good if there are leads."
 */
export function resolveBaselineCpl(
  kpi: KpiSummary,
): { cpl: number; kind: "long" | "short" } | null {
  if (kpi.baselineCpl && kpi.baselineCpl > 0 && kpi.baselineReliable !== false) {
    return { cpl: kpi.baselineCpl, kind: "long" }
  }
  if (kpi.prevCpl > 0) {
    return { cpl: kpi.prevCpl, kind: "short" }
  }
  return null
}

/**
 * True when the 30d baseline is itself materially worse than the 90d long
 * baseline - a "recovery to 30d" verdict shouldn't release the action flag
 * because the 30d is degraded. Returns false when long-baseline data is
 * missing or unreliable (no signal, no blocker).
 */
export function isBaselineDrifted(kpi: KpiSummary): boolean {
  if (!kpi.baselineCpl || kpi.baselineCpl <= 0) return false
  if (!kpi.longBaselineCpl || kpi.longBaselineCpl <= 0) return false
  if (kpi.longBaselineReliable === false) return false
  return kpi.baselineCpl >= kpi.longBaselineCpl * BASELINE_DRIFT_RATIO
}

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
 * now - see the file header for context on the appointment-data reliability gap.
 */
export function severityScore(kpi: KpiSummary, extras?: CategorizeExtras): number {
  // Billing issues outrank everything else - Meta API has directly told
  // us (or the underspend math strongly implies) the account isn't
  // paying. Sort above live-but-dark because billing-error explains the
  // dark case too and is more specific.
  if (extras?.billingHealth?.hasIssue) {
    return extras.billingHealth.severity === "billing_error"
      ? BILLING_ERROR_SEVERITY_FLOOR
      : BILLING_UNDERSPEND_SEVERITY_FLOOR
  }

  // Live-but-dark gets a fixed floor so it sorts above CPL-spike severity in
  // Action Needed. The CPL math below would otherwise score 0 (no spend
  // yesterday means tiny spend on the day that matters), pushing these
  // clients to the bottom of the bucket - the opposite of what we want.
  if (detectLiveButDark(kpi, extras)) return LIVE_BUT_DARK_SEVERITY_FLOOR

  const spend = kpi.adSpend
  if (spend > 50 && kpi.leads === 0) return spend * 3

  const baseline = resolveBaselineCpl(kpi)
  const cplPct = baseline ? Math.abs((kpi.cpl - baseline.cpl) / baseline.cpl) * 100 : 0
  let score = spend * Math.max(cplPct / 30, 1)

  // Recovery dampener only fires when the baseline isn't itself drifted high
  // - a drifted-baseline "recovery" is recovery-to-still-bad, not real
  // recovery, so don't sink severity in that case.
  if (baseline && !isBaselineDrifted(kpi)) {
    const recent = getRecentSignal(kpi)
    if (recent && recent.recentCpl <= baseline.cpl * RECOVERY_RATIO) {
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
  // Manual override beats every rules-based check below - that's the entire
  // point of the override system. The state-route already filters out
  // time-expired overrides; we additionally check the KPI snapshot here so
  // the override releases the moment the data the CM was looking at has
  // moved beyond ruis (the 25% threshold defined in knowledge/campaigns.md).
  // We do NOT re-categorize on snapshot drift - we just step aside and let
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

  // Billing-health override - fires above every KPI-based check because a
  // payment problem makes CPL/CPA/spend signals meaningless. Roy's
  // example: €50 spend on a €2k/mo budget reads as "high CPL" in the
  // CPL-rule below, but the real story is "card got declined, contact
  // client". Two flavours:
  //   - "billing_error"  → Meta API directly reports account_status=
  //     disabled/unsettled/grace-period. Hard signal.
  //   - "severe_underspend" → 7d spend <40% of expected weekly budget
  //     with ≥3 active days. Soft signal but typically a billing issue
  //     Meta hasn't labelled at the account level yet (declined card on
  //     a single campaign, expired payment method, etc).
  if (extras?.billingHealth?.hasIssue && kpi) {
    const bh = extras.billingHealth
    const spend = kpi.adSpend.toFixed(0)
    const expected = bh.expectedWeeklyBudget != null ? bh.expectedWeeklyBudget.toFixed(0) : null

    if (bh.severity === "billing_error" && bh.metaHealth) {
      return {
        category: "action",
        insight: INSIGHT_STRINGS.billing_error_direct[locale](
          bh.metaHealth.accountStatusLabel,
          spend,
          expected,
        ),
      }
    }
    if (bh.severity === "severe_underspend" && expected != null && bh.spendRatio != null) {
      return {
        category: "action",
        insight: INSIGHT_STRINGS.billing_error_underspend[locale](
          spend,
          expected,
          (bh.spendRatio * 100).toFixed(0),
        ),
      }
    }
  }

  // Active action loop - CM marked done + is monitoring. While the review
  // window is open, the row sits in Watchlist with an "in review" insight
  // instead of whatever the KPI rules below would say. Two reasons to keep
  // this above live-but-dark + KPI rules:
  //   1. A pause-action will legitimately make the client read as
  //      live-but-dark on the next cron tick - that's expected, not urgent.
  //   2. A creative-iteration won't move CPL for 24-48h - the CM doesn't
  //      need a "CPL still high" alert during the window they explicitly
  //      asked to wait.
  // What it does NOT suppress: manual_override + billing_health, which
  // both fire above this. A new billing failure DURING the window is a
  // new urgent signal that the CM's action didn't address.
  if (extras?.activeAction) {
    const a = extras.activeAction
    const nowMs = (extras.now ?? new Date()).getTime()
    const reviewMs = new Date(a.reviewDueAt).getTime()
    if (Number.isFinite(reviewMs) && reviewMs > nowMs) {
      const createdMs = new Date(a.createdAt).getTime()
      const daysSince = Math.max(0, Math.floor((nowMs - createdMs) / (24 * 60 * 60 * 1000)))
      const daysUntilReview = Math.max(0, Math.ceil((reviewMs - nowMs) / (24 * 60 * 60 * 1000)))
      const catLabel = INSIGHT_STRINGS.action_category_label[locale][a.category]
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.action_in_review[locale](
          catLabel,
          daysSince,
          daysUntilReview,
          a.actionText,
        ),
      }
    }
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
  // would mean leads exist). Always Action - no recovery override applies.
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return {
      category: "action",
      insight: INSIGHT_STRINGS.no_leads_with_spend[locale](kpi.adSpend.toFixed(0)),
    }
  }

  // CPL is the only trend driving categorization for now. CPA branches were removed
  // because appointment data is too sparse to be a reliable signal - see file header.
  // Baseline = 30d structural (preferred) with prev-7d fallback for back-compat.
  const baseline = resolveBaselineCpl(kpi)
  const hasCplTrend = kpi.cpl > 0 && baseline != null
  const baselineCplValue = baseline?.cpl ?? 0
  const baselineLabel = INSIGHT_STRINGS.baseline_label[locale](baseline?.kind ?? "long")
  const cplPct = hasCplTrend ? ((kpi.cpl - baselineCplValue) / baselineCplValue) * 100 : 0
  const { watchPct, actionPct } = getThresholds(kpi.adSpend)

  const cpl2 = kpi.cpl.toFixed(2)
  const baselineCpl2 = baselineCplValue.toFixed(2)
  const cplPctAbs = Math.abs(cplPct).toFixed(0)
  const cplPctSigned = cplPct.toFixed(0)

  // Compute the 7d-vs-baseline verdict first; the recent-window override flips it
  // afterwards.
  let category: WatchCategory
  let insight: string

  if (hasCplTrend && cplPct >= actionPct) {
    category = "action"
    insight = INSIGHT_STRINGS.cpl_up[locale](cplPctSigned, cpl2, baselineCpl2, baselineLabel)
  } else if (hasCplTrend && cplPct >= watchPct) {
    category = "watch"
    insight = INSIGHT_STRINGS.cpl_rising[locale](cplPctSigned, cpl2, baselineCpl2, baselineLabel)
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

  // Recent-window override - the shortest trustworthy window beats the 7d verdict.
  // We only flip on a recovery (action → watch) or a fresh spike (good → watch);
  // watch stays watch in both directions because it's already the "monitor" bucket.
  //
  // BUT: when the 30d baseline is itself drifted high vs the 90d long baseline,
  // a "recovery to baseline" is recovery-to-still-bad, not real recovery - we
  // block the action→watch demote and replace the insight with the drift call-out.
  // Roy 2026-06-09 case: ZoomX at €50 CPL for a month, spike to €95 last 7d,
  // last 2d back to €50. Old logic: demote to Watch. New logic: stays Action
  // because €50 baseline is structurally elevated vs the longer-term norm.
  const recent = getRecentSignal(kpi)
  if (recent && baseline) {
    const recentVsBaseline = recent.recentCpl / baseline.cpl
    const win = INSIGHT_STRINGS.recent_window_label[locale](recent.windowDays)
    const recentCpl2 = recent.recentCpl.toFixed(2)
    const drifted = isBaselineDrifted(kpi)

    if (category === "action" && recentVsBaseline <= RECOVERY_RATIO) {
      if (drifted && kpi.longBaselineCpl && kpi.baselineCpl) {
        // Recovery to a drifted baseline isn't recovery - stays Action with a
        // drift-aware insight so the CM sees why the demote was suppressed.
        const driftPct = (((kpi.baselineCpl - kpi.longBaselineCpl) / kpi.longBaselineCpl) * 100).toFixed(0)
        return {
          category: "action",
          insight: INSIGHT_STRINGS.cpl_recovered_but_drifted[locale](
            cpl2,
            recentCpl2,
            win,
            baselineCpl2,
            kpi.longBaselineCpl.toFixed(2),
            driftPct,
          ),
        }
      }
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.cpl_recovered[locale](cpl2, recentCpl2, win, baselineCpl2, baselineLabel),
      }
    }

    if (
      category === "good" &&
      recentVsBaseline >= FRESH_SPIKE_RATIO &&
      recent.recentSpend >= FRESH_SPIKE_MIN_SPEND
    ) {
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.fresh_spike[locale](recentCpl2, win, baselineCpl2, cpl2, baselineLabel),
      }
    }

    if (category === "watch" && recentVsBaseline <= RECOVERY_RATIO) {
      return {
        category: "watch",
        insight: INSIGHT_STRINGS.cpl_recovering[locale](cpl2, recentCpl2, win),
      }
    }
  }

  // AI adjustment - applied last, only when no hard manual override is active
  // (the early return above handles that case). The cron computes per client
  // whether the team has consistently overridden similar situations in the
  // past 30d and stashes a suggestion in extras. When confidence is high
  // enough we apply it; otherwise the rules verdict stands.
  //
  // This is the "learning" half of the feedback loop: every time a CM hits
  // the Move button, the audit log grows. The next cron tick feeds the new
  // examples into the AI which may now recognise the same pattern on a
  // different client - surfacing the suggested bucket without any human
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
 * `watchlist_client_state` table. Idempotent - only writes when a client's
 * category changed (or there's no existing row), so `since_date` stays anchored
 * at the original transition date.
 *
 * Called from two places:
 *   1. The refresh-cache cron (every 30 min) - full set of clients
 *   2. The kpi-summaries `?force=1` path - subset visible to the user, so the
 *      refresh button populates state without waiting for the next cron tick.
 *
 * The categorize logic only needs `metaAdAccountId` from the client object, so
 * the input type is the minimal `StateWritableClient` rather than the full
 * `MondayClient` - both cron and kpi-summaries can satisfy it.
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
  /** Per-client billing-health verdicts (keyed by mondayItemId). When
   *  provided, enables the billing-issue override in categorize() so
   *  the state-table directly reflects payment problems as `action`. */
  billingHealthByClient?: Record<string, BillingHealthVerdict>,
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
    // Skip clients whose Meta fetch failed this run - categorize() would have
    // forced them into the "no-data" or live-but-dark paths with zero-spend
    // input that doesn't reflect reality, and the resulting state write would
    // poison the morning Slack digest the next time it reads this table.
    // Preserve the prior categorization until the next successful fetch.
    if (kpi?.metaFetchFailed) {
      skippedDueToMetaFailure++
      continue
    }
    const clientStatus = statusByClient?.get(client.mondayItemId) ?? null
    const billingHealth = billingHealthByClient?.[client.mondayItemId] ?? null
    // categorize() takes a full MondayClient; only `metaAdAccountId` and `mondayItemId`
    // are read, so a minimal cast is safe here.
    const { category } = categorize(
      client as MondayClient,
      kpi,
      "en",
      statusByClient || billingHealth ? { clientStatus, billingHealth } : undefined,
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
      `[watchlist_client_state] skipped ${skippedDueToMetaFailure}/${clients.length} client state writes - Meta fetch failed for those clients. Prior state preserved.`,
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
 * the KPI cards next to it. ("CPL €383 (7d) vs €20.44 baseline (30d) - up
 * 1775%" - you immediately see which lens is which.)
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
 *  the drift warning. 25% mirrors the Watch List noise band - anything
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

  // No activity in either window - nothing useful to say beyond "idle".
  if (args.currentSpend === 0 && args.currentLeads === 0) {
    return {
      category: "no-data",
      insight: INSIGHT_STRINGS.hb_no_spend_either[locale](args.currentWindowLabel),
    }
  }

  // Spend without leads in the current window - always action (€ burning).
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
  // insufficient activity to compare against - emit a "no baseline yet"
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

  // We have both signals - compute the delta and pick a bucket. Thresholds
  // mirror the Watch List's: ±25% is normal Meta noise, 25-50% is "watch",
  // 50%+ is "action".
  const pctChange = ((args.currentCpl - args.baselineCpl) / args.baselineCpl) * 100
  const absPct = Math.abs(pctChange)

  let category: WatchCategory
  if (absPct < 25) {
    category = "good"
  } else if (pctChange < 0) {
    // CPL dropped >25% - that's good news, not a concern.
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
  // degraded reference period - a "down 50%" verdict here is recovery from
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
