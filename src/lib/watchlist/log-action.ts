// Watch List action write - shared between the manual "Mark done" POST
// endpoint and automated hooks (Pedro push-to-Meta, eventually push-to-
// pause, etc). Single source of truth for:
//   1. Supersede any open action on the same client
//   2. Resolve the Account Manager Hub user id from the Monday person name
//      (cache-first via `monday_boards`, falling back to a Monday cache
//      lookup) and write the inbox_events Update
//   3. Append the audit row + denormalize active_action pointer onto
//      watchlist_client_state
//
// All side effects are best-effort: any failure logs + returns a partial
// result so the caller (a UI POST or a Meta push) can still finish its
// own work. Logging an action should NEVER take down the user-facing flow.

import { readCache } from "@/lib/cache"
import type { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ActionCategory } from "@/lib/watchlist/categorize"

export const WATCHLIST_ACTION_CATEGORIES: ReadonlyArray<ActionCategory> = [
  "creative",
  "pause",
  "angle",
  "funnel",
  "other",
]

export const WATCHLIST_ACTION_LIMITS = {
  minReviewDays: 2,
  maxReviewDays: 7,
  defaultReviewDays: 3,
  minActionTextLength: 10,
  maxActionTextLength: 2000,
} as const

export const WATCHLIST_ACTION_CATEGORY_LABEL: Record<ActionCategory, string> = {
  creative: "Creative iteration",
  pause: "Ad paused",
  angle: "New angle",
  funnel: "Funnel change",
  other: "Other",
}

export type WatchlistActionKpiSnapshot = {
  adSpend?: number | null
  leads?: number | null
  cpl?: number | null
  prevCpl?: number | null
  cpa?: number | null
  appts?: number | null
}

export type LogWatchlistActionInput = {
  supabase: Awaited<ReturnType<typeof createAdminClient>>
  mondayItemId: string
  clientName?: string | null
  /** Monday person name for the Account Manager. When omitted we read
   *  `monday_boards` cache to look it up. Pass an empty string or null
   *  to skip AM notification explicitly. */
  accountManagerName?: string | null
  actionCategory: ActionCategory
  actionText: string
  reviewDays?: number
  kpiSnapshot?: WatchlistActionKpiSnapshot | null
  insightAtTime?: string | null
  /** Hub user id of the person logging the action. For automated hooks
   *  this is the CM who clicked the trigger button (push-to-Meta etc).
   *  Required - we never log anonymous actions. */
  createdByUserId: string
  /** Optional - link to an existing inbox_events row instead of writing
   *  a new one (e.g. Pedro save-to-inbox already notified the AM). */
  existingInboxEventId?: string | null
  /** Optional - free-form metadata stamped on the inbox_events.source_ref
   *  for downstream filtering ({ from: "pedro_push_to_meta", refreshId,
   *  proposalIndex, adSetId } etc). */
  inboxSourceRefExtras?: Record<string, unknown>
}

export type LogWatchlistActionResult =
  | { ok: true; actionId: string; reviewDueAt: string; inboxEventId: string | null }
  | { ok: false; error: string; status: number }

/**
 * Write a single watchlist_actions audit row + AM inbox Update + state
 * pointer. Idempotent w.r.t. open actions: a fresh call always
 * supersedes the prior open action.
 *
 * Errors that block the audit row are returned with `ok: false` + an
 * HTTP-equivalent status. Errors that only block the AM notification
 * (inbox write failure, missing user mapping) are swallowed and surface
 * as `inboxEventId: null` so the caller can complete its own flow.
 */
export async function logWatchlistAction(
  input: LogWatchlistActionInput,
): Promise<LogWatchlistActionResult> {
  const {
    supabase,
    mondayItemId,
    clientName,
    actionCategory,
    actionText,
    kpiSnapshot,
    insightAtTime,
    createdByUserId,
    existingInboxEventId,
    inboxSourceRefExtras,
  } = input

  if (!mondayItemId?.trim()) {
    return { ok: false, status: 400, error: "mondayItemId is required" }
  }
  if (!(WATCHLIST_ACTION_CATEGORIES as ReadonlyArray<string>).includes(actionCategory)) {
    return { ok: false, status: 400, error: "actionCategory invalid" }
  }
  const text = actionText?.trim() ?? ""
  if (text.length < WATCHLIST_ACTION_LIMITS.minActionTextLength) {
    return {
      ok: false,
      status: 400,
      error: `actionText must be at least ${WATCHLIST_ACTION_LIMITS.minActionTextLength} characters`,
    }
  }
  if (text.length > WATCHLIST_ACTION_LIMITS.maxActionTextLength) {
    return {
      ok: false,
      status: 400,
      error: `actionText too long (max ${WATCHLIST_ACTION_LIMITS.maxActionTextLength})`,
    }
  }

  const reviewDaysRaw = input.reviewDays ?? WATCHLIST_ACTION_LIMITS.defaultReviewDays
  const reviewDays = Math.min(
    WATCHLIST_ACTION_LIMITS.maxReviewDays,
    Math.max(WATCHLIST_ACTION_LIMITS.minReviewDays, Math.round(reviewDaysRaw)),
  )

  const nowIso = new Date().toISOString()
  const reviewDueIso = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString()

  // Supersede prior open action - the audit row stays, the active flag
  // moves to the new row.
  const { error: supersedeErr } = await supabase
    .from("watchlist_actions")
    .update({ superseded_at: nowIso })
    .eq("monday_item_id", mondayItemId)
    .is("reviewed_at", null)
    .is("superseded_at", null)
  if (supersedeErr) {
    console.error("[log-action] supersede failed:", supersedeErr.message)
    return { ok: false, status: 500, error: "Failed to supersede previous action" }
  }

  // Account Manager Hub user id - prefer explicit name in input, fall
  // back to a cheap monday_boards cache lookup. Either way: a missing
  // mapping is non-fatal, we just skip the AM notification.
  const accountManagerName = await resolveAccountManagerName(
    mondayItemId,
    input.accountManagerName,
  )

  let inboxEventId: string | null = existingInboxEventId ?? null
  if (!inboxEventId && accountManagerName) {
    inboxEventId = await writeAmInboxUpdate(supabase, {
      mondayItemId,
      clientName: clientName ?? null,
      accountManagerName,
      actionCategory,
      actionText: text,
      kpiSnapshot: kpiSnapshot ?? null,
      reviewDays,
      reviewDueIso,
      createdByUserId,
      sourceRefExtras: inboxSourceRefExtras,
    })
  }

  // Audit row first - this is the canonical record.
  const { data: actionRow, error: auditErr } = await supabase
    .from("watchlist_actions")
    .insert({
      monday_item_id: mondayItemId,
      client_name: clientName ?? null,
      action_category: actionCategory,
      action_text: text,
      kpi_snapshot: kpiSnapshot ?? null,
      insight_at_time: insightAtTime ?? null,
      inbox_event_id: inboxEventId,
      created_by: createdByUserId,
      created_at: nowIso,
      review_due_at: reviewDueIso,
    })
    .select("id")
    .single()

  if (auditErr || !actionRow) {
    console.error("[log-action] audit insert failed:", auditErr?.message)
    return { ok: false, status: 500, error: "Failed to log action" }
  }

  // Denormalized pointer on state. Keep `category` untouched so the
  // rules verdict stays visible when the action expires - we read the
  // current row to preserve `since_date` for free.
  const { data: existingState } = await supabase
    .from("watchlist_client_state")
    .select("category, since_date")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()

  const today = nowIso.slice(0, 10)
  const { error: stateErr } = await supabase
    .from("watchlist_client_state")
    .upsert(
      {
        monday_item_id: mondayItemId,
        category: existingState?.category ?? "watch",
        since_date: existingState?.since_date ?? today,
        active_action_id: actionRow.id,
        active_action_review_due_at: reviewDueIso,
        updated_at: nowIso,
      },
      { onConflict: "monday_item_id" },
    )
  if (stateErr) {
    console.error("[log-action] state upsert failed:", stateErr.message)
    return { ok: false, status: 500, error: "Failed to mark action" }
  }

  return {
    ok: true,
    actionId: actionRow.id,
    reviewDueAt: reviewDueIso,
    inboxEventId,
  }
}

/** Resolve an Account Manager name. Explicit input wins; cache lookup
 *  is a fallback for automated hooks that only know the monday_item_id. */
async function resolveAccountManagerName(
  mondayItemId: string,
  explicit: string | null | undefined,
): Promise<string | null> {
  if (typeof explicit === "string") {
    const trimmed = explicit.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  // Cache hit = free. Cache miss = no AM notify (still log the audit row).
  type Boards = {
    onboarding?: MondayClient[]
    current?: MondayClient[]
  }
  const cache = await readCache<Boards>("monday_boards")
  if (!cache) return null
  const all = [...(cache.onboarding ?? []), ...(cache.current ?? [])]
  const match = all.find((c) => c.mondayItemId === mondayItemId)
  return match?.accountManager?.trim() || null
}

async function writeAmInboxUpdate(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  args: {
    mondayItemId: string
    clientName: string | null
    accountManagerName: string
    actionCategory: ActionCategory
    actionText: string
    kpiSnapshot: WatchlistActionKpiSnapshot | null
    reviewDays: number
    reviewDueIso: string
    createdByUserId: string
    sourceRefExtras?: Record<string, unknown>
  },
): Promise<string | null> {
  const { data: amMapping } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "account_manager")
    .eq("monday_person_name", args.accountManagerName)
    .maybeSingle<{ user_id: string }>()

  if (!amMapping?.user_id) return null

  // Resolve CM display name from the users table - cheap point read,
  // gives the AM a "{CM} acted on..." sentence instead of an opaque uuid.
  const { data: cmRow } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", args.createdByUserId)
    .maybeSingle<{ name: string | null; email: string | null }>()
  const cmDisplayName = cmRow?.name ?? cmRow?.email ?? "Campaign manager"

  const categoryLabel = WATCHLIST_ACTION_CATEGORY_LABEL[args.actionCategory]
  const updateTitle = `Watchlist action: ${args.clientName ?? args.mondayItemId}`
  const updateBody = formatUpdateBody({
    cmName: cmDisplayName,
    clientName: args.clientName ?? "this client",
    categoryLabel,
    actionText: args.actionText,
    kpiSnapshot: args.kpiSnapshot,
    reviewDays: args.reviewDays,
  })

  const { data: inboxRow, error: inboxErr } = await supabase
    .from("inbox_events")
    .insert({
      kind: "update",
      client_id: args.mondayItemId,
      author_id: args.createdByUserId,
      assignee_id: amMapping.user_id,
      title: updateTitle,
      body: updateBody,
      status: "unread",
      source: "watchlist",
      source_ref: {
        from: "watchlist_action",
        action_category: args.actionCategory,
        review_due_at: args.reviewDueIso,
        ...(args.sourceRefExtras ?? {}),
      },
    })
    .select("id")
    .single()

  if (inboxErr) {
    console.error("[log-action] AM inbox event insert failed:", inboxErr.message)
    return null
  }
  return inboxRow?.id ?? null
}

function formatUpdateBody(args: {
  cmName: string
  clientName: string
  categoryLabel: string
  actionText: string
  kpiSnapshot: WatchlistActionKpiSnapshot | null
  reviewDays: number
}): string {
  const lines: string[] = []
  lines.push(`${args.cmName} acted on ${args.clientName}.`)
  lines.push("")
  lines.push(`What was done (${args.categoryLabel}):`)
  lines.push(args.actionText)
  lines.push("")
  const k = args.kpiSnapshot
  if (k) {
    const parts: string[] = []
    if (k.adSpend != null) parts.push(`spend €${k.adSpend.toFixed(0)} (7d)`)
    if (k.leads != null) parts.push(`${k.leads} leads (7d)`)
    if (k.cpl != null && k.cpl > 0) parts.push(`CPL €${k.cpl.toFixed(2)} (7d)`)
    if (parts.length > 0) {
      lines.push(`Snapshot at time of action: ${parts.join(" · ")}.`)
    }
  }
  lines.push(
    `Re-eval in ${args.reviewDays}d. If still concerning the client flips back to Action Needed automatically.`,
  )
  return lines.join("\n")
}
