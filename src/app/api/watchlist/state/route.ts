import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { ActionCategory } from "@/lib/watchlist/categorize"

export type WatchlistClientState = {
  category: "action" | "watch" | "good" | "no-data"
  prevCategory: "action" | "watch" | "good" | "no-data" | null
  /** YYYY-MM-DD - the date this client entered the current category */
  sinceDate: string
  /** Active manual override - when present, the row renders in this bucket with
   *  an "override" insight string instead of the rules-based one. Expires after
   *  7d max or earlier when KPI shift exceeds threshold (handled categorizer-side). */
  manualOverride?: {
    category: "action" | "watch" | "good"
    reason: string
    /** ISO timestamp - when the override was applied. */
    overriddenAt: string
    /** ISO timestamp - when the time-based expiry kicks in. */
    expiresAt: string
    /** KPI snapshot at decision time, used to detect a >25% shift that should
     *  short-circuit the time-based TTL. */
    kpiSnapshot: {
      adSpend?: number | null
      leads?: number | null
      cpl?: number | null
      prevCpl?: number | null
      cpa?: number | null
      appts?: number | null
    } | null
  } | null
  /** Active action - CM marked done + is monitoring. While `reviewDueAt`
   *  is in the future the categorizer keeps this row in Watchlist with an
   *  "in review" insight. The cron closes the loop when the window passes
   *  and either keeps the client in Watchlist/Healthy (recovered) or flips
   *  it back to Action Needed (still concerning). */
  activeAction?: {
    id: string
    category: ActionCategory
    actionText: string
    /** ISO timestamp - when the CM logged the action. */
    createdAt: string
    /** ISO timestamp - when the cron will re-check this client. */
    reviewDueAt: string
  } | null
}

export type WatchlistStateResponse = Record<string, WatchlistClientState>

/**
 * Returns the per-client Watch List state used to render the days-in-bucket indicator,
 * the NEW badge, and the yesterday-vs-today trend. The cron is the writer; this route
 * is read-only and dirt-cheap (single Supabase query). Returned as a map keyed by
 * monday_item_id so the UI can join in O(1).
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("watchlist_client_state")
    .select(
      "monday_item_id, category, prev_category, since_date, manual_category, override_reason, override_kpi_snapshot, overridden_at, override_expires_at, active_action_id, active_action_review_due_at",
    )

  if (error) {
    console.error("Watchlist state read failed:", error.message)
    return NextResponse.json<WatchlistStateResponse>({}, { status: 200 })
  }

  const nowMs = Date.now()

  // Active actions - fetched in a single batch query so we can populate
  // the detail (category, text, created_at) the UI needs without a join
  // on every row. Only open actions matter for rendering: superseded or
  // reviewed actions don't drive bucket behaviour anymore.
  const activeActionIds = (data ?? [])
    .map((r) => r.active_action_id)
    .filter((id): id is string => !!id)

  type ActionRow = {
    id: string
    monday_item_id: string
    action_category: ActionCategory
    action_text: string
    created_at: string
    review_due_at: string
    reviewed_at: string | null
    superseded_at: string | null
  }

  const actionDetailById = new Map<string, ActionRow>()
  if (activeActionIds.length > 0) {
    const { data: actionRows } = await supabase
      .from("watchlist_actions")
      .select("id, monday_item_id, action_category, action_text, created_at, review_due_at, reviewed_at, superseded_at")
      .in("id", activeActionIds)
    for (const row of (actionRows ?? []) as ActionRow[]) {
      actionDetailById.set(row.id, row)
    }
  }

  const out: WatchlistStateResponse = {}
  for (const row of data ?? []) {
    // Time-based expiry - surface the override only while it's still active so
    // the dashboard never has to think about TTL. The KPI-shift expiry is
    // applied categorizer-side because it needs the live KPI snapshot.
    const expiresMs = row.override_expires_at ? new Date(row.override_expires_at).getTime() : null
    const manualLive =
      row.manual_category &&
      row.overridden_at &&
      row.override_expires_at &&
      expiresMs !== null &&
      expiresMs > nowMs

    // Active action - surface only if it's still genuinely open. The state
    // table holds a denormalized pointer, but a row could have been
    // reviewed or superseded between cron ticks; trust the audit row.
    let activeAction: WatchlistClientState["activeAction"] = null
    if (row.active_action_id) {
      const detail = actionDetailById.get(row.active_action_id)
      const reviewMs = detail ? new Date(detail.review_due_at).getTime() : null
      const isOpen =
        detail &&
        !detail.reviewed_at &&
        !detail.superseded_at &&
        reviewMs !== null &&
        reviewMs > nowMs
      if (isOpen && detail) {
        activeAction = {
          id: detail.id,
          category: detail.action_category,
          actionText: detail.action_text,
          createdAt: detail.created_at,
          reviewDueAt: detail.review_due_at,
        }
      }
    }

    out[row.monday_item_id] = {
      category: row.category,
      prevCategory: row.prev_category ?? null,
      sinceDate: row.since_date,
      manualOverride: manualLive
        ? {
            category: row.manual_category as "action" | "watch" | "good",
            reason: row.override_reason ?? "",
            overriddenAt: row.overridden_at as string,
            expiresAt: row.override_expires_at as string,
            kpiSnapshot: row.override_kpi_snapshot ?? null,
          }
        : null,
      activeAction,
    }
  }

  return NextResponse.json(out, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
