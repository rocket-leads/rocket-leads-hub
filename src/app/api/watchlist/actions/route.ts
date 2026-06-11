import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"
import type { ActionCategory } from "@/lib/watchlist/categorize"
import { logWatchlistAction, WATCHLIST_ACTION_CATEGORIES } from "@/lib/watchlist/log-action"

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
 *      + insight string the CM was looking at when they acted.
 *   3. Write an inbox Update to the client's Account Manager.
 *
 * The actual mutation lives in `logWatchlistAction()` so automated hooks
 * (Pedro push-to-Meta, future auto-pause flows) can call the same code
 * path without duplicating the supersede + audit + AM-notify dance.
 */

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
   *  shows. The helper maps it to a Hub user id via user_column_mappings;
   *  missing mapping is non-fatal (action still logs, AM update is skipped). */
  accountManager?: string | null
  actionCategory: ActionCategory
  actionText: string
  reviewDays?: number
  kpiSnapshot?: KpiSnapshot | null
  insightAtTime?: string | null
}

function isValidCategory(cat: unknown): cat is ActionCategory {
  return typeof cat === "string" && (WATCHLIST_ACTION_CATEGORIES as ReadonlyArray<string>).includes(cat)
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

  const supabase = await createAdminClient()
  const result = await logWatchlistAction({
    supabase,
    mondayItemId: body.mondayItemId,
    clientName: body.clientName,
    accountManagerName: body.accountManager,
    actionCategory: body.actionCategory,
    actionText: body.actionText,
    reviewDays: body.reviewDays,
    kpiSnapshot: body.kpiSnapshot ?? null,
    insightAtTime: body.insightAtTime ?? null,
    createdByUserId: session.user.id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    ok: true,
    actionId: result.actionId,
    reviewDueAt: result.reviewDueAt,
    amNotified: !!result.inboxEventId,
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
