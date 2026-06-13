import { EXPECTED_CRONS, type ExpectedCron } from "@/lib/crons"

/**
 * Hub-feature view of the cron registry. The Health tab uses this to answer
 * the only question the user actually has: "which parts of the Hub are
 * working, and which aren't?". Each feature rolls up the status of the crons
 * that feed it - a single noisy retry on one cron is a feature "hiccup", not
 * a "broken feature".
 */
export type HubFeature = {
  id: string
  name: string
  description: string
  cronNames: string[]
}

export const HUB_FEATURES: ReadonlyArray<HubFeature> = [
  {
    id: "watchlist",
    name: "Watch List numbers",
    description: "KPI tiles, CPL deltas and verdicts shown on the Watch List.",
    cronNames: ["refresh-kpi", "refresh-cache", "refresh-watchlist-context"],
  },
  {
    id: "billing",
    name: "Billing summaries",
    description: "Stripe invoices, payment-overdue states and invoice-readiness verdicts.",
    cronNames: ["refresh-billing-summaries", "refresh-invoice-readiness"],
  },
  {
    id: "pedro",
    name: "Pedro AI insights",
    description: "Per-client optimisation proposals, vertical patterns and auto-generated inbox tasks.",
    cronNames: [
      "refresh-proposals",
      "refresh-pedro-insights",
      "refresh-pedro-patterns",
      "pedro-auto-tasks",
      "pedro-knowledge-proposals",
    ],
  },
  {
    id: "inbox",
    name: "Inbox automations",
    description: "Snooze + auto-resolve rules and the Trengo private-inbox poll.",
    cronNames: ["inbox-automations", "pull-trengo-private-channels"],
  },
  {
    id: "slack",
    name: "Slack notifications",
    description: "Team posts and personal DMs for watchlist + sales updates.",
    cronNames: [
      "slack-team-watchlist",
      "slack-daily-watchlist",
      "slack-team-sales",
      "slack-personal-sales",
    ],
  },
] as const

export type CronStatus = "ok" | "hiccup" | "broken" | "never_ran"

export type CronVerdict = {
  cron: ExpectedCron
  status: CronStatus
  /** ms since last run started, or null if never ran */
  ageMs: number | null
  errorMessage: string | null
}

/** Classify a single cron run.
 *
 *  - `ok` is always ok, regardless of age. Many crons are gated (Slack
 *    posts only fire at certain hours; inbox-automations only writes a
 *    row when work happens) so multi-hour gaps between OK rows are normal
 *    and not a "stuck" signal. The watchdog cron handles real stuck
 *    detection separately and surfaces via its own alert channel.
 *  - `error` / `partial` within 2× cadence is a hiccup (retry incoming),
 *    past that window it's broken.
 *  - `never_ran` is left as-is so the UI can decide how loudly to surface
 *    it (some crons in EXPECTED_CRONS may simply not be deployed yet). */
export function classifyCron(
  cron: ExpectedCron,
  latestRun:
    | { status: "ok" | "error" | "partial"; started_at: string; error_message: string | null }
    | undefined,
  now: number,
): CronVerdict {
  if (!latestRun) {
    return { cron, status: "never_ran", ageMs: null, errorMessage: null }
  }

  const ageMs = now - new Date(latestRun.started_at).getTime()

  if (latestRun.status === "ok") {
    return { cron, status: "ok", ageMs, errorMessage: null }
  }

  const cadenceMs = cron.cadenceMinutes * 60_000
  const stale = ageMs > 2 * cadenceMs
  return {
    cron,
    status: stale ? "broken" : "hiccup",
    ageMs,
    errorMessage: latestRun.error_message,
  }
}

export type FeatureStatus = "working" | "hiccup" | "broken"

export type FeatureVerdict = {
  feature: HubFeature
  status: FeatureStatus
  crons: CronVerdict[]
  /** Most recent successful run across the feature's crons, in ms ago */
  freshAgeMs: number | null
  /** Plain-English explanation of the current state */
  summary: string
}

/** Roll a feature's crons up into a single verdict.
 *
 *  Rule: as long as ONE cron in the feature has a fresh OK row, the
 *  feature is "running". Other failing crons inside the same feature
 *  downgrade it to "hiccup" (a sub-job is flaking) but never to "broken"
 *  — broken means "no data is flowing".
 *
 *  Roy 2026-06-13: previous version called Watch List + Pedro + Slack
 *  "broken" even though their primary crons were ticking happily,
 *  because a secondary cron in the same group was never_ran or failing.
 *  That's noise — the features actually work, the user can see fresh
 *  numbers — so we only escalate to broken when nothing is fresh. */
export function rollUpFeature(
  feature: HubFeature,
  verdicts: Map<string, CronVerdict>,
): FeatureVerdict {
  const crons: CronVerdict[] = feature.cronNames
    .map((n) => verdicts.get(n))
    .filter((v): v is CronVerdict => v !== undefined)

  let freshAgeMs: number | null = null
  let worstBroken: CronVerdict | null = null
  let worstHiccup: CronVerdict | null = null
  let neverRanCount = 0
  let neverRanExample: CronVerdict | null = null

  for (const v of crons) {
    if (v.status === "ok" && v.ageMs !== null) {
      if (freshAgeMs === null || v.ageMs < freshAgeMs) freshAgeMs = v.ageMs
    } else if (v.status === "broken") {
      if (!worstBroken) worstBroken = v
    } else if (v.status === "hiccup") {
      if (!worstHiccup) worstHiccup = v
    } else if (v.status === "never_ran") {
      neverRanCount++
      if (!neverRanExample) neverRanExample = v
    }
  }

  const hasFreshOk = freshAgeMs !== null
  const hasIssue = !!(worstBroken || worstHiccup || neverRanCount > 0)

  let status: FeatureStatus
  if (hasFreshOk && !hasIssue) {
    status = "working"
  } else if (hasFreshOk) {
    // Primary cron is fresh; something secondary is failing → hiccup
    status = "hiccup"
  } else if (worstBroken) {
    status = "broken"
  } else if (worstHiccup) {
    status = "hiccup"
  } else {
    // All never_ran, nothing failing outright. Probably not deployed.
    status = "broken"
  }

  const summary = buildSummary(status, hasFreshOk, freshAgeMs, worstBroken, worstHiccup, neverRanCount, neverRanExample)
  return { feature, status, crons, freshAgeMs, summary }
}

function buildSummary(
  status: FeatureStatus,
  hasFreshOk: boolean,
  freshAgeMs: number | null,
  worstBroken: CronVerdict | null,
  worstHiccup: CronVerdict | null,
  neverRanCount: number,
  neverRanExample: CronVerdict | null,
): string {
  if (status === "working") {
    if (freshAgeMs === null) return "Running."
    return `Running. Last refreshed ${humanAge(freshAgeMs)} ago.`
  }
  if (status === "hiccup") {
    // hasFreshOk == true → primary works, something secondary is off
    if (hasFreshOk && worstBroken) {
      const msg = worstBroken.errorMessage ? `: ${truncate(worstBroken.errorMessage, 90)}` : ""
      return `Running (refreshed ${humanAge(freshAgeMs!)} ago). One sub-job is failing${msg}.`
    }
    if (hasFreshOk && worstHiccup) {
      return `Running (refreshed ${humanAge(freshAgeMs!)} ago). One sub-job hiccupped, will retry.`
    }
    if (hasFreshOk && neverRanCount > 0) {
      return `Running (refreshed ${humanAge(freshAgeMs!)} ago). ${neverRanCount} background cron hasn't recorded a run yet.`
    }
    if (worstHiccup) {
      const msg = worstHiccup.errorMessage ? `: ${truncate(worstHiccup.errorMessage, 90)}` : ""
      return `One run failed${msg}. Will retry on its next tick.`
    }
    return "Temporary hiccup, will retry on the next run."
  }
  // broken — no fresh data at all
  if (worstBroken) {
    const msg = worstBroken.errorMessage ? `: ${truncate(worstBroken.errorMessage, 120)}` : ""
    const ageStr = worstBroken.ageMs !== null ? `, failing for ${humanAge(worstBroken.ageMs)}` : ""
    return `Broken${ageStr}${msg}. Action needed.`
  }
  if (neverRanCount > 0 && neverRanExample) {
    if (neverRanCount === 1) {
      return `\`${neverRanExample.cron.name}\` has never recorded a run. May not be deployed yet.`
    }
    return `${neverRanCount} crons have never recorded a run. They may not be deployed yet.`
  }
  return "Not running."
}

function humanAge(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 36) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}

/** Roll up the wall of recent error rows by cron + error message. The
 *  Health tab today shows 30 individual rows for what's usually 2-3 actual
 *  problems repeating every retry tick. */
export type ErrorGroup = {
  cronName: string
  count: number
  firstSeen: string
  lastSeen: string
  uniqueMessages: string[]
}

export function rollUpErrors(
  rows: Array<{
    cron_name: string
    status: string
    started_at: string
    error_message: string | null
  }>,
): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()
  for (const row of rows) {
    const existing = groups.get(row.cron_name)
    const msg = row.error_message ?? "(no message)"
    if (!existing) {
      groups.set(row.cron_name, {
        cronName: row.cron_name,
        count: 1,
        firstSeen: row.started_at,
        lastSeen: row.started_at,
        uniqueMessages: [msg],
      })
    } else {
      existing.count++
      if (row.started_at > existing.lastSeen) existing.lastSeen = row.started_at
      if (row.started_at < existing.firstSeen) existing.firstSeen = row.started_at
      if (!existing.uniqueMessages.includes(msg)) {
        existing.uniqueMessages.push(msg)
      }
    }
  }
  return Array.from(groups.values()).sort((a, b) =>
    b.lastSeen.localeCompare(a.lastSeen),
  )
}

/** Overall health verdict for the top banner. */
export function overallVerdict(features: FeatureVerdict[]): {
  status: FeatureStatus
  brokenCount: number
  hiccupCount: number
} {
  let brokenCount = 0
  let hiccupCount = 0
  for (const f of features) {
    if (f.status === "broken") brokenCount++
    else if (f.status === "hiccup") hiccupCount++
  }
  return {
    status: brokenCount > 0 ? "broken" : hiccupCount > 0 ? "hiccup" : "working",
    brokenCount,
    hiccupCount,
  }
}

export { EXPECTED_CRONS }
