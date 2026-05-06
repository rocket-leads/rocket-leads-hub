import type { SupabaseClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import type { MeetingRow } from "./types"
import { detectMostActiveTrengoChannel } from "@/lib/inbox/channel-detect"
import { draftMeetingFollowupMessage } from "@/lib/inbox/reply-drafter"
import { sendInboxAssignmentPush } from "@/lib/notifications/inbox-trigger"

/**
 * Phase D.1 (rewrite v2) — Fathom transcript → bundled Hub tasks per role.
 *
 * The previous version trusted Fathom's auto-extracted `action_items` array
 * verbatim. Roy's feedback: those items are too thin / ambiguous, often miss
 * what the AM ACTUALLY committed to in conversation. So we now read the full
 * transcript and ask Claude Haiku to extract concrete commitments in Dutch,
 * classified by who's responsible:
 *
 *   - host    → the AM who recorded the meeting (bundled with client items
 *                 in one task; the AM also gets the client-follow-up draft)
 *   - cm      → the campaign manager linked to the client (separate task on
 *                 the CM)
 *   - setter  → the appointment setter linked to the client (separate task)
 *   - client  → things the client agreed to deliver (folded into host bundle
 *                 + AI follow-up draft)
 *
 * Idempotency: each created task carries `source_ref.rule = 'fathom_…' +
 * recording_id`. Re-running a meeting upserts completion only — never
 * overwrites bodies the user may have edited.
 *
 * Falls back to Fathom's auto-extracted `action_items` when:
 *   - the transcript is empty/missing
 *   - the AI call fails
 * That keeps the path resilient while we lean on the better extraction.
 */

const anthropic = new Anthropic()

const HOST_BUNDLE_RULE = "fathom_action_items_bundle" as const
const CM_TASK_RULE = "fathom_action_items_cm" as const
const SETTER_TASK_RULE = "fathom_action_items_setter" as const
const LEGACY_PER_ITEM_RULE = "fathom_action_item" as const

const DUTCH_MEETING_TYPE: Record<string, string> = {
  sales: "salesgesprek",
  kick_off: "kick-off call",
  evaluation: "evaluatiegesprek",
  internal: "interne meeting",
  other: "meeting",
}

type IngestStats = {
  inserted: number
  updated: number
  skipped: number
}

type AssigneeRole = "host" | "cm" | "setter" | "client"

type ExtractedItem = {
  description: string
  assignee_role: AssigneeRole
  context?: string
}

type CategorizedItem = {
  description: string
  completed: boolean
  context: string | null
  assigneeName: string | null
}

type RoleGroups = {
  host: CategorizedItem[]
  cm: CategorizedItem[]
  setter: CategorizedItem[]
  client: CategorizedItem[]
}

export async function ingestMeetingActionItems(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<IngestStats> {
  const empty: IngestStats = { inserted: 0, updated: 0, skipped: 0 }

  // Pull every field downstream code might need in one round-trip — full
  // transcript included for AI extraction.
  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, fathom_recording_id, client_id, title, scheduled_at, share_url, recorded_by_email, recorded_by_name, meeting_type, attendees, action_items, transcript",
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
      > & { transcript: string | null }
    >()
  if (!meeting) return empty

  // Cleanup of v1 per-item rows happens regardless — we don't want
  // duplicates lying around if a meeting gets re-ingested today.
  const legacyDeleted = await deleteLegacyPerItemRows(supabase, meeting.fathom_recording_id)

  const hqId = await getHqAuthorId(supabase)
  if (!hqId) {
    console.warn("ingestMeetingActionItems: no HQ author id, skipping")
    return empty
  }

  const usersByFathomEmail = await loadFathomEmailMap(supabase)
  const hostUserId = meeting.recorded_by_email
    ? usersByFathomEmail.get(meeting.recorded_by_email.toLowerCase()) ?? null
    : null

  const clientName = meeting.client_id ? await getClientName(supabase, meeting.client_id) : null
  const clientPeople = meeting.client_id
    ? await getClientPeople(supabase, meeting.client_id)
    : { campaignManager: null, appointmentSetter: null }
  const cmUserId = clientPeople.campaignManager
    ? await resolveByMondayName(supabase, "campaign_manager", clientPeople.campaignManager)
    : null
  const setterUserId = clientPeople.appointmentSetter
    ? await resolveByMondayName(supabase, "appointment_setter", clientPeople.appointmentSetter)
    : null

  // Try AI extraction from the transcript first; fall back to whatever Fathom
  // auto-extracted. Either way, end up with the same RoleGroups shape so
  // downstream code is identical.
  const groups = await categorize({
    transcript: meeting.transcript,
    fathomItems: meeting.action_items,
    meetingTypeLabel: DUTCH_MEETING_TYPE[meeting.meeting_type ?? "other"] ?? "meeting",
    clientName,
    hostName: meeting.recorded_by_name,
    cmName: clientPeople.campaignManager,
    setterName: clientPeople.appointmentSetter,
    usersByFathomEmail,
  })

  const totalItems =
    groups.host.length + groups.cm.length + groups.setter.length + groups.client.length
  if (totalItems === 0) {
    if (legacyDeleted > 0) return { ...empty, updated: legacyDeleted }
    return empty
  }

  const allCompleted =
    [...groups.host, ...groups.cm, ...groups.setter, ...groups.client].every((i) => i.completed)
  const typeLabel = DUTCH_MEETING_TYPE[meeting.meeting_type ?? "other"] ?? "meeting"

  let stats = { ...empty }

  // --- Host bundle (host + client items, with follow-up draft) ----------
  if (groups.host.length > 0 || groups.client.length > 0) {
    const titleSubject = clientName ? `${typeLabel} met ${clientName}` : typeLabel
    const title = `Taken uit ${titleSubject}`
    const body = renderHostBundleBody({
      typeLabel,
      clientName,
      scheduledAt: meeting.scheduled_at,
      shareUrl: meeting.share_url,
      hostName: meeting.recorded_by_name,
      host: groups.host,
      client: groups.client,
    })

    // Optional client follow-up draft for the host bundle (same logic as
    // before). Only generated when there are client items + the meeting is
    // linked + we can detect a Trengo channel.
    const openClientItems = groups.client.filter((i) => !i.completed)
    let draftMessage: string | null = null
    let draftChannel: "trengo_email" | "trengo_whatsapp" | null = null
    if (!allCompleted && openClientItems.length > 0 && meeting.client_id && clientName) {
      try {
        const { data: clientRow } = await supabase
          .from("clients")
          .select("trengo_contact_ids")
          .eq("monday_item_id", meeting.client_id)
          .maybeSingle<{ trengo_contact_ids: string[] | null }>()
        const trengoContactId = clientRow?.trengo_contact_ids?.[0] ?? null
        const detected = trengoContactId
          ? await detectMostActiveTrengoChannel(trengoContactId)
          : null
        const channel = detected ?? "email"
        draftChannel = channel === "whatsapp" ? "trengo_whatsapp" : "trengo_email"
        const externalAttendee = (meeting.attendees ?? []).find((a) => a.is_external)
        const firstName = externalAttendee?.name?.split(" ")[0] ?? clientName.split(" ")[0]
        draftMessage = await draftMeetingFollowupMessage({
          firstName,
          clientName,
          meetingTypeLabel: typeLabel,
          items: openClientItems.map((i) => i.description),
          channel,
        })
      } catch (e) {
        console.error("Meeting follow-up draft failed:", e)
      }
    }

    const sourceRef: Record<string, unknown> = {
      rule: HOST_BUNDLE_RULE,
      fathomRecordingId: meeting.fathom_recording_id,
      meetingId: meeting.id,
      hostItemCount: groups.host.length,
      clientItemCount: groups.client.length,
      allCompleted,
    }
    if (draftMessage && draftChannel) {
      sourceRef.draft_message = draftMessage
      sourceRef.draft_channel = draftChannel
    }

    const upsertResult = await upsertMeetingTask(supabase, {
      meeting,
      rule: HOST_BUNDLE_RULE,
      assigneeId: hostUserId ?? hqId,
      authorId: hqId,
      title,
      body,
      sourceRef,
      allCompleted,
    })
    stats = mergeStats(stats, upsertResult)
  }

  // --- Delegated tasks (CM + Setter) -------------------------------------
  if (groups.cm.length > 0 && cmUserId) {
    const subject = clientName ? ` voor ${clientName}` : ""
    const title = `Taken vanuit ${meeting.recorded_by_name ?? "AM"}${subject} (${typeLabel})`
    const body = renderDelegatedBody({
      typeLabel,
      clientName,
      scheduledAt: meeting.scheduled_at,
      shareUrl: meeting.share_url,
      hostName: meeting.recorded_by_name,
      role: "campagnemanager",
      items: groups.cm,
    })
    const sourceRef: Record<string, unknown> = {
      rule: CM_TASK_RULE,
      fathomRecordingId: meeting.fathom_recording_id,
      meetingId: meeting.id,
      itemCount: groups.cm.length,
      delegatedFromHostName: meeting.recorded_by_name,
    }
    const r = await upsertMeetingTask(supabase, {
      meeting,
      rule: CM_TASK_RULE,
      assigneeId: cmUserId,
      authorId: hqId,
      title,
      body,
      sourceRef,
      allCompleted: groups.cm.every((i) => i.completed),
    })
    stats = mergeStats(stats, r)
  }

  if (groups.setter.length > 0 && setterUserId) {
    const subject = clientName ? ` voor ${clientName}` : ""
    const title = `Taken vanuit ${meeting.recorded_by_name ?? "AM"}${subject} (${typeLabel})`
    const body = renderDelegatedBody({
      typeLabel,
      clientName,
      scheduledAt: meeting.scheduled_at,
      shareUrl: meeting.share_url,
      hostName: meeting.recorded_by_name,
      role: "appointment setter",
      items: groups.setter,
    })
    const sourceRef: Record<string, unknown> = {
      rule: SETTER_TASK_RULE,
      fathomRecordingId: meeting.fathom_recording_id,
      meetingId: meeting.id,
      itemCount: groups.setter.length,
      delegatedFromHostName: meeting.recorded_by_name,
    }
    const r = await upsertMeetingTask(supabase, {
      meeting,
      rule: SETTER_TASK_RULE,
      assigneeId: setterUserId,
      authorId: hqId,
      title,
      body,
      sourceRef,
      allCompleted: groups.setter.every((i) => i.completed),
    })
    stats = mergeStats(stats, r)
  }

  return stats
}

/**
 * Patch the meeting tasks' client_id when the meeting gets linked after
 * ingest. Updates ALL meeting-source rows for this recording (host bundle +
 * any cm/setter tasks) so the per-client timeline picks them up.
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

// --- Categorisation -----------------------------------------------------

async function categorize(input: {
  transcript: string | null
  fathomItems: MeetingRow["action_items"]
  meetingTypeLabel: string
  clientName: string | null
  hostName: string | null
  cmName: string | null
  setterName: string | null
  usersByFathomEmail: Map<string, string>
}): Promise<RoleGroups> {
  const transcript = (input.transcript ?? "").trim()
  const empty: RoleGroups = { host: [], cm: [], setter: [], client: [] }

  // Try AI extraction when we have a transcript long enough to be meaningful.
  // Below ~200 chars it's almost certainly garbage / no real conversation.
  if (transcript.length > 200) {
    try {
      const items = await extractFromTranscript({
        transcript,
        meetingTypeLabel: input.meetingTypeLabel,
        clientName: input.clientName,
        hostName: input.hostName,
        cmName: input.cmName,
        setterName: input.setterName,
      })
      if (items.length > 0) return groupExtracted(items, input.hostName)
    } catch (e) {
      console.error("Transcript-based extraction failed, falling back to Fathom items:", e)
    }
  }

  // Fallback: lean on Fathom's pre-extracted action_items + email matching.
  // Same shape as the v1 logic so we never lose tasks when the transcript
  // path is unavailable.
  const items = (input.fathomItems ?? []).filter(
    (a) => typeof a?.description === "string" && a.description.trim().length > 0,
  )
  if (items.length === 0) return empty

  const groups: RoleGroups = { host: [], cm: [], setter: [], client: [] }
  for (const item of items) {
    const email = item.assignee?.email?.toLowerCase() ?? null
    const isTeam = !!email && input.usersByFathomEmail.has(email)
    const ci: CategorizedItem = {
      description: item.description.trim(),
      completed: !!item.completed,
      context: null,
      assigneeName: item.assignee?.name ?? null,
    }
    if (isTeam) groups.host.push(ci)
    else groups.client.push(ci)
  }
  return groups
}

async function extractFromTranscript(input: {
  transcript: string
  meetingTypeLabel: string
  clientName: string | null
  hostName: string | null
  cmName: string | null
  setterName: string | null
}): Promise<ExtractedItem[]> {
  // Truncate aggressively — full transcripts of 60-min meetings can blow past
  // 30k tokens. 18k chars (~6k tokens) is more than enough for the model to
  // catch every concrete commitment without ballooning cost. Take both ends
  // of the meeting (action items concentrate in the closing minutes).
  const transcript =
    input.transcript.length > 18000
      ? input.transcript.slice(0, 9000) +
        "\n\n[…transcript truncated…]\n\n" +
        input.transcript.slice(-9000)
      : input.transcript

  const teamRoster = [
    input.hostName ? `host (account manager) — ${input.hostName}` : null,
    input.cmName ? `cm (campagnemanager) — ${input.cmName}` : null,
    input.setterName ? `setter (appointment setter) — ${input.setterName}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const systemPrompt = `Je bent een Nederlandstalige assistent die taakextractie doet voor Rocket Leads, een marketing agency. Je krijgt het transcript van een meeting met een klant en je extraheert daaruit ALLE concrete taken/acties die uit de meeting zijn gekomen.

JOUW TAAK:
Lees het transcript zorgvuldig. Voor elke concrete actie die expliciet is toegezegd, classificeer de assignee:

- "host" — de account manager die de meeting heeft gedaan, wanneer hij/zij zegt zelf iets te gaan doen ("ik regel dat", "ik check het even", "ik kom er morgen op terug")
- "cm" — wanneer de host zegt dat de campagnemanager iets gaat doen ("ik vraag Mike om dit te updaten"), of als de CM zelf iets toezegt
- "setter" — vergelijkbaar voor de appointment setter
- "client" — wanneer de klant iets toezegt aan te leveren of te doen ("Luc gaat de logo's sturen", "ik upload de video's nog deze week")

REGELS:
- ALLEEN concrete acties met een duidelijke "wie doet wat". Geen vaag bedoelde uitspraken zoals "we kijken er even naar".
- Geen acties die al gedaan zijn ten tijde van de meeting.
- Schrijf elke taak als een korte, duidelijke imperatief in het Nederlands ("Logo aanleveren in vector formaat", "Pixel installeren op landingspagina", "Mike vragen om creatives te updaten met nieuwe hook").
- Voeg context toe waar het anders niet duidelijk is welke campagne / onderdeel het over gaat.
- Als de host iets aan een teamlid delegeert, classificeer als dat teamlid (cm/setter) — NIET als host.
- Als je TWIJFELT over wie verantwoordelijk is, neem "host" (de AM kan altijd doorzetten).
- Schrijf geen taken die zijn afgelopen tijdens de meeting zelf.

OUTPUT: Pure JSON, geen prose, geen markdown. Format:
{"items":[{"description":"…","assignee_role":"host|cm|setter|client","context":"≤60 chars uit transcript"}]}

Lege array als er geen concrete acties zijn: {"items":[]}`

  const userContent = `MEETINGCONTEXT:
- Type: ${input.meetingTypeLabel}
- Klant: ${input.clientName ?? "(onbekend)"}

TEAM ROSTER (gebruik deze namen om assignee te bepalen):
${teamRoster || "(host onbekend)"}

TRANSCRIPT:
${transcript}

Geef nu de actielijst als JSON.`

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  })

  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim()

  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end === -1) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const raw = (parsed as { items?: unknown }).items
  if (!Array.isArray(raw)) return []

  const valid: ExtractedItem[] = []
  for (const r of raw) {
    if (typeof r !== "object" || !r) continue
    const x = r as Record<string, unknown>
    const description = typeof x.description === "string" ? x.description.trim() : ""
    const role = x.assignee_role as AssigneeRole
    const context = typeof x.context === "string" ? x.context.trim() : undefined
    if (!description) continue
    if (!["host", "cm", "setter", "client"].includes(role)) continue
    valid.push({ description, assignee_role: role, context })
  }
  return valid
}

function groupExtracted(items: ExtractedItem[], hostName: string | null): RoleGroups {
  const groups: RoleGroups = { host: [], cm: [], setter: [], client: [] }
  for (const it of items) {
    const ci: CategorizedItem = {
      description: it.description,
      completed: false,
      context: it.context ?? null,
      assigneeName: it.assignee_role === "host" ? hostName : null,
    }
    groups[it.assignee_role].push(ci)
  }
  return groups
}

// --- Persistence helpers -----------------------------------------------

async function upsertMeetingTask(
  supabase: SupabaseClient,
  input: {
    meeting: {
      id: string
      fathom_recording_id: string
      client_id: string | null
      scheduled_at: string | null
    }
    rule: typeof HOST_BUNDLE_RULE | typeof CM_TASK_RULE | typeof SETTER_TASK_RULE
    assigneeId: string
    authorId: string
    title: string
    body: string
    sourceRef: Record<string, unknown>
    allCompleted: boolean
  },
): Promise<IngestStats> {
  const empty: IngestStats = { inserted: 0, updated: 0, skipped: 0 }
  const status = input.allCompleted ? "done" : "open"
  const completedAt = input.allCompleted ? new Date().toISOString() : null

  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id, status")
    .eq("source", "meeting")
    .filter("source_ref->>fathomRecordingId", "eq", input.meeting.fathom_recording_id)
    .filter("source_ref->>rule", "eq", input.rule)
    .maybeSingle<{ id: string; status: string }>()

  if (existing) {
    if (input.allCompleted && existing.status === "open") {
      const { error } = await supabase
        .from("inbox_events")
        .update({
          status: "done",
          completed_at: new Date().toISOString(),
          source_ref: input.sourceRef,
        })
        .eq("id", existing.id)
        .eq("status", "open")
      if (!error) return { ...empty, updated: 1 }
    }
    return { ...empty, skipped: 1 }
  }

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: "task",
      client_id: input.meeting.client_id ?? "",
      author_id: input.authorId,
      assignee_id: input.assigneeId,
      title: input.title,
      body: input.body,
      status,
      priority: "normal",
      source: "meeting",
      source_ref: input.sourceRef,
      created_at_src: input.meeting.scheduled_at ?? null,
      completed_at: completedAt,
    })
    .select("id")
    .single()
  if (error) return empty
  if (inserted?.id) void sendInboxAssignmentPush(supabase, inserted.id)
  return { ...empty, inserted: 1 }
}

function mergeStats(a: IngestStats, b: IngestStats): IngestStats {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    skipped: a.skipped + b.skipped,
  }
}

// --- Body renderers ----------------------------------------------------

function renderHostBundleBody(input: {
  typeLabel: string
  clientName: string | null
  scheduledAt: string | null
  shareUrl: string | null
  hostName: string | null
  host: CategorizedItem[]
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

  if (input.host.length > 0) {
    lines.push(`Voor jou (${input.hostName ?? "AM"}):`)
    for (const item of input.host) {
      const mark = item.completed ? "[x]" : "[ ]"
      const ctx = item.context ? ` — ${item.context}` : ""
      lines.push(`• ${mark} ${item.description}${ctx}`)
    }
    lines.push("")
  }

  if (input.client.length > 0) {
    lines.push("Taken voor de klant (volg op):")
    for (const item of input.client) {
      const mark = item.completed ? "[x]" : "[ ]"
      const ctx = item.context ? ` — ${item.context}` : ""
      lines.push(`• ${mark} ${item.description}${ctx}`)
    }
    lines.push("")
  }

  if (input.shareUrl) lines.push(`Meeting: ${input.shareUrl}`)
  return lines.join("\n").trimEnd()
}

function renderDelegatedBody(input: {
  typeLabel: string
  clientName: string | null
  scheduledAt: string | null
  shareUrl: string | null
  hostName: string | null
  role: "campagnemanager" | "appointment setter"
  items: CategorizedItem[]
}): string {
  const lines: string[] = []
  const dateBit = input.scheduledAt ? formatDateNl(input.scheduledAt) : null
  const subject = input.clientName ? ` met ${input.clientName}` : ""
  const from = input.hostName ? ` door ${input.hostName}` : ""
  lines.push(
    `Tijdens de ${input.typeLabel}${subject}${dateBit ? ` (${dateBit})` : ""} is${from} aan jou (de ${input.role}) gevraagd om het volgende op te pakken:`,
  )
  lines.push("")
  for (const item of input.items) {
    const mark = item.completed ? "[x]" : "[ ]"
    const ctx = item.context ? ` — ${item.context}` : ""
    lines.push(`• ${mark} ${item.description}${ctx}`)
  }
  if (input.shareUrl) {
    lines.push("")
    lines.push(`Meeting: ${input.shareUrl}`)
  }
  return lines.join("\n").trimEnd()
}

// --- Lookups -----------------------------------------------------------

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

/**
 * Pull the campaign manager + appointment setter Monday display names for a
 * client. We fetch from the cached Monday boards rather than Supabase because
 * the AM/CM/Setter columns aren't mirrored into our `clients` table — they
 * only live on Monday.
 */
async function getClientPeople(
  supabase: SupabaseClient,
  mondayItemId: string,
): Promise<{ campaignManager: string | null; appointmentSetter: string | null }> {
  // Read from the Monday cache via the monday integration's helper. Since
  // this module already imports supabase + we have a recent boards cache,
  // pull from that cache directly to avoid coupling on the bigger
  // fetchBothBoards path.
  const { readCache } = await import("@/lib/cache")
  type CachedClient = {
    mondayItemId: string
    campaignManager: string
    appointmentSetter: string
  }
  const cached = await readCache<{ onboarding: CachedClient[]; current: CachedClient[] }>(
    "monday_boards",
  )
  if (!cached) {
    void supabase // keep the param shape stable for future signature
    return { campaignManager: null, appointmentSetter: null }
  }
  const all = [...cached.onboarding, ...cached.current]
  const found = all.find((c) => c.mondayItemId === mondayItemId)
  if (!found) return { campaignManager: null, appointmentSetter: null }
  return {
    campaignManager: found.campaignManager?.trim() || null,
    appointmentSetter: found.appointmentSetter?.split(",")[0]?.trim() || null,
  }
}

async function resolveByMondayName(
  supabase: SupabaseClient,
  role: "campaign_manager" | "appointment_setter",
  personName: string,
): Promise<string | null> {
  if (!personName) return null
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", role)
    .eq("monday_person_name", personName)
    .maybeSingle<{ user_id: string }>()
  return data?.user_id ?? null
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

async function loadFathomEmailMap(supabase: SupabaseClient): Promise<Map<string, string>> {
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
