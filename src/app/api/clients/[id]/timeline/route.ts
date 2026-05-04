import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Per-client timeline (Phase C.8). Returns inbox events + meetings for this
 * client, merged into one chronological list. Newest first, capped at 200.
 *
 * Each entry has a uniform shape so the renderer can be a single component:
 *   { id, kind, source, title, body, occurred_at, link_url, meta }
 */

export type TimelineEntry = {
  id: string
  /** What category of activity — drives the icon and label. */
  kind: "update" | "task" | "chat" | "meeting"
  /** Origin platform / system. */
  source: "monday" | "trengo" | "slack" | "meeting" | "manual" | "watchlist" | "automation"
  scope?: "internal" | "external" | null
  title: string
  /** Optional preview / body text. Already truncated server-side. */
  body: string | null
  /** Author-side label, e.g. "Roy" or "Klant via Trengo". */
  author: string | null
  /** ISO timestamp used for sorting. */
  occurred_at: string
  /** Optional outbound link (e.g. Fathom share URL, Monday item URL). */
  link_url: string | null
  meta: Record<string, unknown> | null
}

const MAX_ENTRIES = 200
const BODY_PREVIEW_LEN = 280

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

  const supabase = await createAdminClient()

  const [eventsRes, meetingsRes] = await Promise.all([
    supabase
      .from("inbox_events")
      .select(
        "id, kind, source, scope, title, body, status, author_kind, author_name_cached, source_thread, source_msg_id, created_at_src, created_at",
      )
      .eq("client_id", id)
      .order("created_at_src", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_ENTRIES),
    supabase
      .from("meetings")
      .select(
        "id, fathom_recording_id, title, scheduled_at, share_url, recorded_by_name, meeting_type, link_status, summary, action_items",
      )
      .eq("client_id", id)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(50),
  ])

  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  }
  if (meetingsRes.error) {
    return NextResponse.json({ error: meetingsRes.error.message }, { status: 500 })
  }

  const eventEntries: TimelineEntry[] = (eventsRes.data ?? []).map((e) => ({
    id: `event:${e.id}`,
    kind: (e.kind ?? "chat") as TimelineEntry["kind"],
    source: (e.source ?? "manual") as TimelineEntry["source"],
    scope: (e.scope ?? null) as TimelineEntry["scope"],
    title: e.title ?? "(no title)",
    body: e.body ? truncate(e.body, BODY_PREVIEW_LEN) : null,
    author: e.author_name_cached ?? null,
    occurred_at: e.created_at_src ?? e.created_at,
    link_url: null,
    meta: {
      status: e.status,
      author_kind: e.author_kind,
      source_thread: e.source_thread,
    },
  }))

  const meetingEntries: TimelineEntry[] = (meetingsRes.data ?? []).map((m) => ({
    id: `meeting:${m.id}`,
    kind: "meeting",
    source: "meeting",
    scope: null,
    title: m.title ?? "Untitled meeting",
    body: m.summary ? truncate(m.summary, BODY_PREVIEW_LEN) : null,
    author: m.recorded_by_name ?? null,
    occurred_at: m.scheduled_at ?? new Date(0).toISOString(),
    link_url: m.share_url ?? null,
    meta: {
      meeting_type: m.meeting_type,
      link_status: m.link_status,
      action_items_count: Array.isArray(m.action_items) ? m.action_items.length : 0,
      fathom_recording_id: m.fathom_recording_id,
    },
  }))

  // Merge + sort by occurred_at desc, cap to MAX_ENTRIES so a noisy client
  // doesn't flood the page.
  const merged = [...eventEntries, ...meetingEntries]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .slice(0, MAX_ENTRIES)

  return NextResponse.json({ entries: merged })
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + "…"
}
