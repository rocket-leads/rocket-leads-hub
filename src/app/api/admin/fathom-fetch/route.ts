import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchRecentFathomMeetings } from "@/lib/integrations/fathom"
import { ingestFathomMeeting } from "@/lib/meetings/ingest"

export const maxDuration = 60

/**
 * Admin diagnostic — pulls recent meetings directly from the Fathom API
 * (bypasses the webhook entirely). Two modes:
 *
 *   GET /api/admin/fathom-fetch
 *     → list recent meetings (default last 24h), no DB writes. Useful to
 *       verify the API key works and see what Fathom would send.
 *
 *   GET /api/admin/fathom-fetch?ingest=1
 *     → also runs each meeting through `ingestFathomMeeting()` — same code
 *       the webhook uses, so this proves the full pipeline works without
 *       needing the webhook to actually fire. Doubles as the foundation
 *       for the C.5.e backfill cron.
 *
 * Optional params:
 *   ?hours=72         — extend the time window (default 24, max 720 = 30d)
 *   ?recorded_by=...  — comma-separated emails to filter by host
 *   ?team=...         — comma-separated team names to filter by
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const url = new URL(req.url)
  const hoursParam = parseInt(url.searchParams.get("hours") ?? "24", 10)
  const hours = Number.isFinite(hoursParam) ? Math.min(Math.max(hoursParam, 1), 720) : 24
  const ingest = url.searchParams.get("ingest") === "1"
  const recordedBy = url.searchParams.get("recorded_by")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []
  const teams = url.searchParams.get("team")?.split(",").map((s) => s.trim()).filter(Boolean) ?? []

  const createdAfter = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()

  let meetings
  try {
    meetings = await fetchRecentFathomMeetings({
      createdAfter,
      recordedByEmails: recordedBy.length > 0 ? recordedBy : undefined,
      teams: teams.length > 0 ? teams : undefined,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fathom fetch failed" },
      { status: 500 },
    )
  }

  // Always return a digest so we can verify what Fathom returned
  const digest = meetings.map((m) => ({
    recording_id: m.recording_id,
    title: m.title,
    meeting_title: m.meeting_title,
    scheduled_start_time: m.scheduled_start_time,
    scheduled_end_time: m.scheduled_end_time,
    invitees_type: m.calendar_invitees_domains_type,
    recorded_by: m.recorded_by,
    attendees_count: m.calendar_invitees?.length ?? 0,
    external_attendees: (m.calendar_invitees ?? []).filter((a) => a.is_external).length,
    has_summary: !!m.default_summary?.markdown_formatted,
    action_items_count: m.action_items?.length ?? 0,
    transcript_segments: m.transcript?.length ?? 0,
  }))

  if (!ingest) {
    return NextResponse.json({
      mode: "list",
      window_hours: hours,
      created_after: createdAfter,
      count: meetings.length,
      meetings: digest,
    })
  }

  // Ingest mode — run each meeting through the same code path the webhook uses.
  const supabase = await createAdminClient()
  const results: Array<{ recording_id: number; result: Awaited<ReturnType<typeof ingestFathomMeeting>> }> = []
  for (const meeting of meetings) {
    const result = await ingestFathomMeeting(supabase, meeting)
    results.push({ recording_id: meeting.recording_id, result })
  }

  const inserted = results.filter((r) => r.result.ok && r.result.status === "inserted").length
  const deduped = results.filter((r) => r.result.ok && r.result.status === "deduped").length
  const skippedTeam = results.filter((r) => r.result.ok && r.result.status === "skipped_team").length
  const skippedSales = results.filter((r) => r.result.ok && r.result.status === "skipped_sales").length
  const errored = results.filter((r) => !r.result.ok).length

  return NextResponse.json({
    mode: "ingest",
    window_hours: hours,
    created_after: createdAfter,
    fetched: meetings.length,
    inserted,
    deduped,
    skipped_team: skippedTeam,
    skipped_sales: skippedSales,
    errored,
    results,
  })
}
