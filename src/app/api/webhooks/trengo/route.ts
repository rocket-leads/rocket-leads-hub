import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { draftTrengoReply } from "@/lib/inbox/reply-drafter"
import { resolveClientAssignee } from "@/lib/inbox/assignee"

export const maxDuration = 60

/**
 * Trengo webhook receiver — POST endpoint that ingests new ticket messages
 * into `inbox_events` and classifies them via AI as chat / task / update.
 *
 * Auth: shared secret. Roy configures `TRENGO_WEBHOOK_SECRET` as an env var,
 * then sets the webhook URL in Trengo to either include `?secret=<val>` as a
 * query param OR add `Authorization: Bearer <val>` as a custom header. Either
 * works — Trengo's webhook UI varies by plan.
 *
 * Event scope: only `ticket.message.created` is processed for now. Other
 * event types (ticket.assigned, ticket.closed, etc.) are accepted with a
 * 200 OK so Trengo doesn't retry but stored as no-ops.
 *
 * Idempotency: by `(source='trengo', source_msg_id='trengo:msg:<id>')`. Trengo
 * occasionally retries delivery; we never double-store the same message.
 */

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.TRENGO_WEBHOOK_SECRET
  if (!expected) return false
  const queryParam = req.nextUrl.searchParams.get("secret")
  if (queryParam && queryParam === expected) return true
  const auth = req.headers.get("authorization")
  if (auth === `Bearer ${expected}`) return true
  return false
}

type TrengoWebhookPayload = {
  event_type?: string
  type?: string
  ticket?: {
    id: number | string
    contact?: { id: number | string; name?: string }
    channel?: { id: number | string; name?: string; type?: string }
    channel_id?: number | string
  }
  message?: {
    id: number | string
    body?: string
    message?: string
    author_type?: "User" | "Contact" | string
    author?: { id: number | string; name?: string }
    created_at?: string
    type?: string
    attachments?: Array<{ name?: string; url?: string }>
  }
  data?: {
    ticket?: TrengoWebhookPayload["ticket"]
    message?: TrengoWebhookPayload["message"]
  }
}

export async function POST(req: NextRequest) {
  // Diagnostic logging — temporary while Roy verifies that Trengo is actually
  // delivering webhooks. We log BEFORE the auth check so a 401 on a Trengo
  // POST is still visible in Vercel logs (it would otherwise look identical
  // to "no webhook received at all"). Body is read once as text and re-parsed
  // below so we keep working with the same payload.
  const rawBody = await req.text()
  const haveSecret = !!req.nextUrl.searchParams.get("secret")
  const haveAuthHeader = !!req.headers.get("authorization")
  const ua = req.headers.get("user-agent") ?? ""
  console.log(
    `[trengo-webhook] POST received bodyLen=${rawBody.length} ` +
      `hasSecretQuery=${haveSecret} hasAuthHeader=${haveAuthHeader} ` +
      `ua=${ua.slice(0, 80)}`,
  )

  if (!verifyAuth(req)) {
    console.log("[trengo-webhook] auth FAILED — rejecting with 401")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payload: TrengoWebhookPayload
  try {
    payload = JSON.parse(rawBody) as TrengoWebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  console.log(
    `[trengo-webhook] auth OK event_type=${payload.event_type ?? payload.type ?? "(none)"} ` +
      `hasTicket=${!!(payload.ticket ?? payload.data?.ticket)} ` +
      `hasMessage=${!!(payload.message ?? payload.data?.message)}`,
  )

  // Trengo's webhook UI splits messages into separate event types per direction
  // (Inbound message / Outbound message / Internal message), each with its own
  // string. We accept all message-bearing events and let downstream code use
  // `author_type` to differentiate inbound vs outbound. Anything that doesn't
  // carry a message body (Ticket created/closed/assigned, Voice call, …) falls
  // through to the missing-body branch below and is acked without being stored.
  const eventType = payload.event_type ?? payload.type ?? ""
  const MESSAGE_EVENT_TYPES = new Set([
    "ticket.message.created", // legacy/older Trengo plans
    "message.created",
    "inbound.message.created",
    "outbound.message.created",
    "internal.message.created",
    "inbound_message",
    "outbound_message",
    "internal_message",
  ])
  const isLegacyMessageEvent = MESSAGE_EVENT_TYPES.has(eventType)
  // Permissive fallback: if Trengo's event_type string doesn't match a known
  // alias but the payload carries a ticket + message, treat it as a message
  // event. Better to ingest one extra row than to drop real messages because
  // Trengo renamed an event.
  const looksLikeMessageEvent =
    !!(payload.message ?? payload.data?.message) &&
    !!(payload.ticket ?? payload.data?.ticket)
  if (!isLegacyMessageEvent && !looksLikeMessageEvent) {
    return NextResponse.json({ ok: true, ignored: eventType })
  }

  const ticket = payload.ticket ?? payload.data?.ticket
  const message = payload.message ?? payload.data?.message
  if (!ticket || !message) {
    return NextResponse.json(
      { ok: false, error: "Missing ticket or message in payload" },
      { status: 400 },
    )
  }

  const ticketId = String(ticket.id ?? "")
  const messageId = String(message.id ?? "")
  const contactId = String(ticket.contact?.id ?? "")
  // Channel id is what powers per-user channel subscriptions. Trengo varies the
  // payload shape across plans/event types — try the nested object first, then
  // the flat fallback. Stored as integer; null if Trengo didn't send one.
  const rawChannelId = ticket.channel?.id ?? ticket.channel_id ?? null
  const trengoChannelId =
    rawChannelId != null && Number.isFinite(Number(rawChannelId))
      ? Number(rawChannelId)
      : null
  if (!ticketId || !messageId || !contactId) {
    return NextResponse.json(
      { ok: false, error: "Missing ticket id, message id, or contact id" },
      { status: 400 },
    )
  }

  const messageBody = (message.body ?? message.message ?? "").trim()
  if (!messageBody) {
    return NextResponse.json({ ok: true, skipped: "empty body" })
  }

  const authorType = message.author_type === "User" ? "User" : "Contact"
  const authorKind: "rl_team" | "client" = authorType === "User" ? "rl_team" : "client"
  const authorName = message.author?.name ?? ticket.contact?.name ?? "Unknown"
  const authorExternal = String(message.author?.id ?? ticket.contact?.id ?? "")
  const createdAtSrc = message.created_at ?? new Date().toISOString()

  const supabase = await createAdminClient()

  // Dedupe: skip if we've already stored this Trengo message id.
  const sourceMsgId = `trengo:msg:${messageId}`
  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("source", "trengo")
    .eq("source_msg_id", sourceMsgId)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ ok: true, deduped: true })
  }

  // Look up the linked client via the Trengo contact id (clients.trengo_contact_ids[]).
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id, monday_item_id, name")
    .contains("trengo_contact_ids", [contactId])
    .maybeSingle()

  // System author — webhook ingest doesn't have a Hub user_id. Author attribution
  // for chat events comes from `author_kind` + `author_name_cached`; the FK
  // `author_id` is just a placeholder. C.6 (reply mechanism) refines this when
  // user_platform_tokens map external IDs to Hub users.
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
  // Without this, every ingested item sits on the HQ system inbox and never
  // reaches the AM's "Assigned to me" filter. Falls back to HQ when the
  // contact isn't linked to a client or the client's AM isn't mapped.
  const assigneeId =
    (clientRow?.monday_item_id
      ? await resolveClientAssignee(clientRow.monday_item_id)
      : null) ?? hq.id

  // Classify with AI. Defaults to 'chat' on any uncertainty.
  const classification = await classifyInboxMessage({
    source: "trengo",
    authorKind,
    content: messageBody,
  })

  const status =
    classification.kind === "task"
      ? "open"
      : classification.kind === "update"
        ? "unread"
        : "unread" // chat starts unread; mark-read happens when AM views the thread

  const priority = classification.kind === "task" ? "normal" : null

  const titlePreview = messageBody.length > 100 ? messageBody.slice(0, 100) + "…" : messageBody
  const bodyFull = messageBody.length > 100 ? messageBody : null

  // Smart-inbox: when the AI classifies as `task`, also pre-draft a Dutch
  // reply so the AM can review-and-send straight from the detail dialog
  // instead of starting from a blank textarea every time. Skip on tasks
  // where the body is too short to draft against meaningfully (under 10
  // chars — usually "ok", "👍", etc., where a reply isn't really needed).
  // Failure is non-fatal: the task lands without a draft.
  let draftMessage: string | null = null
  let draftChannel: "trengo_email" | "trengo_whatsapp" | null = null
  if (
    classification.kind === "task" &&
    messageBody.trim().length >= 10 &&
    authorKind === "client"
  ) {
    const channelType = (ticket.channel?.type ?? "").toLowerCase()
    const isWhatsapp = channelType.includes("whats") || channelType.includes("wa_")
    draftChannel = isWhatsapp ? "trengo_whatsapp" : "trengo_email"
    try {
      draftMessage = await draftTrengoReply({
        clientName: clientRow?.name ?? null,
        firstName: authorName.split(" ")[0] ?? null,
        inboundMessage: messageBody,
        channel: isWhatsapp ? "whatsapp" : "email",
      })
    } catch (e) {
      console.error("Reply drafter failed:", e)
    }
  }

  // Source ref persists the draft so the detail dialog renders the existing
  // reply textarea pre-filled with the AI suggestion.
  const sourceRef = draftMessage
    ? { draft_message: draftMessage, draft_channel: draftChannel }
    : null

  const { error } = await supabase.from("inbox_events").insert({
    kind: classification.kind,
    // client_id is `text NOT NULL` — for unlinked Trengo contacts we use empty
    // string. The chat substrate keys off `thread_key` and `client_id` filtering
    // simply skips empty-string rows. A future migration may relax this NOT NULL.
    client_id: clientRow?.monday_item_id ?? "",
    author_id: hq.id,
    assignee_id: assigneeId,
    title: titlePreview || `Message from ${authorName}`,
    body: bodyFull,
    status,
    priority,
    source: "trengo",
    source_thread: `trengo:ticket:${ticketId}`,
    source_msg_id: sourceMsgId,
    thread_key: `trengo:contact:${contactId}`,
    scope: "external",
    author_kind: authorKind,
    author_external: authorExternal,
    author_name_cached: authorName,
    classify_conf: classification.confidence,
    classify_method: "ai",
    created_at_src: createdAtSrc,
    trengo_channel_id: trengoChannelId,
    source_ref: sourceRef,
    raw: payload,
    attachments:
      message.attachments && message.attachments.length > 0 ? message.attachments : null,
  })

  if (error) {
    console.error("Trengo webhook insert failed:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    classified: classification.kind,
    confidence: classification.confidence,
    reason: classification.reason,
    clientLinked: !!clientRow,
  })
}
