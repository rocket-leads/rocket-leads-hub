import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/pedro/health
 *
 * Pedro pipeline observability — answers "is the auto-trigger loop
 * actually firing?". Computes both halves of the funnel from existing
 * data so we don't need a separate log table:
 *
 *  - kick-offs ingested last 7d (denominator) — meetings.meeting_type
 *    + linked client_id
 *  - Pedro auto-fires last 7d (numerator) — inbox_events with
 *    source='automation' and source_ref->>kind='pedro_kickoff_brief'
 *
 * If a big gap shows up (e.g. 10 kick-offs ingested, 0 Pedro fires)
 * something's broken. Admin-only because the data covers the whole
 * agency, not a single user.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }

  const supabase = await createAdminClient()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  // ── Kick-offs ingested in the last 7d ──
  // Two buckets: linked (auto-trigger eligible) vs unlinked (matcher
  // hasn't attached a client yet — these never fire Pedro).
  const { data: kickoffsRaw } = await supabase
    .from("meetings")
    .select("id, client_id, scheduled_at, title")
    .eq("meeting_type", "kick_off")
    .gte("scheduled_at", sevenDaysAgo)
    .order("scheduled_at", { ascending: false })
    .limit(100)

  const kickoffs = kickoffsRaw ?? []
  const kickoffsLinked = kickoffs.filter((m) => !!m.client_id)
  const kickoffsUnlinked = kickoffs.filter((m) => !m.client_id)

  // ── Pedro auto-fires (inbox_events tasks created by the trigger) ──
  const { data: firesRaw } = await supabase
    .from("inbox_events")
    .select("id, client_id, title, body, source_ref, created_at, assignee_id, status")
    .eq("source", "automation")
    .filter("source_ref->>kind", "eq", "pedro_kickoff_brief")
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(50)

  const fires = (firesRaw ?? []) as Array<{
    id: string
    client_id: string | null
    title: string | null
    body: string | null
    source_ref: { kind?: string; meetingId?: string; fathomRecordingId?: string | null; clientId?: string } | null
    created_at: string
    assignee_id: string | null
    status: string | null
  }>

  // ── Map fires back to kick-offs to compute "missed" set ──
  const firedClientIds = new Set(fires.map((f) => f.client_id).filter(Boolean))
  const missed = kickoffsLinked.filter((k) => k.client_id && !firedClientIds.has(k.client_id))

  // ── Resolve assignee names so the UI can show who's holding each task ──
  const assigneeIds = Array.from(
    new Set(fires.map((f) => f.assignee_id).filter((id): id is string => !!id)),
  )
  const userNames = new Map<string, { name: string | null; email: string }>()
  if (assigneeIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, name, email")
      .in("id", assigneeIds)
    for (const u of users ?? []) {
      userNames.set(u.id, { name: u.name, email: u.email })
    }
  }

  // ── Resolve client names ──
  const clientIds = Array.from(
    new Set([
      ...fires.map((f) => f.client_id).filter((id): id is string => !!id),
      ...kickoffsLinked.map((k) => k.client_id).filter((id): id is string => !!id),
    ]),
  )
  const clientNames = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("monday_item_id, name")
      .in("monday_item_id", clientIds)
    for (const c of clients ?? []) {
      clientNames.set(c.monday_item_id, c.name)
    }
  }

  return NextResponse.json({
    window: { since: sevenDaysAgo, days: 7 },
    summary: {
      kickoffsIngested: kickoffs.length,
      kickoffsLinked: kickoffsLinked.length,
      kickoffsUnlinked: kickoffsUnlinked.length,
      pedroFires: fires.length,
      // Linked kick-offs that didn't get a Pedro fire — could be due to
      // an existing pedro_client_state row (CM already started) or a
      // legitimate skip; the surface count flags it for inspection.
      kickoffsWithoutFire: missed.length,
    },
    fires: fires.map((f) => ({
      id: f.id,
      clientId: f.client_id,
      clientName: f.client_id ? clientNames.get(f.client_id) ?? "?" : "—",
      title: f.title,
      assignee: f.assignee_id
        ? userNames.get(f.assignee_id)?.name ?? userNames.get(f.assignee_id)?.email ?? "?"
        : null,
      status: f.status,
      meetingId: f.source_ref?.meetingId ?? null,
      fathomRecordingId: f.source_ref?.fathomRecordingId ?? null,
      createdAt: f.created_at,
    })),
    missed: missed.map((k) => ({
      meetingId: k.id,
      clientId: k.client_id,
      clientName: k.client_id ? clientNames.get(k.client_id) ?? "?" : "—",
      scheduledAt: k.scheduled_at,
      title: k.title,
    })),
  })
}
