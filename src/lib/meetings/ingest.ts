import type { SupabaseClient } from "@supabase/supabase-js"
import {
  classifyMeetingType,
  renderTranscript,
  type FathomMeeting,
} from "@/lib/integrations/fathom"

export type IngestResult =
  | { ok: true; status: "inserted"; recording_id: string; meeting_type: string; link_status: string }
  | { ok: true; status: "deduped"; recording_id: string }
  | { ok: false; status: "error"; error: string }

/**
 * Insert a single Fathom Meeting payload into the `meetings` table.
 *
 * Shared by the webhook receiver (live ingest) and the admin fetch / backfill
 * endpoints (pull-based ingest). All three paths must produce identical rows
 * — keep the logic here, never inline it again at a call site.
 *
 * Behaviour:
 *  - Dedupe on `fathom_recording_id` (Fathom retries failed deliveries; the
 *    backfill will see the same recordings the webhook already stored).
 *  - Classify `meeting_type` from team + title (stable at ingest time).
 *  - Set `link_status='internal'` when no external attendees, otherwise
 *    `'unlinked'` for the matcher (C.5.b) to pick up.
 *  - Client-matching is NOT done here — that's the matcher's job.
 */
export async function ingestFathomMeeting(
  supabase: SupabaseClient,
  payload: FathomMeeting,
): Promise<IngestResult> {
  const recordingId = payload.recording_id != null ? String(payload.recording_id) : ""
  if (!recordingId) {
    return { ok: false, status: "error", error: "Missing recording_id in payload" }
  }

  const { data: existing } = await supabase
    .from("meetings")
    .select("id")
    .eq("fathom_recording_id", recordingId)
    .maybeSingle()
  if (existing) {
    return { ok: true, status: "deduped", recording_id: recordingId }
  }

  const meetingType = classifyMeetingType(payload)
  const isInternal = payload.calendar_invitees_domains_type === "only_internal"
  const linkStatus = isInternal ? "internal" : "unlinked"

  const attendees = (payload.calendar_invitees ?? []).map((inv) => ({
    name: inv.name,
    email: inv.email,
    email_domain: inv.email_domain,
    is_external: inv.is_external,
  }))

  const start = payload.scheduled_start_time ? new Date(payload.scheduled_start_time) : null
  const end = payload.scheduled_end_time ? new Date(payload.scheduled_end_time) : null
  const durationSec =
    start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())
      ? Math.round((end.getTime() - start.getTime()) / 1000)
      : null

  const { error } = await supabase.from("meetings").insert({
    fathom_recording_id: recordingId,
    meeting_type: meetingType,
    link_status: linkStatus,
    title: payload.title ?? payload.meeting_title ?? null,
    scheduled_at: payload.scheduled_start_time ?? null,
    duration_sec: durationSec,
    recording_url: payload.url ?? null,
    share_url: payload.share_url ?? null,
    recorded_by_email: payload.recorded_by?.email ?? null,
    recorded_by_name: payload.recorded_by?.name ?? null,
    recorded_by_team: payload.recorded_by?.team ?? null,
    attendees,
    summary: payload.default_summary?.markdown_formatted ?? null,
    action_items: payload.action_items ?? null,
    transcript: renderTranscript(payload.transcript),
    raw: payload,
  })

  if (error) {
    return { ok: false, status: "error", error: error.message }
  }

  return {
    ok: true,
    status: "inserted",
    recording_id: recordingId,
    meeting_type: meetingType,
    link_status: linkStatus,
  }
}
