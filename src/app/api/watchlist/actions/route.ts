import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import type { ActionCategory } from "@/lib/watchlist/categorize"

/**
 * Watch List "mark action done" - a campaign manager records what they
 * did on a client in Action Needed, picks a review window (2/3/5/7 days),
 * and the client moves to Watchlist "in review" until the cron re-checks
 * at review_due_at.
 *
 * Three things happen on POST:
 *   1. Supersede any existing open action on this client (one active at
 *      a time, the rest live in history with `superseded_at`).
 *   2. Append the audit row to `watchlist_actions` with the KPI snapshot
 *      + insight string the CM was looking at when they acted. This is
 *      the learning corpus for outcome-rate aggregations and AI Note
 *      "previous action" context.
 *   3. Write an inbox Update to the client's Account Manager so the AM
 *      can mention the work in their next client call without having to
 *      ask the CM. Action text shows verbatim in the AM's Updates feed.
 *
 * Finally the watchlist_client_state row gets the denormalized
 * (active_action_id, active_action_review_due_at) pair so the categorizer
 * can apply the "in review" override on every render without joining.
 */

const ACTION_CATEGORIES: ReadonlyArray<ActionCategory> = [
  "creative",
  "pause",
  "angle",
  "funnel",
  "other",
]

const MIN_REVIEW_DAYS = 2
const MAX_REVIEW_DAYS = 7
const DEFAULT_REVIEW_DAYS = 3
const MIN_ACTION_TEXT_LENGTH = 10
const MAX_ACTION_TEXT_LENGTH = 2000

const ACTION_CATEGORY_LABEL: Record<ActionCategory, string> = {
  creative: "Creative iteration",
  pause: "Ad paused",
  angle: "New angle",
  funnel: "Funnel change",
  other: "Other",
}

type KpiSnapshot = {
  adSpend?: number | null
  leads?: number | null
  cpl?: number | null
  prevCpl?: number | null
  cpa?: number | null
  appts?: number | null
}

type PostBody = {
  mondayItemId: string
  clientName?: string | null
  /** Monday person name of the Account Manager - same field the row
   *  shows. The endpoint maps it to a Hub user id via user_column_mappings;
   *  missing mapping is non-fatal (action still logs, AM update is skipped). */
  accountManager?: string | null
  actionCategory: ActionCategory
  actionText: string
  reviewDays?: number
  kpiSnapshot?: KpiSnapshot | null
  insightAtTime?: string | null
}

function isValidCategory(cat: unknown): cat is ActionCategory {
  return typeof cat === "string" && (ACTION_CATEGORIES as ReadonlyArray<string>).includes(cat)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as PostBody | null
  if (!body?.mondayItemId?.trim()) {
    return NextResponse.json({ error: "mondayItemId is required" }, { status: 400 })
  }
  if (!isValidCategory(body.actionCategory)) {
    return NextResponse.json(
      { error: "actionCategory must be creative/pause/angle/funnel/other" },
      { status: 400 },
    )
  }
  const actionText = body.actionText?.trim() ?? ""
  if (actionText.length < MIN_ACTION_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `actionText must be at least ${MIN_ACTION_TEXT_LENGTH} characters` },
      { status: 400 },
    )
  }
  if (actionText.length > MAX_ACTION_TEXT_LENGTH) {
    return NextResponse.json(
      { error: `actionText too long (max ${MAX_ACTION_TEXT_LENGTH})` },
      { status: 400 },
    )
  }

  const reviewDaysRaw = body.reviewDays ?? DEFAULT_REVIEW_DAYS
  const reviewDays = Math.min(
    MAX_REVIEW_DAYS,
    Math.max(MIN_REVIEW_DAYS, Math.round(reviewDaysRaw)),
  )

  const supabase = await createAdminClient()
  const nowIso = new Date().toISOString()
  const reviewDueIso = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString()

  // Supersede any existing open action on this client. Same pattern as
  // watchlist_overrides - we lose nothing because the prior row stays in
  // the audit log with superseded_at set, including its KPI snapshot and
  // outcome (if the cron already ran a review on it).
  const { error: supersedeErr } = await supabase
    .from("watchlist_actions")
    .update({ superseded_at: nowIso })
    .eq("monday_item_id", body.mondayItemId)
    .is("reviewed_at", null)
    .is("superseded_at", null)
  if (supersedeErr) {
    console.error("[watchlist/actions] supersede failed:", supersedeErr.message)
    return NextResponse.json({ error: "Failed to supersede previous action" }, { status: 500 })
  }

  // Write the AM Update FIRST. Two reasons:
  //   1. Losing the audit row is recoverable (CM can re-log); losing the
  //      AM notification means the AM walks into a client call cold,
  //      which is the worst-case UX failure of this whole loop.
  //   2. We store the inbox_event_id back on the audit row, so we need
  //      it created first to link cleanly.
  let inboxEventId: string | null = null
  if (body.accountManager?.trim()) {
    const { data: amMapping } = await supabase
      .from("user_column_mappings")
      .select("user_id")
      .eq("monday_column_role", "account_manager")
      .eq("monday_person_name", body.accountManager.trim())
      .maybeSingle<{ user_id: string }>()

    if (amMapping?.user_id) {
      const categoryLabel = ACTION_CATEGORY_LABEL[body.actionCategory]
      const updateTitle = `Watchlist action: ${body.clientName ?? body.mondayItemId}`
      const updateBody = formatUpdateBody({
        cmName: session.user.name ?? session.user.email ?? "Campaign manager",
        clientName: body.clientName ?? "this client",
        categoryLabel,
        actionText,
        kpiSnapshot: body.kpiSnapshot ?? null,
        reviewDays,
      })

      const { data: inboxRow, error: inboxErr } = await supabase
        .from("inbox_events")
        .insert({
          kind: "update",
          client_id: body.mondayItemId,
          author_id: session.user.id,
          assignee_id: amMapping.user_id,
          title: updateTitle,
          body: updateBody,
          status: "unread",
          source: "watchlist",
          source_ref: {
            from: "watchlist_action",
            action_category: body.actionCategory,
            review_due_at: reviewDueIso,
          },
        })
        .select("id")
        .single()

      if (inboxErr) {
        // Don't fail the whole request - the audit row is still useful
        // and the AM can be informed out-of-band if needed. Log loudly
        // so we notice if this happens systematically.
        console.error("[watchlist/actions] AM inbox event insert failed:", inboxErr.message)
      } else if (inboxRow) {
        inboxEventId = inboxRow.id
      }
    }
  }

  // Append the audit row. This is the canonical record of "what was tried
  // when" - the rest of the system (cron outcome write, AI Note prior-action
  // context, history popover) all read from here.
  const { data: actionRow, error: auditErr } = await supabase
    .from("watchlist_actions")
    .insert({
      monday_item_id: body.mondayItemId,
      client_name: body.clientName ?? null,
      action_category: body.actionCategory,
      action_text: actionText,
      kpi_snapshot: body.kpiSnapshot ?? null,
      insight_at_time: body.insightAtTime ?? null,
      inbox_event_id: inboxEventId,
      created_by: session.user.id,
      created_at: nowIso,
      review_due_at: reviewDueIso,
    })
    .select("id")
    .single()

  if (auditErr || !actionRow) {
    console.error("[watchlist/actions] audit insert failed:", auditErr?.message)
    return NextResponse.json({ error: "Failed to log action" }, { status: 500 })
  }

  // Write the denormalized pointer to the state cache. Categorizer reads
  // (active_action_id, active_action_review_due_at) on every render to
  // apply the in-review override. We keep `category` untouched so the
  // rules verdict stays visible when the action expires.
  const { data: existingState } = await supabase
    .from("watchlist_client_state")
    .select("category, since_date")
    .eq("monday_item_id", body.mondayItemId)
    .maybeSingle()

  const today = nowIso.slice(0, 10)
  const upsertRow = {
    monday_item_id: body.mondayItemId,
    category: existingState?.category ?? "watch",
    since_date: existingState?.since_date ?? today,
    active_action_id: actionRow.id,
    active_action_review_due_at: reviewDueIso,
    updated_at: nowIso,
  }
  const { error: stateErr } = await supabase
    .from("watchlist_client_state")
    .upsert(upsertRow, { onConflict: "monday_item_id" })
  if (stateErr) {
    console.error("[watchlist/actions] state upsert failed:", stateErr.message)
    return NextResponse.json({ error: "Failed to mark action" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    actionId: actionRow.id,
    reviewDueAt: reviewDueIso,
    amNotified: !!inboxEventId,
  })
}

/**
 * Action history for a client - lists past actions newest first so the UI
 * can render a "previous actions" panel inside the slide-over. Includes
 * the outcome + outcome_note the cron stamped when the review ran.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const mondayItemId = searchParams.get("mondayItemId")?.trim()
  if (!mondayItemId) {
    return NextResponse.json({ error: "mondayItemId is required" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("watchlist_actions")
    .select(
      "id, action_category, action_text, kpi_snapshot, insight_at_time, created_by, created_at, review_due_at, reviewed_at, outcome, outcome_note, outcome_kpi_snapshot, superseded_at",
    )
    .eq("monday_item_id", mondayItemId)
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ actions: data ?? [] })
}

function formatUpdateBody(args: {
  cmName: string
  clientName: string
  categoryLabel: string
  actionText: string
  kpiSnapshot: KpiSnapshot | null
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
