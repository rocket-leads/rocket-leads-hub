import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { classifyInboxMessage } from "@/lib/inbox/classify"

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
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payload: TrengoWebhookPayload
  try {
    payload = (await req.json()) as TrengoWebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const eventType = payload.event_type ?? payload.type ?? ""
  if (eventType !== "ticket.message.created") {
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
    .select("id, monday_item_id")
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

  const { error } = await supabase.from("inbox_events").insert({
    kind: classification.kind,
    // client_id is `text NOT NULL` — for unlinked Trengo contacts we use empty
    // string. The chat substrate keys off `thread_key` and `client_id` filtering
    // simply skips empty-string rows. A future migration may relax this NOT NULL.
    client_id: clientRow?.monday_item_id ?? "",
    author_id: hq.id,
    assignee_id: hq.id,
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
