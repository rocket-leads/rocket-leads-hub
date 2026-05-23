import type { SupabaseClient } from "@supabase/supabase-js"
import {
  classifyMeetingType,
  isRocketLeadsTeam,
  renderTranscript,
  type FathomMeeting,
} from "@/lib/integrations/fathom"
import { matchSingleMeeting } from "@/lib/meetings/matcher"
import { ingestMeetingActionItems } from "@/lib/meetings/action-items"
import { triggerKickoffBriefIfEligible, triggerEvalDigestIfEligible } from "@/lib/pedro/auto-trigger"

export type IngestResult =
  | { ok: true; status: "inserted"; recording_id: string; meeting_type: string; link_status: string; matched?: { clientId: string; strategy: string } }
  | { ok: true; status: "deduped"; recording_id: string }
  | { ok: true; status: "skipped_team"; recording_id: string; team: string | null }
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

  // Only ingest recordings whose Fathom team contains "Rocket Leads"
  // (case-insensitive). Personal calls in other teams (Founder Download,
  // private teams, externals) are skipped — AMs need to record client work
  // in a Rocket Leads team for it to land in the Hub.
  const team = payload.recorded_by?.team ?? null
  if (!isRocketLeadsTeam(team)) {
    return { ok: true, status: "skipped_team", recording_id: recordingId, team }
  }

  // Sales meetings used to be skipped at ingest ("most don't close, would
  // clutter the meetings overview"). 2026-05-23: changed to ingest them so
  // the Targets dashboard can pull recent sales-call transcripts when sales
  // funnel metrics (conversion / show-up / qual rate) go off-track and surface
  // the dominant theme via LLM. Sales rows are filtered out of the standard
  // meetings UI surfaces (home block, /pedro/meetings, client meetings tab)
  // by adding meeting_type != 'sales' filters at the query layer.
  const meetingType = classifyMeetingType(payload)

  const { data: existing } = await supabase
    .from("meetings")
    .select("id")
    .eq("fathom_recording_id", recordingId)
    .maybeSingle()
  if (existing) {
    return { ok: true, status: "deduped", recording_id: recordingId }
  }

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

  const { data: inserted, error } = await supabase
    .from("meetings")
    .insert({
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
    .select("id")
    .single()

  if (error || !inserted) {
    return { ok: false, status: "error", error: error?.message ?? "Insert returned no row" }
  }

  // Auto-match against clients only when the row landed unlinked (internal
  // calls don't need a client, archived isn't possible at insert time).
  // Failure to match is non-fatal — the row still exists; user can fix manually.
  let matched: { clientId: string; strategy: string } | undefined
  if (linkStatus === "unlinked") {
    try {
      const result = await matchSingleMeeting(supabase, inserted.id)
      if (result) matched = { clientId: result.clientId, strategy: result.strategy }
    } catch (e) {
      console.error("Matcher failed for meeting", inserted.id, e)
    }
  }

  // Phase D.1 — fan action items into the inbox. Runs regardless of whether
  // the matcher linked the meeting: each action item has its own assignee
  // resolved from fathom_email mapping, so the task can land on the right
  // person even if the meeting itself isn't yet attached to a client.
  // Non-fatal: a failure here shouldn't roll back the meeting insert.
  try {
    await ingestMeetingActionItems(supabase, inserted.id)
  } catch (e) {
    console.error("Action item ingest failed for meeting", inserted.id, e)
  }

  // Phase 4 (Pedro) — when this is a freshly-ingested kick-off and the
  // matcher linked it to a client, fire Pedro's auto-trigger so the CM
  // walks out of the kick-off meeting with a draft brief already waiting
  // in their inbox. Best-effort + dedupe internally — a re-ingested
  // kick-off won't double-fire because the trigger checks for an existing
  // pedro_client_state row before doing anything.
  if (meetingType === "kick_off" && matched?.clientId) {
    try {
      await triggerKickoffBriefIfEligible(supabase, inserted.id)
    } catch (e) {
      console.error("Pedro auto-trigger failed for meeting", inserted.id, e)
    }
  }

  // Phase 4 (Pedro) — evaluation meetings get a digest. Pedro reads the
  // transcript against the existing brief + latest refresh and ONLY
  // creates an inbox task if Claude marks it actionable. Routine evals
  // produce nothing — keeps the CM's inbox signal-rich. Dedupe via
  // inbox_events source_ref so re-ingest is safe.
  if (meetingType === "evaluation" && matched?.clientId) {
    try {
      await triggerEvalDigestIfEligible(supabase, inserted.id)
    } catch (e) {
      console.error("Pedro eval-trigger failed for meeting", inserted.id, e)
    }
  }

  return {
    ok: true,
    status: "inserted",
    recording_id: recordingId,
    meeting_type: meetingType,
    link_status: linkStatus,
    matched,
  }
}
