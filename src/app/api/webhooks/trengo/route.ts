import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache, writeCache } from "@/lib/cache"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { draftTrengoReply } from "@/lib/inbox/reply-drafter"
import { resolveClientAssignee } from "@/lib/inbox/assignee"
import { sendInboxAssignmentPush } from "@/lib/notifications/inbox-trigger"
import {
  getTrengoMentionContext,
  rewriteMentionHandles,
  resolveMentionedHubIds,
} from "@/lib/inbox/trengo-mentions"
import { getTrengoChannelLookup } from "@/lib/inbox/fetchers"
import { upsertTrengoContacts } from "@/lib/inbox/trengo-contacts"

export const maxDuration = 60

/**
 * Trengo webhook receiver - POST endpoint that ingests new ticket messages
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
  /** Only present in the JSON shape - null on form payloads. */
  channelType: string | null
  authorKind: "rl_team" | "client"
  authorName: string
  authorExternal: string
  createdAtSrc: string
  attachments: Array<{ name?: string; url?: string }> | null
  /** Email envelope data, present only when Trengo's payload included a
   *  `message.email_message` block (i.e. the message arrived through an
   *  email channel). Used to populate inbox_events.email_subject /
   *  email_from / body_html so the Hub can tag the thread as email even
   *  when the channel lookup classifies the Trengo channel as something
   *  else. */
  emailSubject: string | null
  emailFrom: string | null
  bodyHtml: string | null
  /** Original parsed payload - stored on the row's `raw` field for debugging. */
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

  // Form payload has no created_at - use server time as a best effort.
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
    // For INBOUND the author IS the contact. For OUTBOUND/NOTE the form payload
    // DOES carry the sending agent in `user_name` (Roy 2026-07-15: it was
    // wrongly assumed absent, so every outbound message showed as "Team" / the
    // system account instead of the real teammate). Use it; fall back to "Team".
    authorName:
      authorKind === "client"
        ? (contactName ?? "Unknown")
        : (get("user_name").replace(/\+/g, " ") || "Team"),
    authorExternal: authorKind === "client" ? get("contact_id") : "",
    createdAtSrc,
    attachments: null,
    // Form payloads don't carry email envelope fields - those only appear
    // in JSON payloads via `message.email_message`. Stays null here.
    emailSubject: null,
    emailFrom: null,
    bodyHtml: null,
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
    /** Trengo's email-specific envelope. Present only on messages that
     *  arrived through an email channel; absent / null for WhatsApp. */
    email_message?: {
      subject?: string | null
      from?: string | null
      html?: string | null
    } | null
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

  // Pull the email envelope when Trengo's payload carried one. Mirrors
  // the polling cron's extraction so webhook-ingested email rows land
  // with the same email_subject/email_from/body_html fields the fetcher
  // uses to override a drift-prone channel classification.
  const em = message.email_message
  const emailSubject =
    em && typeof em.subject === "string" && em.subject.trim().length > 0
      ? em.subject
      : null
  const emailFrom =
    em && typeof em.from === "string" && em.from.trim().length > 0 ? em.from : null
  const bodyHtml =
    em && typeof em.html === "string" && em.html.trim().length > 0 ? em.html : null

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
    emailSubject,
    emailFrom,
    bodyHtml,
    raw: p as unknown as Record<string, unknown>,
  }
}

function parseTrengoPayload(rawBody: string, contentType: string): NormalizedPayload | null {
  // Auto-detect: a leading `{` means JSON; everything else is form-urlencoded
  // (Trengo's default). Content-type is consulted as a hint but we don't
  // trust it blindly - some Trengo plans send a generic content-type while
  // the body is still form-encoded.
  const trimmed = rawBody.trimStart()
  if (trimmed.startsWith("{") || contentType.includes("application/json")) {
    return parseJsonPayload(rawBody)
  }
  return parseFormPayload(rawBody)
}

// --- Handler -------------------------------------------------------------

/** Event types we treat as "a message arrived" - drives whether we ingest
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

  // Register the contact so its threads (including outbound-only ones) resolve
  // a real name from the registry rather than falling back to "Unknown".
  await upsertTrengoContacts(supabase, [
    { id: Number(payload.contactId), name: payload.contactName },
  ])

  // Look up the linked client via the Trengo contact id.
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, monday_item_id, name")
    .contains("trengo_contact_ids", [payload.contactId])
    .maybeSingle()

  // System author for the FK - webhook ingest doesn't have a session-bound
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

  // Roy 2026-06-09 - @-mention fan-out (Updates tab, not a dedicated tab).
  //
  // Trengo internal notes (NOTE events) are how the team @-mentions a
  // teammate. We resolve mentions AFTER inserting the chat row below and
  // emit one `kind: "update"` inbox_event per mentioned Hub user so the
  // mention lands in their Updates tab. The chat row itself stays
  // assigned to the client AM - no reassignment, no separate "Mentions"
  // tab. Roy: "doe maar gewoon bij de updates, want de meeste mentions
  // zijn updates."
  // Trengo user directory (only needed for notes) → resolves both name-based
  // (`@Roy`) and handle-based (`@roy430594`) mentions, and rewrites the stored
  // body's handles to `@Full Name` so it reads naturally. Roy 2026-07-16.
  const mentionCtx =
    payload.eventType === "NOTE" ? await getTrengoMentionContext(supabase) : null
  const channelLookup =
    payload.eventType === "NOTE" ? await getTrengoChannelLookup() : null
  const mentionChan =
    payload.channelId != null ? channelLookup?.get(payload.channelId) : undefined
  const mentionedUserIds =
    payload.eventType === "NOTE" && mentionCtx
      ? Array.from(
          new Set([
            ...(await resolveMentionedHubUserIds(
              supabase,
              payload.messageBody,
              payload.authorName,
            )),
            ...resolveMentionedHubIds(mentionCtx, { body: payload.messageBody }),
          ]),
        )
      : []
  const displayBody = mentionCtx
    ? rewriteMentionHandles(messageBody, mentionCtx.trengoById)
    : messageBody

  // Classify with AI. Defaults to chat on uncertainty.
  const classification = await classifyInboxMessage({
    source: "trengo",
    authorKind: payload.authorKind,
    content: messageBody,
  })

  // Trengo messages always live in the chat substrate - the row's `kind`
  // is locked to "chat" so the dual-inbox dedup keeps them out of Tasks
  // and Updates (those tabs are reserved for discrete @mention / Fathom /
  // automation / manual rows). The classifier output is still computed
  // because it drives the auto-draft trigger below, but it no longer
  // determines where the row appears.
  //
  // Roy 2026-06-09: only INBOUND messages from the contact count as
  // "unread". OUTBOUND (we replied) and NOTE (internal note) land as
  // "read" - they're our own writes, nothing the AM needs to action.
  // The "Nieuwe inbox" / Now feed pulls unread chats, so without this
  // every outbound reply ghosted in as a fresh inbox item. @-mentions
  // in internal notes still notify mentioned users via the fan-out below
  // (separate kind=update rows, independent of this status).
  const status = payload.authorKind === "client" ? "unread" : "read"
  const priority = null
  // Trengo internal notes (NOTE / INTERNAL_* events) - @mentions to teammates
  // and externally-posted [AI Summary] blocks. Flagged so the chat pane renders
  // them as internal notes (yellow) and the thread rollup excludes them from
  // the client-facing preview / title / pending metrics.
  const isInternalNote =
    payload.eventType === "NOTE" || payload.eventType.includes("INTERNAL")

  const titlePreview =
    displayBody.length > 100 ? displayBody.slice(0, 100) + "…" : displayBody
  const bodyFull = displayBody.length > 100 ? displayBody : null

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
    // WhatsApp - that's the dominant case for tasks.
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
      kind: "chat",
      client_id: clientRow?.monday_item_id ?? "",
      author_id: hq.id,
      assignee_id: assigneeId,
      title: titlePreview || `Message from ${payload.authorName}`,
      body: bodyFull,
      body_html: payload.bodyHtml,
      email_subject: payload.emailSubject,
      email_from: payload.emailFrom,
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
      is_internal: isInternalNote,
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

  // Fan out @-mentions in internal notes to the mentioned users' Updates
  // tab. One `kind: "update"` row per mentioned Hub user with a body
  // preview of the note + a source_ref pointing back to the chat row, so
  // the mention is visible even for users (like CMs) who don't see the
  // Client Inbox at all. Best-effort - a failed update insert mustn't
  // tank the webhook response.
  if (mentionedUserIds.length > 0 && inserted?.id) {
    const titlePrefix = `${payload.authorName} mentioned you`
    const noteTextPlain = displayBody
      .replace(/<\/?[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
    const bodyPreview =
      noteTextPlain.length > 240 ? noteTextPlain.slice(0, 237) + "…" : noteTextPlain
    const conversationLabel = clientRow?.name ?? payload.contactName ?? "conversation"
    for (const mentionedId of mentionedUserIds) {
      const { error: mentionErr } = await supabase
        .from("inbox_events")
        .insert({
          kind: "update",
          client_id: clientRow?.monday_item_id ?? "",
          author_id: hq.id,
          assignee_id: mentionedId,
          title: `${titlePrefix} in ${conversationLabel}`,
          body: bodyPreview,
          status: "unread",
          source: "trengo",
          source_ref: {
            trengo_mention_in_chat_event_id: inserted.id,
            trengo_mention_in_thread_key: `trengo:contact:${payload.contactId}|ch:${payload.channelId}`,
            trengo_mention_contact_name: conversationLabel,
            trengo_mention_channel_name: mentionChan?.name ?? null,
            trengo_mention_channel_kind: mentionChan?.kind ?? null,
          },
          author_kind: "rl_team",
          author_name_cached: payload.authorName,
          classify_method: "manual",
          created_at_src: payload.createdAtSrc,
        })
      if (mentionErr) {
        console.error("Trengo mention update insert failed:", mentionErr.message)
      }
    }
  }

  return NextResponse.json({
    ok: true,
    classified: classification.kind,
    confidence: classification.confidence,
    reason: classification.reason,
    clientLinked: !!clientRow,
    mentionFanout: mentionedUserIds.length,
  })
}

// --- Mention resolver ----------------------------------------------------

/**
 * Resolve every Hub user @-mentioned in a Trengo internal note. We fan
 * out one `kind: "update"` row per mentioned user so the mention surfaces
 * in their Updates tab (Roy 2026-06-09 - no dedicated Mentions tab).
 *
 * Best-effort parsing - Trengo notes can be HTML-rich, so we strip tags
 * first, then run the same `@FirstName` regex the comments path uses.
 * Lookup matches case-insensitively against `users.name` on first-name
 * OR full-name. Self-mentions are skipped by matching the captured
 * mention against the note's own `authorName` (the Trengo poster).
 * Duplicates are deduped (`@Roy ... @Roy` → one id).
 */
async function resolveMentionedHubUserIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  body: string,
  authorName: string | null,
): Promise<string[]> {
  // Strip HTML - Trengo notes can be rich text. Removing tags leaves the
  // visible @-mention text intact (mentions render as `<span>@Roy</span>`
  // or similar; the inner text survives).
  const text = body
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
  const matches = Array.from(
    text.matchAll(/@([A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+)?)/g),
  )
  if (matches.length === 0) return []

  // Dedupe by lowercase to avoid pinging the same person twice on
  // `@Roy ... @Roy`. Preserve regex order so the first mention is
  // processed first (rarely matters since we return a set anyway).
  const seen = new Set<string>()
  const names: string[] = []
  for (const m of matches) {
    const n = m[1].trim()
    const key = n.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(n)
  }
  if (names.length === 0) return []

  const { data: rows } = await supabase
    .from("users")
    .select("id, name")
    .not("name", "is", null)
  if (!rows || rows.length === 0) return []

  // Self-mention filter - match against the note's poster name. We compare
  // first names because Trengo's author_name is usually a full name and the
  // @-mention is typically the first name. Lower-cased on both sides.
  const authorFirstNameLower = (authorName ?? "").trim().toLowerCase().split(/\s+/)[0] ?? ""

  const ids = new Set<string>()
  for (const name of names) {
    const needle = name.toLowerCase()
    if (needle && needle === authorFirstNameLower) continue
    for (const row of rows) {
      const userName = (row.name as string | null)?.toLowerCase() ?? ""
      if (!userName) continue
      const firstName = userName.split(/\s+/)[0]
      if (firstName === needle || userName === needle) {
        ids.add(row.id as string)
      }
    }
  }
  return Array.from(ids)
}
