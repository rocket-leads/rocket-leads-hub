import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Legacy meeting-task relinker.
 *
 * Roy 2026-06-10: Fathom-driven auto-task creation was removed entirely —
 * meetings no longer fan their action_items into inbox tasks. This helper
 * stays behind so existing meeting-source tasks (created before the rip)
 * still get their client_id patched in when an admin manually links a
 * meeting to a client afterwards. Without the patch those tasks would
 * remain orphaned on the timeline.
 *
 * No new tasks are created here — this is strictly an update on rows that
 * already exist with source='meeting'.
 */
export async function backfillActionItemClientId(
  supabase: SupabaseClient,
  meetingId: string,
  clientMondayItemId: string,
): Promise<number> {
  const { data: meeting } = await supabase
    .from("meetings")
    .select("fathom_recording_id")
    .eq("id", meetingId)
    .maybeSingle<{ fathom_recording_id: string }>()
  if (!meeting) return 0

  const { data: rows } = await supabase
    .from("inbox_events")
    .update({ client_id: clientMondayItemId })
    .eq("source", "meeting")
    .filter("source_ref->>fathomRecordingId", "eq", meeting.fathom_recording_id)
    .or("client_id.is.null,client_id.eq.")
    .select("id")
  return rows?.length ?? 0
}
