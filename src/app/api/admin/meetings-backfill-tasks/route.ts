import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { ingestMeetingActionItems } from "@/lib/meetings/action-items"

export const maxDuration = 300

/**
 * One-shot Phase D.1 backfill: walk every existing meeting that has
 * action_items and fan them into inbox_events. Idempotent, so running this
 * multiple times is safe — already-ingested items get their completion state
 * synced rather than re-inserted.
 *
 * Admin-only. Hit once after the migration so historical Fathom calls catch
 * up; new meetings auto-ingest via `ingestFathomMeeting`.
 *
 *   GET /api/admin/meetings-backfill-tasks
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const supabase = await createAdminClient()

  // We don't need full rows here — `ingestMeetingActionItems` re-fetches the
  // meeting on each call. Pulling just ids keeps the response/timing tight
  // even when the meetings table grows past a few thousand rows.
  const { data: meetings, error } = await supabase
    .from("meetings")
    .select("id")
    .not("action_items", "is", null)
    .order("scheduled_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let totalInserted = 0
  let totalCompletedSynced = 0
  let totalSkipped = 0
  let processed = 0
  const failures: Array<{ id: string; error: string }> = []

  for (const m of meetings ?? []) {
    try {
      const stats = await ingestMeetingActionItems(supabase, m.id)
      totalInserted += stats.inserted
      totalCompletedSynced += stats.completedSynced
      totalSkipped += stats.skipped
      processed++
    } catch (e) {
      failures.push({ id: m.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({
    ok: true,
    meetings_total: meetings?.length ?? 0,
    meetings_processed: processed,
    inserted: totalInserted,
    completed_synced: totalCompletedSynced,
    skipped_empty: totalSkipped,
    failures: failures.slice(0, 20),
    failure_count: failures.length,
  })
}
