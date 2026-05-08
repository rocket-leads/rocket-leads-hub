import type { SupabaseClient } from "@supabase/supabase-js"
import { generateAutoBrief } from "@/lib/pedro/generate-brief"

/**
 * Pedro auto-trigger: when a kick-off meeting is ingested via Fathom,
 * pre-draft the campaign brief so the CM walks out of the meeting and
 * Pedro already has a draft waiting.
 *
 * Behaviour (per Roy's spec, 2026-05-08):
 *  - Trigger: only on `meeting_type === 'kick_off'` with a linked client
 *  - One shot: skip if the client already has a `pedro_client_state` row
 *    (no re-runs on re-ingest)
 *  - Output: an inbox task assigned to the campaign manager. The brief
 *    is saved to `pedro_client_state` as a DRAFT — the CM opens Pedro,
 *    picks the client, and the fields are pre-filled but fully editable.
 *  - Failure mode: silent. The meeting is still ingested; only the
 *    Pedro pre-drafting is best-effort.
 *
 * Lives under `src/lib/pedro/` (not `src/lib/meetings/`) because the
 * caller is the meetings ingest, but the logic is a Pedro feature —
 * pre-drafting is Pedro's job, the meetings pipeline just notifies it.
 */

type MeetingRow = {
  id: string
  client_id: string | null
  meeting_type: string | null
  fathom_recording_id: string | null
  scheduled_at: string | null
  title: string | null
}

export type AutoTriggerResult =
  | { status: "skipped"; reason: string }
  | { status: "triggered"; clientId: string; taskId: string | null }

/**
 * Fired from `ingestFathomMeeting` once a fresh meeting row exists.
 * Returns a result for logging/tests; never throws.
 */
export async function triggerKickoffBriefIfEligible(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<AutoTriggerResult> {
  try {
    // ── 1. Load the meeting ──
    const { data: meetingRaw } = await supabase
      .from("meetings")
      .select("id, client_id, meeting_type, fathom_recording_id, scheduled_at, title")
      .eq("id", meetingId)
      .maybeSingle()
    const meeting = meetingRaw as MeetingRow | null
    if (!meeting) return { status: "skipped", reason: "meeting not found" }

    if (meeting.meeting_type !== "kick_off") {
      return { status: "skipped", reason: `meeting_type=${meeting.meeting_type}` }
    }
    if (!meeting.client_id) {
      return { status: "skipped", reason: "meeting not linked to a client yet" }
    }

    // ── 2. Dedupe — never overwrite an existing Pedro brief ──
    // No-rerun rule: if any pedro_client_state row exists for this client
    // (any campaign_number), the CM has already started Pedro. Don't blast
    // an auto-draft on top of their work.
    const { data: existing } = await supabase
      .from("pedro_client_state")
      .select("id")
      .eq("client_id", meeting.client_id)
      .limit(1)
      .maybeSingle()
    if (existing) {
      return { status: "skipped", reason: "client already has a Pedro state row" }
    }

    // ── 3. Generate the brief ──
    let briefResult: Awaited<ReturnType<typeof generateAutoBrief>>
    try {
      briefResult = await generateAutoBrief(supabase, meeting.client_id)
    } catch (e) {
      console.error("Pedro auto-trigger: brief generation failed", e)
      return { status: "skipped", reason: "brief generation failed" }
    }

    const { brief, meta } = briefResult

    // ── 4. Save as DRAFT — campaign #1, brief jsonb mirrors the form
    // shape Pedro UI uses (bedrijf/sector/doel/pijn/aanbod/usps/hooksAM).
    // Auto-save in the UI will overwrite this once the CM edits. ──
    try {
      await supabase
        .from("pedro_client_state")
        .upsert(
          {
            client_id: meeting.client_id,
            campaign_number: 1,
            brief: {
              bedrijf: brief.bedrijf,
              sector: brief.sector,
              doel: brief.doelgroep,
              pijn: brief.pijnpunten,
              aanbod: brief.aanbod,
              usps: brief.usps,
              hooksAM: brief.marketingHooks,
              hooksExtra: "",
            },
            auto_brief_meta: {
              source: brief.source,
              autoTriggered: true,
              triggeredFromMeeting: meeting.id,
              fathomRecordingId: meeting.fathom_recording_id,
              triggeredAt: new Date().toISOString(),
              websiteUrl: brief.websiteUrl,
              driveLink: brief.driveLink,
              ...meta,
            },
          },
          { onConflict: "client_id,campaign_number" },
        )
    } catch (e) {
      console.error("Pedro auto-trigger: save brief failed", e)
      return { status: "skipped", reason: "save brief failed" }
    }

    // ── 5. Resolve the campaign manager → hub user_id ──
    // CM is on the Monday client item. We map Monday person name → hub
    // user via `user_column_mappings` (same helper action-items.ts uses).
    let cmUserId: string | null = null
    try {
      const { data: client } = await supabase
        .from("clients")
        .select("campaign_manager")
        .eq("monday_item_id", meeting.client_id)
        .maybeSingle<{ campaign_manager: string | null }>()
      const cmName = client?.campaign_manager?.trim() || null
      if (cmName) {
        const { data: mapping } = await supabase
          .from("user_column_mappings")
          .select("user_id")
          .eq("monday_column_role", "campaign_manager")
          .eq("monday_person_name", cmName)
          .maybeSingle<{ user_id: string }>()
        cmUserId = mapping?.user_id ?? null
      }
    } catch (e) {
      console.error("Pedro auto-trigger: CM resolve failed", e)
    }

    // ── 6. Create the inbox task for the CM ──
    // Even when CM resolution fails we still create an unassigned task —
    // better to surface "Pedro is klaar" somewhere than nowhere. The
    // /inbox UI handles unassigned tasks; an admin can re-assign.
    const taskTitle = `Pedro brief klaar voor ${meta.clientName} — review en start campagne`
    const taskBody = [
      `Pedro heeft een **draft brief** klaargelegd op basis van de kick-off (${meeting.scheduled_at?.slice(0, 10) ?? ""}).`,
      "",
      "**Wat Pedro heeft gepakt:**",
      meta.hasKickoffMeeting ? "- Kick-off transcript (Fathom)" : null,
      meta.hasKickoffUpdate ? "- Kick-off update op Monday item" : null,
      meta.hasLatestEval ? "- Meest recente evaluatie meeting" : null,
      meta.monthlyUpdateCount > 0 ? `- ${meta.monthlyUpdateCount} recente Monday updates` : null,
      meta.hasTrengo ? "- Recente Trengo berichten" : null,
      "",
      `_Pedro's bron: ${brief.source || "—"}_`,
      "",
      `Open Pedro → kies "${meta.clientName}" → de brief is pre-filled. Bewerk waar nodig en run angles.`,
      "",
      `[→ Open in Pedro](/pedro?tab=brief&clientId=${meeting.client_id})`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n")

    let taskId: string | null = null
    try {
      const { data: inserted } = await supabase
        .from("inbox_events")
        .insert({
          kind: "task",
          client_id: meeting.client_id,
          author_id: null,
          assignee_id: cmUserId,
          title: taskTitle,
          body: taskBody,
          status: "open",
          priority: "normal",
          source: "automation",
          source_ref: {
            kind: "pedro_kickoff_brief",
            meetingId: meeting.id,
            fathomRecordingId: meeting.fathom_recording_id,
            clientId: meeting.client_id,
          },
          created_at_src: meeting.scheduled_at ?? null,
        })
        .select("id")
        .single<{ id: string }>()
      taskId = inserted?.id ?? null
    } catch (e) {
      console.error("Pedro auto-trigger: task insert failed", e)
    }

    return { status: "triggered", clientId: meeting.client_id, taskId }
  } catch (e) {
    // Top-level guard — auto-trigger must never break ingest.
    console.error("Pedro auto-trigger: unexpected error", e)
    return { status: "skipped", reason: "unexpected error" }
  }
}
