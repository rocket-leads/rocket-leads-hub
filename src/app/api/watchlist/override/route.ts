import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Watch List manual override — CM/AM moves a client between Action / Watch /
 * Good with a required reason, expires after 7d max OR earlier when CPL/spend
 * shifts >25% from the snapshot (whichever comes first).
 *
 * Two surfaces are updated atomically:
 *   1. `watchlist_client_state.manual_category` — the active override, read by
 *      the categorizer on every dashboard render.
 *   2. `watchlist_overrides` — append-only audit row with the KPI snapshot at
 *      decision time. This is the learning corpus for the AI adjustment layer.
 *
 * The caller passes the KPI snapshot it was looking at; we trust the client
 * here because the alternative is a second round-trip to /api/kpi-summaries
 * just to re-derive numbers that are already in the React Query cache.
 */

const OVERRIDE_TTL_DAYS = 7

type WatchCategory = "action" | "watch" | "good" | "no-data"

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
  /** Bucket the user is moving the client TO. */
  toCategory: WatchCategory
  /** The rules-based category the row was displaying. Stored on the audit row
   *  so we can train on "rules said X, CM said Y". */
  fromCategory: WatchCategory | null
  reason: string
  kpiSnapshot?: KpiSnapshot | null
  /** The rules-based insight string the user was looking at — useful context
   *  for the learning loop ("CM overrode this when the rule said 'CPL up 30%'"). */
  insightAtTime?: string | null
}

function isValidTarget(cat: unknown): cat is "action" | "watch" | "good" {
  return cat === "action" || cat === "watch" || cat === "good"
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
  if (!isValidTarget(body.toCategory)) {
    return NextResponse.json({ error: "toCategory must be action / watch / good" }, { status: 400 })
  }
  const reason = body.reason?.trim()
  if (!reason) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 })
  }
  if (reason.length > 2000) {
    return NextResponse.json({ error: "reason too long (max 2000 chars)" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + OVERRIDE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Supersede any existing active override on this client — one active override
  // at a time, the rest live in the audit log with `expired_at` set.
  const { error: supersedeErr } = await supabase
    .from("watchlist_overrides")
    .update({ expired_at: nowIso, expiry_cause: "superseded" })
    .eq("monday_item_id", body.mondayItemId)
    .is("expired_at", null)
  if (supersedeErr) {
    console.error("[watchlist/override] supersede failed:", supersedeErr.message)
    return NextResponse.json({ error: "Failed to supersede previous override" }, { status: 500 })
  }

  // Append the audit row first — losing the active-state write is recoverable
  // (next cron rewrites it), but losing the audit row breaks the learning loop.
  const { error: auditErr } = await supabase.from("watchlist_overrides").insert({
    monday_item_id: body.mondayItemId,
    client_name: body.clientName ?? null,
    from_category: body.fromCategory ?? null,
    to_category: body.toCategory,
    reason,
    kpi_snapshot: body.kpiSnapshot ?? null,
    insight_at_time: body.insightAtTime ?? null,
    created_by: session.user.id,
    created_at: nowIso,
  })
  if (auditErr) {
    console.error("[watchlist/override] audit insert failed:", auditErr.message)
    return NextResponse.json({ error: "Failed to log override" }, { status: 500 })
  }

  // Write the active state. Upsert by monday_item_id — `watchlist_client_state`
  // has the rules-based `category` populated by the cron, we just attach the
  // override columns alongside without disturbing it.
  const { data: existing } = await supabase
    .from("watchlist_client_state")
    .select("category, since_date")
    .eq("monday_item_id", body.mondayItemId)
    .maybeSingle()

  const today = nowIso.slice(0, 10)
  const upsertRow = {
    monday_item_id: body.mondayItemId,
    // Keep the rules-based category column untouched so we can still see what
    // the rules would say without the override. Use the existing row's value
    // when present; default to the toCategory when the client wasn't tracked
    // yet (rare — usually the cron has already written this).
    category: existing?.category ?? body.toCategory,
    since_date: existing?.since_date ?? today,
    manual_category: body.toCategory,
    override_reason: reason,
    override_kpi_snapshot: body.kpiSnapshot ?? null,
    overridden_by: session.user.id,
    overridden_at: nowIso,
    override_expires_at: expiresAt,
    updated_at: nowIso,
  }
  const { error: stateErr } = await supabase
    .from("watchlist_client_state")
    .upsert(upsertRow, { onConflict: "monday_item_id" })
  if (stateErr) {
    console.error("[watchlist/override] state upsert failed:", stateErr.message)
    return NextResponse.json({ error: "Failed to apply override" }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    manualCategory: body.toCategory,
    expiresAt,
  })
}

/**
 * Clear the active override on a client. The audit row stays intact (marked
 * `expired_at` with cause `manual`) — only the active flag is removed.
 */
export async function DELETE(req: NextRequest) {
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
  const nowIso = new Date().toISOString()

  await supabase
    .from("watchlist_overrides")
    .update({ expired_at: nowIso, expiry_cause: "manual" })
    .eq("monday_item_id", mondayItemId)
    .is("expired_at", null)

  const { error: stateErr } = await supabase
    .from("watchlist_client_state")
    .update({
      manual_category: null,
      override_reason: null,
      override_kpi_snapshot: null,
      overridden_by: null,
      overridden_at: null,
      override_expires_at: null,
      updated_at: nowIso,
    })
    .eq("monday_item_id", mondayItemId)

  if (stateErr) {
    console.error("[watchlist/override DELETE] state clear failed:", stateErr.message)
    return NextResponse.json({ error: "Failed to clear override" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
