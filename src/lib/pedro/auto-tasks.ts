import type { MondayClient } from "@/lib/integrations/monday"
import type { WatchCategory } from "@/lib/watchlist/categorize"

/**
 * Pedro background co-pilot — anti-spam decision logic.
 *
 * The whole point of this module is to make sure Pedro's auto-generated
 * tasks STAY USEFUL. The CM's inbox is the most-trafficked surface in
 * the Hub; flooding it with marginal "review this client" pings would
 * destroy the signal-to-noise ratio that makes the inbox worth opening.
 *
 * Five layered guardrails (each can independently veto a task):
 *
 *   1. Bucket gate — only Action-bucket clients ever generate tasks.
 *      Watch and Good never. Action means CPL spike severe enough to
 *      cross the tier threshold (see watchlist/categorize.ts).
 *
 *   2. Stickiness gate — client must have been in Action ≥2 days. Most
 *      transient spikes recover within 24-48h via the recent-window
 *      override (see categorize.ts), so this filters out ad-hoc noise.
 *
 *   3. Severity gate — only severityScore ≥ ACTION_TASK_THRESHOLD (set
 *      to mirror "real € impact at stake", not "any spike at any spend").
 *      A 50% CPL move on €100 spend is mathematically a spike but not
 *      worth interrupting a CM for.
 *
 *   4. Dedup gate — if there's already an open Pedro task for this
 *      client, or one that was closed by the CM in the last 7 days, no
 *      new task. Pedro doesn't re-nag.
 *
 *   5. Per-CM cap — max 3 open Pedro tasks per assignee at any time.
 *      Hard skip when at cap (we don't displace human prioritisation).
 *
 * All five live in `decideForClient` below as pure logic — testable
 * without DB or Anthropic. The cron is the impure layer that gathers
 * inputs and writes outputs.
 */

/** Minimum severity score before Pedro fires. Calibrated to "this is
 *  worth a CM interruption" not "any deviation". Bumpable if we still
 *  see too many low-impact tasks. */
export const ACTION_TASK_THRESHOLD = 200

/** Minimum days the client must have been in Action before a task is
 *  generated. Most transient CPL spikes recover within 24-48h via the
 *  recent-window override; waiting 2 days filters them out. */
export const MIN_DAYS_IN_BUCKET = 2

/** Hard cap on simultaneous open Pedro tasks per assignee. Soft override
 *  not implemented — when the cap is hit, the new task is skipped. */
export const MAX_OPEN_PEDRO_TASKS_PER_USER = 3

/** A Pedro task closed by a human within this window doesn't get
 *  recreated even if the client is still in Action. Gives the CM
 *  breathing room — they presumably acted on the previous task and
 *  are waiting to see if it worked. */
export const RECENT_CLOSED_DEDUP_DAYS = 7

/** Marker we stamp on inbox_events.source_ref so the cron can
 *  distinguish Pedro auto-tasks from other automation-source events
 *  (existing inbox_automations cron, watchlist alerts, etc). */
export const PEDRO_TASK_MARKER = "pedro_auto_tasks_v1"

// ─── Decision input shape ────────────────────────────────────────────────

export type SkipReason =
  | "not_in_action"
  | "too_fresh"
  | "low_severity"
  | "open_task_exists"
  | "recently_closed"
  | "assignee_at_cap"
  | "no_assignee"

export type ExistingPedroTask = {
  /** open / in_progress / done / cancelled */
  status: string
  /** ISO timestamp; null when not done. */
  completedAt: string | null
}

export type DecideInput = {
  client: MondayClient
  /** Output of categorize() for this client's current KPI snapshot. */
  category: WatchCategory
  /** From the watchlist_client_state table — null when state is unknown. */
  daysInBucket: number | null
  /** Output of severityScore() for this client's KPI summary. */
  severity: number
  /** The Hub user_id who would receive the task — null when no CM/AM
   *  mapping is available. Skipping is preferred over assigning to a
   *  fallback user. */
  assigneeUserId: string | null
  /** The most recent Pedro task for this client (any status). Used by
   *  the dedup + recently-closed gates. */
  existingPedroTask: ExistingPedroTask | null
  /** Count of currently-open Pedro tasks the assignee already holds. */
  openTasksForAssignee: number
  /** ISO timestamp the cron snapshot was taken — passed in for testability. */
  now: string
}

export type Decision =
  | {
      action: "create"
      title: string
      body: string
      assigneeUserId: string
      sourceRef: { marker: string; trigger: string; daysInBucket: number; severity: number }
    }
  | { action: "skip"; reason: SkipReason }

// ─── Pure decision ───────────────────────────────────────────────────────

export function decideForClient(input: DecideInput): Decision {
  if (input.category !== "action") {
    return { action: "skip", reason: "not_in_action" }
  }

  if (input.daysInBucket == null || input.daysInBucket < MIN_DAYS_IN_BUCKET) {
    return { action: "skip", reason: "too_fresh" }
  }

  if (input.severity < ACTION_TASK_THRESHOLD) {
    return { action: "skip", reason: "low_severity" }
  }

  if (!input.assigneeUserId) {
    return { action: "skip", reason: "no_assignee" }
  }

  // Open / in-progress dedup — Pedro doesn't pile on top of an unfinished task.
  if (input.existingPedroTask) {
    const status = input.existingPedroTask.status
    if (status === "open" || status === "in_progress") {
      return { action: "skip", reason: "open_task_exists" }
    }

    // Recently-closed dedup — give the CM 7 days to see if their action worked
    // before nagging again.
    if (status === "done" && input.existingPedroTask.completedAt) {
      const closedMs = new Date(input.existingPedroTask.completedAt).getTime()
      const nowMs = new Date(input.now).getTime()
      const daysSinceClose = (nowMs - closedMs) / 86_400_000
      if (daysSinceClose < RECENT_CLOSED_DEDUP_DAYS) {
        return { action: "skip", reason: "recently_closed" }
      }
    }
  }

  if (input.openTasksForAssignee >= MAX_OPEN_PEDRO_TASKS_PER_USER) {
    return { action: "skip", reason: "assignee_at_cap" }
  }

  // All gates passed — emit a candidate.
  const title = `Pedro: ${input.client.name} ${input.daysInBucket}d in Action — review needed`
  const body = `${input.client.name} is in the Watch List Action bucket for ${input.daysInBucket} days running. Pedro flagged this for a campaign-manager review.\n\nOpen the client to see the full Pedro insight panel (overview · next move · lead quality) and the structured optimisation proposal.`

  return {
    action: "create",
    title,
    body,
    assigneeUserId: input.assigneeUserId,
    sourceRef: {
      marker: PEDRO_TASK_MARKER,
      trigger: "action_bucket_2d_v1",
      daysInBucket: input.daysInBucket,
      severity: input.severity,
    },
  }
}

// ─── Auto-close decision ─────────────────────────────────────────────────

export type AutoCloseDecision =
  | { close: true; reason: string }
  | { close: false }

/**
 * Decide whether an existing open Pedro task should be auto-closed because
 * the underlying signal has resolved. Conservative: we only auto-close
 * when the client has clearly LEFT the Action bucket (moved to Watch /
 * Good / no-data), not on a borderline severity dip.
 *
 * `currentCategory` is the live categorize() output for the client.
 */
export function decideAutoClose(currentCategory: WatchCategory): AutoCloseDecision {
  if (currentCategory === "action") {
    // Still in Action — task remains valid even if severity has dropped.
    // We let the human close it when they've actually finished the work.
    return { close: false }
  }
  return {
    close: true,
    reason: `Pedro auto-resolved — client moved out of Action (now ${humanizeCategory(currentCategory)}).`,
  }
}

function humanizeCategory(c: WatchCategory): string {
  if (c === "action") return "Action"
  if (c === "watch") return "Watch"
  if (c === "good") return "Good"
  return "no-data"
}
