import type { SupabaseClient } from "@supabase/supabase-js"
import type { MeetingRow } from "./types"

/**
 * Phase D.1 — Fathom action items → ONE bundled Hub task per meeting.
 *
 * The first version of this file fanned out one inbox task per action item.
 * That swamped the inbox with a dozen tiny rows for a single call. This
 * version creates a single task per meeting with the items split into:
 *   - "Taken voor het team" — items whose Fathom assignee is a Hub user
 *     (matched via users.fathom_email)
 *   - "Taken voor de klant" — everything else (including unassigned items
 *     and items assigned to attendees who aren't in the Hub team)
 *
 * The AM/host gets one Hub task per call: review, work the team items, and
 * follow up with the client on the client items. They close the bundle once
 * they've handled it (or it auto-closes when every Fathom item is completed).
 *
 * Idempotency: source_ref carries `fathomRecordingId` and we keep at most one
 * bundled row per recording. Re-running the function on the same meeting
 * (live ingest, manual link, admin backfill) syncs completion forward but
 * never overwrites the body — preserves any human edits made in the Hub.
 */

const ACTION_ITEM_RULE = "fathom_action_items_bundle" as const
const LEGACY_PER_ITEM_RULE = "fathom_action_item" as const

type IngestStats = {
  inserted: number
  updated: number
  skipped: number
}

const DUTCH_MEETING_TYPE: Record<string, string> = {
  sales: "salesgesprek",
  kick_off: "kick-off call",
  evaluation: "evaluatiegesprek",
  internal: "interne meeting",
  other: "meeting",
}

type CategorizedItem = {
  description: string
  completed: boolean
  assigneeName: string | null
  assigneeEmail: string | null
  recordingPlaybackUrl: string | null
}

export async function ingestMeetingActionItems(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<IngestStats> {
  const empty: IngestStats = { inserted: 0, updated: 0, skipped: 0 }

  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, fathom_recording_id, client_id, title, scheduled_at, share_url, recorded_by_email, recorded_by_name, meeting_type, attendees, action_items",
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
        | "recorded_by_name"
        | "meeting_type"
        | "attendees"
        | "action_items"
      >
    >()
  if (!meeting) return empty

  // One-time cleanup: the v1 ingester wrote one row per item with
  // `actionItemIndex` in source_ref. Drop those before considering the
  // bundled write so we don't carry duplicates forward.
  const legacyDeleted = await deleteLegacyPerItemRows(supabase, meeting.fathom_recording_id)

  const items = (meeting.action_items ?? []).filter(
    (a) => typeof a?.description === "string" && a.description.trim().length > 0,
  )
  if (items.length === 0) {
    if (legacyDeleted > 0) return { ...empty, updated: legacyDeleted }
    return empty
  }

  const usersByFathomEmail = await loadFathomEmailMap(supabase)
  const hqId = await getHqAuthorId(supabase)
  if (!hqId) {
    console.warn("ingestMeetingActionItems: no HQ author id, skipping")
    return empty
  }

  // Bundled task always assigned to the meeting host (the AM/CM who recorded
  // the call). They distribute internally if multiple Hub people have items.
  // Falls back to HQ when the host isn't mapped to a Hub user yet.
  const hostUserId = meeting.recorded_by_email
    ? usersByFathomEmail.get(meeting.recorded_by_email.toLowerCase()) ?? null
    : null
  const assigneeId = hostUserId ?? hqId

  // Categorise each item once. An item belongs to the team only when its
  // assignee email maps to a Hub user; otherwise we treat it as a client
  // task (covers explicit client assignees AND unassigned items, which in
  // Fathom usually means "the client should do this").
  const categorized: { team: CategorizedItem[]; client: CategorizedItem[] } = {
    team: [],
    client: [],
  }
  for (const item of items) {
    const email = item.assignee?.email?.toLowerCase() ?? null
    const isTeam = !!email && usersByFathomEmail.has(email)
    const ci: CategorizedItem = {
      description: item.description.trim(),
      completed: !!item.completed,
      assigneeName: item.assignee?.name ?? null,
      assigneeEmail: email,
      recordingPlaybackUrl: item.recording_playback_url ?? null,
    }
    if (isTeam) categorized.team.push(ci)
    else categorized.client.push(ci)
  }

  const allCompleted = items.every((i) => i.completed === true)
  const status = allCompleted ? "done" : "open"
  const completedAt = allCompleted ? new Date().toISOString() : null

  // Title needs the client name when we know it. We've got the monday_item_id
  // on the meeting; one cheap lookup gets us the name.
  const clientName = meeting.client_id
    ? await getClientName(supabase, meeting.client_id)
    : null

  const typeLabel = DUTCH_MEETING_TYPE[meeting.meeting_type ?? "other"] ?? "meeting"
  const titleSubject = clientName ? `${typeLabel} met ${clientName}` : typeLabel
  const title = `Taken uit ${titleSubject}`

  const body = renderBundleBody({
    typeLabel,
    clientName,
    meetingTitle: meeting.title,
    scheduledAt: meeting.scheduled_at,
    shareUrl: meeting.share_url,
    hostName: meeting.recorded_by_name,
    team: categorized.team,
    client: categorized.client,
  })

  const sourceRef = {
    rule: ACTION_ITEM_RULE,
    fathomRecordingId: meeting.fathom_recording_id,
    meetingId: meeting.id,
    teamItemCount: categorized.team.length,
    clientItemCount: categorized.client.length,
    allCompleted,
  }

  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id, status")
    .eq("source", "meeting")
    .filter("source_ref->>fathomRecordingId", "eq", meeting.fathom_recording_id)
    .filter("source_ref->>rule", "eq", ACTION_ITEM_RULE)
    .maybeSingle<{ id: string; status: string }>()

  if (existing) {
    // Sync completion state forward only — never overwrite a body the user
    // may have edited, never roll a 'done' Hub task back to 'open'.
    if (allCompleted && existing.status === "open") {
      const { error } = await supabase
        .from("inbox_events")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          source_ref: sourceRef,
        })
        .eq("id", existing.id)
        .eq("status", "open")
      if (!error) return { ...empty, updated: 1 }
    }
    return { ...empty, skipped: 1 }
  }

  const { error } = await supabase.from("inbox_events").insert({
    kind: "task",
    client_id: meeting.client_id ?? "",
    author_id: hqId,
    assignee_id: assigneeId,
    title,
    body,
    status,
    priority: "normal",
    source: "meeting",
    source_ref: sourceRef,
    created_at_src: meeting.scheduled_at ?? null,
    completed_at: completedAt,
  })
  if (error) return empty
  return { ...empty, inserted: 1 }
}

/**
 * Patch the bundled task's client_id when the meeting gets linked after
 * ingest. Mirrors the v1 helper's signature so callers don't need to change.
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

function renderBundleBody(input: {
  typeLabel: string
  clientName: string | null
  meetingTitle: string | null
  scheduledAt: string | null
  shareUrl: string | null
  hostName: string | null
  team: CategorizedItem[]
  client: CategorizedItem[]
}): string {
  const lines: string[] = []
  const dateBit = input.scheduledAt ? formatDateNl(input.scheduledAt) : null
  if (input.clientName) {
    lines.push(`Taken voortkomend uit de ${input.typeLabel} met ${input.clientName}${dateBit ? ` (${dateBit})` : ""}.`)
  } else {
    lines.push(`Taken voortkomend uit deze ${input.typeLabel}${dateBit ? ` van ${dateBit}` : ""}.`)
  }
  lines.push("")

  if (input.team.length > 0) {
    lines.push("Taken voor het team:")
    for (const item of input.team) {
      const owner = item.assigneeName || item.assigneeEmail || input.hostName || "team"
      const mark = item.completed ? "[x]" : "[ ]"
      lines.push(`• ${mark} ${item.description} — ${owner}`)
    }
    lines.push("")
  }

  if (input.client.length > 0) {
    lines.push("Taken voor de klant:")
    for (const item of input.client) {
      const owner = item.assigneeName || item.assigneeEmail || (input.clientName ?? "klant")
      const mark = item.completed ? "[x]" : "[ ]"
      lines.push(`• ${mark} ${item.description} — ${owner}`)
    }
    lines.push("")
  }

  if (input.shareUrl) lines.push(`Meeting: ${input.shareUrl}`)
  return lines.join("\n").trimEnd()
}

function formatDateNl(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })
}

async function getClientName(
  supabase: SupabaseClient,
  mondayItemId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle<{ name: string }>()
  return data?.name ?? null
}

async function deleteLegacyPerItemRows(
  supabase: SupabaseClient,
  fathomRecordingId: string,
): Promise<number> {
  const { data: deleted } = await supabase
    .from("inbox_events")
    .delete()
    .eq("source", "meeting")
    .filter("source_ref->>fathomRecordingId", "eq", fathomRecordingId)
    .filter("source_ref->>rule", "eq", LEGACY_PER_ITEM_RULE)
    .select("id")
  return deleted?.length ?? 0
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
