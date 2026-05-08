import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache, writeCache } from "@/lib/cache"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { draftTrengoReply } from "@/lib/inbox/reply-drafter"
import { resolveClientAssignee } from "@/lib/inbox/assignee"
import { sendInboxAssignmentPush } from "@/lib/notifications/inbox-trigger"
import { fetchTicket } from "@/lib/integrations/trengo"
import { summarizeInboxTitle } from "@/lib/inbox/summarize"

export const maxDuration = 60

/**
 * Trengo webhook receiver — POST endpoint that ingests new ticket messages
 * into `inbox_events` and classifies them via AI as chat / task / update.
 *
 * Auth: shared secret. Roy configures `TRENGO_WEBHOOK_SECRET` as an env var,
 * then sets the webhook URL in Trengo to either include `?secret=<val>` as a
 * query param OR add `Authorization: Bearer <val>` as a custom header.
 *
 * **Two payload shapes** Trengo sends, depending on plan + webhook type:
 *
 *   1. **form-urlencoded** (the actual default for INBOUND/OUTBOUND/NOTE
 *      webhooks on the current plan). Flat keys:
 *        type=INBOUND&event_type=INBOUND&message_id=...&ticket_id=...
 *        &message=...&channel_id=...&contact_id=...&contact_name=Roy+test
 *        &contact_identifier=%2B31640693209
 *      No nested objects, no message body length, no created_at.
 *
 *   2. **JSON** (older plans, our test probes). Nested:
 *        { event_type, ticket: { id, contact, channel }, message: { id, body, … } }
 *
 * The handler normalizes both into the same shape and proceeds. Anything
 * that isn't a message event (Ticket created/closed/voice call) returns 200
 * with an `ignored` reason so Trengo doesn't retry.
 *
 * Idempotency: by `(source='trengo', source_msg_id='trengo:msg:<id>')`.
 *
 * Diagnostic ring buffer: every received POST is logged to cache_store
 * before any auth/shape checks via `recordTrengoDebug`. Inspect via
 * `/api/admin/trengo-webhook-debug`. Drop the buffer once the flow is healthy.
 */

// --- Diagnostic ring buffer ---------------------------------------------

type TrengoDebugEntry = {
  receivedAt: string
  bodyLen: number
  bodyPreview: string
  hasSecretQuery: boolean
  hasAuthHeader: boolean
  userAgent: string
}

const DEBUG_KEY = "trengo_webhook_debug"
const DEBUG_KEEP = 20

async function recordTrengoDebug(entry: TrengoDebugEntry): Promise<void> {
  const prev = (await readCache<TrengoDebugEntry[]>(DEBUG_KEY)) ?? []
  const next = [entry, ...prev].slice(0, DEBUG_KEEP)
  await writeCache(DEBUG_KEY, next)
}

// --- Auth ----------------------------------------------------------------

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.TRENGO_WEBHOOK_SECRET
  if (!expected) return false
  const queryParam = req.nextUrl.searchParams.get("secret")
  if (queryParam && queryParam === expected) return true
  const auth = req.headers.get("authorization")
  if (auth === `Bearer ${expected}`) return true
  return false
}

// --- Normalized payload --------------------------------------------------

/** Internal flat shape produced by parseTrengoPayload(). Both form and JSON
 *  inputs collapse onto this. */
type NormalizedPayload = {
  /** Uppercase canonical: INBOUND / OUTBOUND / NOTE / (legacy event-type string). */
  eventType: string
  ticketId: string
  messageId: string
  messageBody: string
  contactId: string
  contactName: string | null
  channelId: number | null
  /** Only present in the JSON shape — null on form payloads. */
  channelType: string | null
  authorKind: "rl_team" | "client"
  authorName: string
  authorExternal: string
  createdAtSrc: string
  attachments: Array<{ name?: string; url?: string }> | null
  /** Original parsed payload — stored on the row's `raw` field for debugging. */
  raw: Record<string, unknown>
}

function parseFormPayload(body: string): NormalizedPayload | null {
  const params = new URLSearchParams(body)
  const get = (k: string) => params.get(k) ?? ""
  const ticketId = get("ticket_id")
  const messageId = get("message_id")
  if (!ticketId || !messageId) return null

  // Trengo's flat events use uppercase verbs (INBOUND / OUTBOUND / NOTE) in
  // both `type` and `event_type` fields. We canonicalize to uppercase so the
  // downstream filter doesn't have to match both casings.
  const eventTypeRaw = (get("event_type") || get("type") || "").toString()
  const eventType = eventTypeRaw.toUpperCase()

  // Author kind from event direction. INBOUND = the contact wrote it;
  // OUTBOUND = a team member wrote it; NOTE = team internal note.
  const authorKind: "rl_team" | "client" =
    eventType === "INBOUND" ? "client" : "rl_team"

  // contact_name is URL-decoded by URLSearchParams; restore '+' as space
  // since Trengo sends `Roy+test` (form-encoding for "Roy test").
  const contactName = get("contact_name").replace(/\+/g, " ") || null

  // Form payload has no created_at — use server time as a best effort.
  const createdAtSrc = new Date().toISOString()

  const channelIdRaw = get("channel_id")
  const channelId = channelIdRaw && Number.isFinite(Number(channelIdRaw))
    ? Number(channelIdRaw)
    : null

  return {
    eventType,
    ticketId,
    messageId,
    messageBody: get("message"),
    contactId: get("contact_id"),
    contactName,
    channelId,
    channelType: null,
    authorKind,
    // For INBOUND we know the author IS the contact; for OUTBOUND/NOTE the
    // form payload doesn't include the user's name, so fall back to "Team".
    authorName:
      authorKind === "client" ? (contactName ?? "Unknown") : "Team",
    authorExternal: authorKind === "client" ? get("contact_id") : "",
    createdAtSrc,
    attachments: null,
    raw: Object.fromEntries(params.entries()),
  }
}

type LegacyJsonPayload = {
  event_type?: string
  type?: string
  ticket?: {
    id?: number | string
    contact?: { id?: number | string; name?: string }
    channel?: { id?: number | string; name?: string; type?: string }
    channel_id?: number | string
  }
  message?: {
    id?: number | string
    body?: string
    message?: string
    author_type?: "User" | "Contact" | string
    author?: { id?: number | string; name?: string }
    created_at?: string
    attachments?: Array<{ name?: string; url?: string }>
  }
  data?: {
    ticket?: LegacyJsonPayload["ticket"]
    message?: LegacyJsonPayload["message"]
  }
}

function parseJsonPayload(body: string): NormalizedPayload | null {
  let p: LegacyJsonPayload
  try {
    p = JSON.parse(body) as LegacyJsonPayload
  } catch {
    return null
  }

  const ticket = p.ticket ?? p.data?.ticket
  const message = p.message ?? p.data?.message
  if (!ticket || !message) return null

  const ticketId = String(ticket.id ?? "")
  const messageId = String(message.id ?? "")
  if (!ticketId || !messageId) return null

  const authorType = message.author_type === "User" ? "User" : "Contact"
  const authorKind: "rl_team" | "client" =
    authorType === "User" ? "rl_team" : "client"

  const channelIdRaw = ticket.channel?.id ?? ticket.channel_id
  const channelId =
    channelIdRaw != null && Number.isFinite(Number(channelIdRaw))
      ? Number(channelIdRaw)
      : null

  const contactId = String(ticket.contact?.id ?? "")
  const contactName = ticket.contact?.name ?? null

  return {
    eventType: (p.event_type ?? p.type ?? "").toString().toUpperCase(),
    ticketId,
    messageId,
    messageBody: (message.body ?? message.message ?? "").trim(),
    contactId,
    contactName,
    channelId,
    channelType: ticket.channel?.type ?? null,
    authorKind,
    authorName: message.author?.name ?? contactName ?? "Unknown",
    authorExternal: String(message.author?.id ?? contactId ?? ""),
    createdAtSrc: message.created_at ?? new Date().toISOString(),
    attachments:
      message.attachments && message.attachments.length > 0 ? message.attachments : null,
    raw: p as unknown as Record<string, unknown>,
  }
}

function parseTrengoPayload(rawBody: string, contentType: string): NormalizedPayload | null {
  // Auto-detect: a leading `{` means JSON; everything else is form-urlencoded
  // (Trengo's default). Content-type is consulted as a hint but we don't
  // trust it blindly — some Trengo plans send a generic content-type while
  // the body is still form-encoded.
  const trimmed = rawBody.trimStart()
  if (trimmed.startsWith("{") || contentType.includes("application/json")) {
    return parseJsonPayload(rawBody)
  }
  return parseFormPayload(rawBody)
}

// --- Handler -------------------------------------------------------------

/** Event types we treat as "a message arrived" — drives whether we ingest
 *  a row. Both the modern uppercase flat verbs and the legacy lowercase JSON
 *  strings are accepted. Anything else is acknowledged with `ignored`. */
const MESSAGE_EVENT_TYPES = new Set<string>([
  "INBOUND",
  "OUTBOUND",
  "NOTE",
  "TICKET.MESSAGE.CREATED",
  "MESSAGE.CREATED",
  "INBOUND.MESSAGE.CREATED",
  "OUTBOUND.MESSAGE.CREATED",
  "INTERNAL.MESSAGE.CREATED",
  "INBOUND_MESSAGE",
  "OUTBOUND_MESSAGE",
  "INTERNAL_MESSAGE",
])

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const haveSecret = !!req.nextUrl.searchParams.get("secret")
  const haveAuthHeader = !!req.headers.get("authorization")
  const ua = req.headers.get("user-agent") ?? ""
  const contentType = req.headers.get("content-type") ?? ""

  // Persistent debug ring buffer (drop after the flow is verified healthy).
  void recordTrengoDebug({
    receivedAt: new Date().toISOString(),
    bodyLen: rawBody.length,
    bodyPreview: rawBody.slice(0, 1500),
    hasSecretQuery: haveSecret,
    hasAuthHeader: haveAuthHeader,
    userAgent: ua.slice(0, 120),
  }).catch((e) => console.error("[trengo-webhook] debug record failed", e))

  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const payload = parseTrengoPayload(rawBody, contentType)
  if (!payload) {
    console.log(
      `[trengo-webhook] payload PARSE FAILED contentType="${contentType}" preview="${rawBody.slice(0, 200)}"`,
    )
    return NextResponse.json({ ok: true, ignored: "unparseable" })
  }

  // Filter to message-bearing events. Non-message events (ticket assigned,
  // ticket created, voice call, label add) are acknowledged but not stored.
  if (!MESSAGE_EVENT_TYPES.has(payload.eventType)) {
    return NextResponse.json({ ok: true, ignored: payload.eventType })
  }

  if (!payload.contactId || !payload.messageId || !payload.ticketId) {
    return NextResponse.json(
      { ok: false, error: "Missing ticket id, message id, or contact id" },
      { status: 400 },
    )
  }

  const messageBody = payload.messageBody.trim()
  if (!messageBody) {
    return NextResponse.json({ ok: true, skipped: "empty body" })
  }

  const supabase = await createAdminClient()

  // Dedupe by Trengo message id.
  const sourceMsgId = `trengo:msg:${payload.messageId}`
  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("source", "trengo")
    .eq("source_msg_id", sourceMsgId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true })
  }

  // Look up the linked client via the Trengo contact id.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, monday_item_id, name")
    .contains("trengo_contact_ids", [payload.contactId])
    .maybeSingle()

  // System author for the FK — webhook ingest doesn't have a session-bound
  // user_id. Author attribution for chat events is via author_kind +
  // author_name_cached; the FK is just a placeholder.
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (!hq?.id) {
    return NextResponse.json(
      { ok: false, error: "No system author user found" },
      { status: 500 },
    )
  }

  // Route classified tasks/updates to the AM responsible for this client.
  // Falls back to HQ when the contact isn't linked or the AM isn't mapped.
  const assigneeId =
    (clientRow?.monday_item_id
      ? await resolveClientAssignee(clientRow.monday_item_id)
      : null) ?? hq.id

  // Pull the Trengo ticket to discover the current Trengo-side assignee.
  // We store it on the row so the Hub inbox filter can hide events that are
  // already claimed by someone in Trengo (Roy's "unassigned-only" rule).
  // Best-effort: failure here shouldn't block ingest.
  let trengoAssigneeUserId: number | null = null
  try {
    const ticket = await fetchTicket(payload.ticketId)
    trengoAssigneeUserId = ticket?.assignee?.id ?? null
  } catch (e) {
    console.warn("[trengo-webhook] fetchTicket failed; treating as unassigned", e)
  }

  // Auto-clear after team reply: when an OUTBOUND lands, every other event
  // in the same Trengo contact thread is implicitly "handled" — flip them
  // to read so the AM doesn't keep seeing them in the unread list. Same
  // semantics Trengo's own UI applies. Notes (NOTE) are team chatter; they
  // shouldn't auto-clear inbound questions.
  if (payload.eventType === "OUTBOUND") {
    void supabase
      .from("inbox_events")
      .update({ status: "read" })
      .eq("thread_key", `trengo:contact:${payload.contactId}`)
      .eq("status", "unread")
      .then(({ error: clearErr }) => {
        if (clearErr) console.warn("[trengo-webhook] auto-clear failed", clearErr)
      })
  }

  // Classify with AI. Defaults to chat on uncertainty.
  const classification = await classifyInboxMessage({
    source: "trengo",
    authorKind: payload.authorKind,
    content: messageBody,
  })

  // Collapse rule: at most one open/in-progress task per (client, source).
  // If the classifier wants to create a task but there's already a live
  // Trengo task on this client, downgrade the new event to "chat" — it
  // still lands in the Client Inbox thread, but we don't double-up the
  // Tasks tab. We attach a comment to the existing task afterwards so the
  // AM still sees the new commitment as a thread of activity on the task.
  let effectiveKind = classification.kind
  let collapseToTaskId: string | null = null
  if (classification.kind === "task" && clientRow?.monday_item_id) {
    const { data: existingTask } = await supabase
      .from("inbox_events")
      .select("id")
      .eq("source", "trengo")
      .eq("kind", "task")
      .eq("client_id", clientRow.monday_item_id)
      .in("status", ["open", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existingTask?.id) {
      effectiveKind = "chat"
      collapseToTaskId = existingTask.id
    }
  }

  // Status: tasks always start "open" (someone needs to act, even on team
  // replies that turn out to be commitments). Chat/update from a CLIENT
  // starts "unread". Chat/update from RL_TEAM (OUTBOUND/NOTE) starts "read"
  // — the team member just sent it, there's no "unread" state for your own
  // outbound — pairs with the auto-clear-on-reply logic above.
  const status =
    effectiveKind === "task"
      ? "open"
      : payload.authorKind === "rl_team"
        ? "read"
        : "unread"

  const priority = effectiveKind === "task" ? "normal" : null

  // Title: AI-generated one-liner so the inbox row shows a human summary
  // instead of the raw message blob. Body keeps the full message so the
  // detail view + chat thread still have the original text. Cached per
  // content-hash so identical inbound messages don't hit Haiku twice.
  const titleSummary = await summarizeInboxTitle(messageBody, "trengo")
  const bodyFull = messageBody

  // Smart-inbox: pre-draft a Dutch reply on classified tasks so the AM can
  // review-and-send straight from the detail dialog. Skipped on short tasks
  // (under 10 chars) and on team-authored events. Failure is non-fatal.
  let draftMessage: string | null = null
  let draftChannel: "trengo_email" | "trengo_whatsapp" | null = null
  if (
    classification.kind === "task" &&
    messageBody.length >= 10 &&
    payload.authorKind === "client"
  ) {
    // Channel type isn't always present (form payload omits it), so we look
    // up the channel id against subscribed-channel metadata when needed.
    // For now we treat anything that isn't explicitly an email channel as
    // WhatsApp — that's the dominant case for tasks.
    const channelType = (payload.channelType ?? "").toLowerCase()
    const isWhatsapp =
      channelType.includes("whats") ||
      channelType.includes("wa_") ||
      // Heuristic for form payloads with no channel type: contact_identifier
      // looks like a phone number → WhatsApp.
      (channelType === "" && /^\+?\d/.test(payload.contactId))
    draftChannel = isWhatsapp ? "trengo_whatsapp" : "trengo_email"
    try {
      draftMessage = await draftTrengoReply({
        clientName: clientRow?.name ?? null,
        firstName: payload.authorName.split(" ")[0] ?? null,
        inboundMessage: messageBody,
        channel: isWhatsapp ? "whatsapp" : "email",
      })
    } catch (e) {
      console.error("Reply drafter failed:", e)
    }
  }

  const sourceRef = draftMessage
    ? { draft_message: draftMessage, draft_channel: draftChannel }
    : null

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: effectiveKind,
      client_id: clientRow?.monday_item_id ?? "",
      author_id: hq.id,
      assignee_id: assigneeId,
      title: titleSummary || `Bericht van ${payload.authorName}`,
      body: bodyFull,
      status,
      priority,
      source: "trengo",
      source_thread: `trengo:ticket:${payload.ticketId}`,
      source_msg_id: sourceMsgId,
      thread_key: `trengo:contact:${payload.contactId}`,
      scope: "external",
      author_kind: payload.authorKind,
      author_external: payload.authorExternal,
      author_name_cached: payload.authorName,
      classify_conf: classification.confidence,
      classify_method: "ai",
      created_at_src: payload.createdAtSrc,
      trengo_channel_id: payload.channelId,
      trengo_assignee_user_id: trengoAssigneeUserId,
      // Trengo fires `event_type=NOTE` for team-only annotations — mirror
      // those in as `is_internal=true` so the chat UI renders them as a
      // yellow bubble instead of a regular outbound message. Hub-originated
      // notes already carry the flag via the reply mirror; this catches
      // notes posted directly from the Trengo UI by other team members.
      is_internal: payload.eventType === "NOTE",
      source_ref: sourceRef,
      raw: payload.raw,
      attachments: payload.attachments,
    })
    .select("id")
    .single()

  if (error) {
    console.error("Trengo webhook insert failed:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (inserted?.id) void sendInboxAssignmentPush(supabase, inserted.id)

  // If this event collapsed into an existing open task, attach the message
  // body as a comment so the task carries a running log of subsequent
  // activity from the same client. Best-effort — the chat row already
  // captured the message, so a failed comment isn't fatal.
  if (collapseToTaskId) {
    const { error: commentErr } = await supabase.from("inbox_comments").insert({
      item_id: collapseToTaskId,
      author_id: hq.id,
      body: messageBody,
    })
    if (commentErr) {
      console.warn("[trengo-webhook] collapse-comment insert failed", commentErr)
    }
  }

  return NextResponse.json({
    ok: true,
    classified: classification.kind,
    effectiveKind,
    collapsed: !!collapseToTaskId,
    confidence: classification.confidence,
    reason: classification.reason,
    clientLinked: !!clientRow,
  })
}
