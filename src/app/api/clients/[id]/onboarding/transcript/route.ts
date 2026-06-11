import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { saveStepState } from "@/lib/clients/onboarding-state"

/**
 * Onboarding wizard Stap 2 - Fathom kick-off transcript link.
 *
 * GET - returns the candidate meetings the AM most likely just had with
 *       this client. Filter: recorded by the current session user,
 *       link_status IN ('unlinked', 'suggested'), scheduled within the
 *       last 14 days, and not already typed as `sales` / `evaluation` /
 *       `internal`. Ordered most-recent first.
 *
 * POST - confirms the AM-picked meeting as THE kick-off for this client.
 *        Writes `client_id` + flips `link_status` to 'linked' with
 *        `link_method='manual'`. Also marks the wizard step done with
 *        content { meetingId, transcriptLen }.
 *
 * If Fathom hasn't fired its webhook yet (transcript still processing),
 * the candidates list comes back empty - the UI shows a "wachten op
 * transcript" empty state and the AM refreshes when they expect it to
 * have landed.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  await params // unused: meetings filter is by AM, not by client. Kept in
  //              the path signature so the wizard's URL pattern is
  //              consistent (every step endpoint is scoped to the client).

  const supabase = await createAdminClient()
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from("meetings")
    .select(
      "id, fathom_recording_id, title, scheduled_at, duration_sec, recording_url, share_url, attendees, summary, link_status, meeting_type, match_score, match_candidates",
    )
    .ilike("recorded_by_email", session.user.email)
    .in("link_status", ["unlinked", "suggested"])
    .gte("scheduled_at", cutoff)
    .or("meeting_type.is.null,meeting_type.eq.kick_off,meeting_type.eq.other")
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .limit(5)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ candidates: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const body = (await req.json()) as { meetingId?: string }
  if (!body.meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Update the meeting row: link to this client, classify as kick_off,
  // bump link_status to 'linked'. We don't touch transcript / summary -
  // those are Fathom's responsibility.
  const { data: updated, error: updateErr } = await supabase
    .from("meetings")
    .update({
      client_id: mondayItemId,
      meeting_type: "kick_off",
      link_status: "linked",
      link_method: "manual",
      linked_at: new Date().toISOString(),
      linked_by: session.user.id,
    })
    .eq("id", body.meetingId)
    .select("id, fathom_recording_id, recording_url, share_url, transcript, summary")
    .single()

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? "Meeting not found" },
      { status: 404 },
    )
  }

  // Persist the wizard step's content + flip done. Stap 3 (brief
  // enrichment) reads this to know which meeting's transcript to feed
  // into Pedro's enrichment prompt.
  await saveStepState({
    mondayItemId,
    stepKey: "transcript_link",
    done: true,
    content: {
      meetingId: updated.id,
      fathomRecordingId: updated.fathom_recording_id,
      recordingUrl: updated.recording_url,
      shareUrl: updated.share_url,
      transcriptLength:
        typeof updated.transcript === "string" ? updated.transcript.length : 0,
      summaryPresent: Boolean(updated.summary),
    },
    userId: session.user.id,
  })

  return NextResponse.json({ ok: true })
}
