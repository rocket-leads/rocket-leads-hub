import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Throwaway diagnostic — peek at the latest Fathom webhook ingest results.
 * Lists the 10 most recently created `meetings` rows with the bits you'd want
 * to see for verifying the webhook → DB pipeline is working end-to-end.
 *
 * Admin-only. Safe to delete once Phase C.5 is proven out.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const supabase = await createAdminClient()

  const { count: total } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })

  const { data: rows, error } = await supabase
    .from("meetings")
    .select(
      "id, fathom_recording_id, title, scheduled_at, duration_sec, recorded_by_email, recorded_by_team, meeting_type, link_status, attendees, action_items, summary, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const summary = (rows ?? []).map((m) => ({
    id: m.id,
    fathom_recording_id: m.fathom_recording_id,
    title: m.title,
    scheduled_at: m.scheduled_at,
    duration_min: m.duration_sec ? Math.round(m.duration_sec / 60) : null,
    recorded_by_email: m.recorded_by_email,
    recorded_by_team: m.recorded_by_team,
    meeting_type: m.meeting_type,
    link_status: m.link_status,
    attendees_count: Array.isArray(m.attendees) ? m.attendees.length : 0,
    external_attendees: Array.isArray(m.attendees)
      ? m.attendees.filter((a: { is_external?: boolean }) => a.is_external).length
      : 0,
    action_items_count: Array.isArray(m.action_items) ? m.action_items.length : 0,
    has_summary: !!m.summary,
    summary_preview: m.summary ? m.summary.slice(0, 200) : null,
    created_at: m.created_at,
  }))

  return NextResponse.json({ total: total ?? 0, latest: summary })
}
