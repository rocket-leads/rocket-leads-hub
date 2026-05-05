import type { SupabaseClient } from "@supabase/supabase-js"
import type { MeetingRow } from "./types"

/**
 * Phase D.1 — Fathom action items → Hub inbox tasks.
 *
 * Each action item attached to a Fathom meeting becomes an inbox_events row
 * with kind='task', source='meeting' so it shows up in the assignee's Tasks
 * tab + sidebar badge alongside Trengo/Monday/automation tasks. Gets us to
 * "one place to see what I owe" without each person having to scrub through
 * meeting cards.
 *
 * Idempotency: each row's source_ref carries `fathomRecordingId` +
 * `actionItemIndex`, so re-running this function on the same meeting is a
 * no-op for already-ingested items. Completion state is reconciled on every
 * run — if Fathom flips an action item to `completed: true`, the matching
 * Hub task is moved to status='done' even if it was created earlier as open.
 *
 * Assignee resolution chain (first hit wins):
 *   1. action_item.assignee.email → users.fathom_email
 *   2. meeting.recorded_by_email → users.fathom_email   (host as fallback)
 *   3. HQ admin user                                    (last-ditch catch-all)
 */

const ACTION_ITEM_RULE = "fathom_action_item" as const

type IngestStats = {
  inserted: number
  completedSynced: number
  skipped: number
}

export async function ingestMeetingActionItems(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<IngestStats> {
  const empty: IngestStats = { inserted: 0, completedSynced: 0, skipped: 0 }

  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, fathom_recording_id, client_id, title, scheduled_at, share_url, recorded_by_email, action_items",
    )
    .eq("id", meetingId)
    .maybeSingle<
      Pick<
        MeetingRow,
        | "id"
        | "fathom_recording_id"
        | "client_id"
        | "title"
        | "scheduled_at"
        | "share_url"
        | "recorded_by_email"
        | "action_items"
      >
    >()
  if (!meeting?.action_items?.length) return empty

  const hqId = await getHqAuthorId(supabase)
  if (!hqId) {
    // Without a system author there's nowhere to record the row even when
    // assignee resolution succeeds (author_id is NOT NULL). Skip silently;
    // worth a log but not worth blocking ingest.
    console.warn("ingestMeetingActionItems: no HQ author id, skipping")
    return empty
  }

  const usersByFathomEmail = await loadFathomEmailMap(supabase)
  const hostUserId = meeting.recorded_by_email
    ? usersByFathomEmail.get(meeting.recorded_by_email.toLowerCase()) ?? null
    : null

  // Pull every existing row for this recording in one shot so we can decide
  // insert vs sync vs skip without N round-trips.
  const { data: existingRows } = await supabase
    .from("inbox_events")
    .select("id, status, source_ref")
    .eq("source", "meeting")
    .filter("source_ref->>fathomRecordingId", "eq", meeting.fathom_recording_id)
  const existingByIndex = new Map<number, { id: string; status: string }>()
  for (const row of existingRows ?? []) {
    const idx = Number((row.source_ref as Record<string, unknown> | null)?.actionItemIndex)
    if (Number.isInteger(idx)) existingByIndex.set(idx, { id: row.id, status: row.status })
  }

  const stats = { ...empty }

  for (let i = 0; i < meeting.action_items.length; i++) {
    const item = meeting.action_items[i]
    const description = (item?.description ?? "").trim()
    if (!description) {
      stats.skipped++
      continue
    }

    const assigneeEmail = item.assignee?.email?.toLowerCase() ?? null
    const assigneeId =
      (assigneeEmail ? usersByFathomEmail.get(assigneeEmail) : null) ?? hostUserId ?? hqId

    const existing = existingByIndex.get(i)
    if (existing) {
      // Sync completion state only — never roll a 'done' task back to 'open'
      // (a human may have closed it in the Hub independently).
      if (item.completed && existing.status === "open") {
        const { error } = await supabase
          .from("inbox_events")
          .update({ status: "done", completed_at: new Date().toISOString() })
          .eq("id", existing.id)
          .eq("status", "open")
        if (!error) stats.completedSynced++
      }
      continue
    }

    // First-time insert. We preserve `created_at_src = scheduled_at` so the
    // task sorts by when the meeting actually happened, not when ingest ran.
    const titlePreview =
      description.length > 100 ? description.slice(0, 100) + "…" : description
    const bodyParts = [
      meeting.title ? `From meeting: ${meeting.title}` : null,
      description.length > 100 ? description : null,
      item.recording_playback_url ? `Playback: ${item.recording_playback_url}` : null,
      meeting.share_url ? `Meeting: ${meeting.share_url}` : null,
    ].filter(Boolean) as string[]

    const status = item.completed ? "done" : "open"
    const completedAt = item.completed ? new Date().toISOString() : null

    const { error } = await supabase.from("inbox_events").insert({
      kind: "task",
      client_id: meeting.client_id ?? "",
      author_id: hqId,
      assignee_id: assigneeId,
      title: titlePreview || "Action item",
      body: bodyParts.length > 0 ? bodyParts.join("\n") : null,
      status,
      priority: "normal",
      source: "meeting",
      source_ref: {
        rule: ACTION_ITEM_RULE,
        fathomRecordingId: meeting.fathom_recording_id,
        meetingId: meeting.id,
        actionItemIndex: i,
        userGenerated: item.user_generated ?? false,
        recordingPlaybackUrl: item.recording_playback_url ?? null,
      },
      created_at_src: meeting.scheduled_at ?? null,
      completed_at: completedAt,
    })
    if (!error) stats.inserted++
  }

  return stats
}

/**
 * When a meeting gets linked to a client (auto-match or manual "Link to
 * client"), the action-item rows that were ingested while the meeting was
 * still unlinked have `client_id = ''`. Fix them in-place so the per-client
 * timeline + filters pick them up.
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

async function loadFathomEmailMap(
  supabase: SupabaseClient,
): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("users")
    .select("id, fathom_email")
    .not("fathom_email", "is", null)
  const map = new Map<string, string>()
  for (const row of (data ?? []) as Array<{ id: string; fathom_email: string | null }>) {
    if (row.fathom_email) map.set(row.fathom_email.toLowerCase(), row.id)
  }
  return map
}

async function getHqAuthorId(supabase: SupabaseClient): Promise<string | null> {
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle<{ id: string }>()
  if (hq) return hq.id
  const { data: admin } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()
  return admin?.id ?? null
}
