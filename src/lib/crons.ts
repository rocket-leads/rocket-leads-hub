import type { DictionaryKey } from "@/lib/i18n/dictionary"

/**
 * Single source of truth for every cron the Hub expects to see ticking.
 * Consumed by:
 *   - the Health tab (lists status + cadence per cron)
 *   - the `/api/cron/watchdog` route (alerts when one fails or goes
 *     silent past its expected window)
 *
 * Keep in sync with /api/cron/* directories. Add new crons here so the
 * watchdog notices when they break — otherwise a silent regression to
 * "never ran" looks identical to a brand-new cron that hasn't ticked yet.
 */
export type ExpectedCron = {
  name: string
  description: string
  cadenceKey: DictionaryKey
  /** Approximate expected interval between runs, in minutes. The watchdog
   *  flags a cron as "stuck" when (now - last_started_at) > 1.5 × this. */
  cadenceMinutes: number
}

export const EXPECTED_CRONS: ReadonlyArray<ExpectedCron> = [
  { name: "refresh-kpi", description: "KPI summaries + daily rollup cache", cadenceKey: "settings.health.cadence.daily_5utc", cadenceMinutes: 1440 },
  { name: "refresh-cache", description: "Watch List context, billing, AI proposals overview", cadenceKey: "settings.health.cadence.daily_530utc", cadenceMinutes: 1440 },
  { name: "refresh-billing-summaries", description: "Stripe billing summaries + past invoices", cadenceKey: "settings.health.cadence.hourly", cadenceMinutes: 60 },
  { name: "refresh-invoice-readiness", description: "AI invoice readiness verdicts", cadenceKey: "settings.health.cadence.every_6h", cadenceMinutes: 360 },
  { name: "refresh-proposals", description: "Per-client AI optimisation proposals", cadenceKey: "settings.health.cadence.daily", cadenceMinutes: 1440 },
  { name: "refresh-watchlist-context", description: "Monday updates + Trengo summaries for watchlist AI", cadenceKey: "settings.health.cadence.daily", cadenceMinutes: 1440 },
  { name: "refresh-pedro-patterns", description: "Pedro vertical-pattern synthesis", cadenceKey: "settings.health.cadence.nightly", cadenceMinutes: 1440 },
  { name: "refresh-pedro-insights", description: "Unified Pedro insights cache (replaces watchlist-summaries + per-client AI calls)", cadenceKey: "settings.health.cadence.hourly", cadenceMinutes: 60 },
  { name: "pedro-auto-tasks", description: "Pedro background co-pilot — auto-creates inbox tasks for stuck-in-Action clients (with anti-spam guardrails)", cadenceKey: "settings.health.cadence.daily_7utc", cadenceMinutes: 1440 },
  { name: "pedro-knowledge-proposals", description: "Pedro knowledge-base scan", cadenceKey: "settings.health.cadence.weekly", cadenceMinutes: 10080 },
  { name: "inbox-automations", description: "Inbox snooze / auto-resolve rules", cadenceKey: "settings.health.cadence.hourly", cadenceMinutes: 60 },
  { name: "slack-team-watchlist", description: "Team watchlist Slack post", cadenceKey: "settings.health.cadence.hourly_gated", cadenceMinutes: 60 },
  { name: "slack-daily-watchlist", description: "Personal watchlist Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated", cadenceMinutes: 60 },
  { name: "slack-team-sales", description: "Team sales Slack post", cadenceKey: "settings.health.cadence.hourly_gated", cadenceMinutes: 60 },
  { name: "slack-personal-sales", description: "Personal sales Slack DMs", cadenceKey: "settings.health.cadence.hourly_gated", cadenceMinutes: 60 },
] as const
