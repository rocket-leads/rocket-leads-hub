import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { createAdminClient } from "@/lib/supabase/server"
import { sendPushToUser } from "@/lib/notifications/push"
import { updateTrengoContactName, fetchWaTemplates } from "@/lib/integrations/trengo"
import { convertMentionNamesToHandles } from "@/lib/inbox/trengo-mentions"

/**
 * Outbound reply path - sends a Hub reply back to the source platform AS the
 * logged-in Hub user, never as a generic system bot. Uses the user's stored
 * platform token from `user_platform_tokens` (set up via /account in C.3).
 *
 * If the user hasn't connected the relevant platform yet, throws a typed
 * "needs_connect" error so callers can surface "Connect your Slack first" in
 * the UI rather than a confusing API failure.
 *
 * Successful sends also write the outbound message back into inbox_events so
 * the chat thread in the Hub stays a complete history - both received and
 * sent messages live in the same table, queryable by thread_key.
 */

export class NeedsConnectError extends Error {
  platform: "slack" | "trengo" | "monday"
  constructor(platform: "slack" | "trengo" | "monday") {
    super(`User has not connected ${platform}`)
    this.name = "NeedsConnectError"
    this.platform = platform
  }
}

/**
 * Make a string valid as a WhatsApp Business HSM template parameter.
 *
 * Meta's Cloud API rejects (HTTP 422 via Trengo) any body variable that
 * contains a newline, tab, or 4+ consecutive whitespace characters. Our
 * composed Client Update body is multi-paragraph with bullet lists, so a
 * raw send always fails. We flatten paragraphs to spaces and inline bullets
 * with " • " so the message still reads as a recognisable list, then
 * collapse runs of spaces.
 *
 * Idempotent: running it twice changes nothing on the second pass. Email
 * sends do NOT need this - Trengo's email endpoint accepts the original
 * multi-line body as-is.
 */
export function sanitizeWaTemplateParam(s: string): string {
  // Coerce defensively: a caller passing `null` / `undefined` here used
  // to leak straight through `if (!s) return s`, and JSON.stringify then
  // serialised them as `null` in the params array. Meta replies with
  // "JSON schema constraint 'type' for the JSON field 'text.body' …
  // expected: 'string'", which is its 422 for "you sent me null where I
  // wanted a string". Guarantee string output at this boundary.
  const str = String(s ?? "")
  if (!str) return ""
  return str
    // Inline bullets first so "\n• Actie" survives as " • Actie" instead of
    // "  Actie" after the generic newline-strip below.
    .replace(/\n\s*[•\-*]\s+/g, " • ")
    // Any remaining newlines/tabs (paragraph breaks, carriage returns) → space.
    // Paragraphs already end in punctuation (".", ":"), so flattening reads OK.
    .replace(/[\r\n\t]+/g, " ")
    // Meta caps at 4 consecutive whitespace, but we go further: collapse any
    // double space to single for a cleaner read.
    .replace(/ {2,}/g, " ")
    .trim()
}

type InboxEventRow = {
  id: string
  source: "manual" | "automation" | "trengo" | "slack" | "monday" | "watchlist" | "meeting"
  source_thread: string | null
  source_msg_id: string | null
  thread_key: string | null
  scope: "external" | "internal" | null
  client_id: string
  /** Trengo channel id of the original event - propagated to the outbound
   *  mirror so the user's own replies pass the channel-subscription filter
   *  in listChatThreads / getChatThreadMessages (otherwise an admin who
   *  subscribed to a specific channel wouldn't see their own outbound). */
  trengo_channel_id: number | null
  raw: Record<string, unknown> | null
}

async function loadEvent(eventId: string): Promise<InboxEventRow | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("inbox_events")
    .select(
      "id, source, source_thread, source_msg_id, thread_key, scope, client_id, trengo_channel_id, raw",
    )
    .eq("id", eventId)
    .maybeSingle()
  return (data as InboxEventRow | null) ?? null
}

// --- Trengo --------------------------------------------------------------

/**
 * Send a WhatsApp Business template message via Trengo. Used when the 24h
 * conversation window is closed (Meta requires templates for any outbound
 * outside the window) AND when the AM explicitly opts in to a template
 * inside the window.
 *
 * The Trengo payload shape (`type: "TEMPLATE", template_name, language,
 * params`) is the same as the existing automation path in
 * [send-trengo-message/route.ts](../../app/api/inbox/[id]/send-trengo-message/route.ts) -
 * we just lift it into the user-driven reply path here.
 *
 * `params` order maps to `{{1}}`, `{{2}}`, … placeholders in the template
 * message, in order. Trengo validates the count server-side; mismatches
 * surface as 422.
 */
/**
 * Send a Trengo WhatsApp Business HSM template into an existing ticket.
 * Exported so the Client Update send path can call it directly when there's
 * no Hub-side inbox_event anchor to thread through (template messages don't
 * need the anchor's metadata - they only need a ticket id + the AM's token).
 */
export async function sendTrengoTemplateAsUser(
  userId: string,
  ticketId: string,
  templateName: string,
  language: string,
  params: string[],
  /** Optional channel id of the ticket. When provided, a 422 failure
   *  triggers a follow-up `/wa_templates?channel_id=…` lookup so the
   *  thrown error can tell the AM whether the template is actually
   *  missing on this channel OR present-but-rejected for a different
   *  reason (language mismatch, var count, etc.). Skipped when omitted
   *  so non-Client-Update callers keep their cheaper failure path. */
  channelId?: number | null,
): Promise<{ message_id: string }> {
  const token = await getUserPlatformToken(userId, "trengo")
  if (!token) throw new NeedsConnectError("trengo")

  // Hard guarantee at the API boundary: any caller passing multi-line params
  // (Client Update composer, future template flows) gets a Meta-valid send
  // automatically - no 422 from forgotten sanitisation upstream.
  const safeParams = params.map(sanitizeWaTemplateParam)

  // Trengo's HSM template endpoint expects EACH parameter as a structured
  // `{type, key, value}` object - NOT a bare string. Verified against
  // developers.trengo.com/reference: `type` selects the component
  // (body/header/button/otp), `key` is the placeholder identifier
  // (`{{1}}`, `{{2}}`, …), `value` is the substitution.
  const structuredParams = safeParams.map((value, idx) => ({
    type: "body",
    key: `{{${idx + 1}}}`,
    value,
  }))

  // Resolve the numeric `hsm_id` from the template name. The /wa_sessions
  // endpoint requires the integer id, NOT the slug - the old code path was
  // posting to /tickets/{id}/messages with `template_name` which is silently
  // not a template-supporting endpoint (only accepts message/internal_note/
  // subject/attachment_ids per Trengo docs). Trengo therefore fell back to
  // a text-message shape and forwarded `text.body = <something non-string>`
  // to Meta → misleading "expected: 'string'" 422.
  if (!channelId) {
    throw new Error(
      `Trengo template send needs channelId to resolve hsm_id for '${templateName}'`,
    )
  }
  const approvedTemplates = await fetchWaTemplates(channelId)
  const tmpl = approvedTemplates.find(
    (t) => (t.slug ?? t.title) === templateName,
  )
  if (!tmpl) {
    throw new Error(
      `Template '${templateName}' is niet approved op channel ${channelId}. Approve 'm in Trengo → Settings → Channels → die channel → Templates.`,
    )
  }

  // POST /v2/wa_sessions is Trengo's HSM template send endpoint. Accepts
  // either `recipient_phone_number` or `ticket_id` - we always have the
  // ticket id because the caller resolved an existing conversation, so we
  // pass that and the message lands in the same ticket.
  const payload = {
    hsm_id: tmpl.id,
    ticket_id: ticketId,
    params: structuredParams,
  }

  const res = await fetch(`https://app.trengo.com/api/v2/wa_sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 401 || res.status === 403) {
    // The user's stored Trengo token is no longer valid (revoked, expired,
    // wrong workspace). Surface as a needs-connect so the UI can prompt
    // them to reconnect via /account instead of showing a raw 401.
    throw new NeedsConnectError("trengo")
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    // Trengo's "Message is outside the 24 hour window" pattern shows up
    // whenever Trengo doesn't recognise our request as a valid template
    // send - could be template-not-on-channel, language mismatch, wrong
    // var count, etc. Fetch the channel's approved templates so the
    // error can pinpoint the actual mismatch instead of guessing.
    const channelMatch = errText.match(
      /Message is outside the 24 hour window[\s\S]*?channel \(([0-9a-f-]{36})\)/,
    )
    if (channelMatch && channelId) {
      const channelUuidFromErr = channelMatch[1]
      let approved: Array<{ name: string; lang: string; vars: number }> = []
      try {
        const templates = await fetchWaTemplates(channelId)
        approved = templates.map((t) => ({
          name: t.slug ?? t.title,
          lang: t.language,
          vars: (t.message?.match(/\{\{\d+\}\}/g) ?? []).length,
        }))
      } catch {
        // best-effort enrichment; fall through to generic message below
      }
      const ours = approved.find((t) => t.name === templateName)
      if (!ours) {
        const sameAm = approved.filter((t) => t.name.startsWith(templateName.replace(/_\d+$/, "")))
        const hint =
          sameAm.length > 0
            ? ` Wel approved op deze channel met dezelfde naam-prefix: ${sameAm.map((t) => t.name).join(", ")}.`
            : ""
        throw new Error(
          `Template '${templateName}' staat NIET in de approved lijst voor channel ${channelUuidFromErr}.${hint} Approve 'm in Trengo → Settings → Channels → die channel → Templates.`,
        )
      }
      // Template IS in the approved list but Trengo still rejected - pinpoint why.
      const mismatches: string[] = []
      if (ours.lang !== language) mismatches.push(`language=${ours.lang} (wij sturen ${language})`)
      if (ours.vars !== safeParams.length) mismatches.push(`vars=${ours.vars} (wij sturen ${safeParams.length})`)
      const detail = mismatches.length > 0
        ? `: ${mismatches.join(", ")}`
        : `: Trengo accepteert 'm niet en de mismatch is niet duidelijk - raw: ${errText.slice(0, 200)}`
      throw new Error(
        `Template '${templateName}' is approved op channel ${channelUuidFromErr} maar Trengo rejected${detail}`,
      )
    }
    const diag = `template=${templateName} vars=${safeParams.length}`
    // Log the full Trengo response server-side - Meta nests detail inside
    // their error body that the truncated 300-char preview hides. Surfaces
    // in the same Vercel function-invocation log block as the outgoing
    // params diagnostic, so a 422 has both halves of the picture.
    console.log(
      "[trengo-template-send] failure response",
      JSON.stringify({
        status: res.status,
        templateName,
        vars: safeParams.length,
        body: errText,
      }),
    )
    throw new Error(
      `Trengo template send failed (${res.status}, ${diag}): ${errText.slice(0, 300)}`,
    )
  }

  const json = (await res.json()) as {
    id?: number | string
    message_id?: number | string
    data?: { id?: number | string }
    message?: { id?: number | string }
  }
  const id = json.message?.id ?? json.id ?? json.data?.id ?? json.message_id
  if (id == null) {
    throw new Error(
      `Trengo template send returned no message id - keys: ${Object.keys(json).join(",")}`,
    )
  }
  return { message_id: String(id) }
}

/**
 * Send a Trengo WhatsApp Business HSM template directly to a phone
 * number - no existing ticket required. Used by the client-update
 * "test mode" path so we can deliver a template message to an AM's
 * own phone without first staging a fake WA conversation with that
 * contact. Trengo's `POST /v2/wa_sessions` accepts `recipient_phone_number`
 * as an alternative to `ticket_id`.
 *
 * Returns the same `{ message_id }` shape as `sendTrengoTemplateAsUser`
 * for parity, even though the response from `wa_sessions` is a freshly-
 * created session (Trengo internally spawns a ticket for it). The
 * derived id is used by the route to mirror the outbound into
 * inbox_events as usual.
 */
/** Shape of the JSON Trengo's `POST /v2/wa_sessions` can return. The
 *  success body nests the created message under `message` (an object with
 *  its own `id`); some error bodies put a human-readable string there
 *  instead. Older/other endpoints expose the id at the top level or under
 *  `data`. We accept all of these so a good send is never mis-read as a
 *  failure (which would skip the audit stamp and tempt a duplicate resend). */
export type WaSessionResponse = {
  id?: number | string
  message_id?: number | string
  message?: { id?: number | string } | string | null
  data?: {
    id?: number | string
    ticket_id?: number | string
    message_id?: number | string
    message?: { id?: number | string } | null
  } | null
}

/** Pull the created-message id out of a `wa_sessions` response, tolerating
 *  every shape Trengo has been observed to return. Returns `null` when no
 *  id is present anywhere (a genuine failure). Pure + exported for tests. */
export function resolveWaSessionMessageId(
  json: WaSessionResponse,
): number | string | null {
  const nestedMessageId =
    json.message && typeof json.message === "object" ? json.message.id : undefined
  const id =
    json.data?.message_id ??
    json.message_id ??
    json.id ??
    nestedMessageId ??
    json.data?.message?.id ??
    json.data?.id ??
    json.data?.ticket_id
  return id ?? null
}

export async function sendTrengoTemplateToPhoneAsUser(
  userId: string,
  recipientPhoneNumber: string,
  templateName: string,
  params: string[],
  channelId: number,
): Promise<{ message_id: string }> {
  const token = await getUserPlatformToken(userId, "trengo")
  if (!token) throw new NeedsConnectError("trengo")

  const safeParams = params.map(sanitizeWaTemplateParam)
  const structuredParams = safeParams.map((value, idx) => ({
    type: "body",
    key: `{{${idx + 1}}}`,
    value,
  }))

  // Resolve numeric hsm_id from the template name. Same shape as the
  // ticketed variant, just keyed off recipient_phone_number instead of
  // ticket_id.
  const approvedTemplates = await fetchWaTemplates(channelId)
  const tmpl = approvedTemplates.find(
    (t) => (t.slug ?? t.title) === templateName,
  )
  if (!tmpl) {
    throw new Error(
      `Template '${templateName}' is niet approved op channel ${channelId}. Approve 'm in Trengo → Settings → Channels → die channel → Templates.`,
    )
  }

  const payload = {
    hsm_id: tmpl.id,
    recipient_phone_number: recipientPhoneNumber,
    params: structuredParams,
  }

  const res = await fetch(`https://app.trengo.com/api/v2/wa_sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 401 || res.status === 403) {
    throw new NeedsConnectError("trengo")
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    console.log(
      "[trengo-template-send-phone] failure response",
      JSON.stringify({
        status: res.status,
        templateName,
        recipientPhoneNumber,
        body: errText,
      }),
    )
    throw new Error(
      `Trengo template-to-phone send failed (${res.status}, template=${templateName}, recipient=${recipientPhoneNumber}): ${errText.slice(0, 300)}`,
    )
  }

  const json = (await res.json()) as WaSessionResponse
  const id = resolveWaSessionMessageId(json)
  if (id == null) {
    // Surface the full body (trimmed) instead of just the top-level keys.
    // When Trengo 200s with `{message:"<reason>"}` this exposes the reason;
    // it also protects against a false "failed" toast on a send that
    // actually went out (which would otherwise skip the audit stamp and
    // tempt the AM into a duplicate re-send).
    const raw = JSON.stringify(json).slice(0, 400)
    throw new Error(`Trengo wa_sessions returned no message id. Response: ${raw}`)
  }
  return { message_id: String(id) }
}

/** Email-only send fields that piggyback on the same message endpoint.
 *  Subject overrides the ticket's auto `Re: ` default (most replies don't
 *  set this); cc / bcc are comma-separated strings (Trengo's array shape
 *  500's per Phase 3 probe); html is the rendered rich-text body, with the
 *  plain-text `message` carried as fallback for clients that strip HTML. */
type EmailExtras = {
  subject?: string
  cc?: string[]
  bcc?: string[]
  html?: string
}

/**
 * Send free-text into a Trengo ticket. Exported so the Client Update email
 * path can bypass the inbox-event anchor when there's no Hub-side history
 * yet (same shape as `sendTrengoTemplateAsUser`).
 */
export async function sendTrengoReplyAsUser(
  userId: string,
  ticketId: string,
  message: string,
  internalNote: boolean,
  attachmentIds: number[] = [],
  email?: EmailExtras,
): Promise<{ message_id: string }> {
  const token = await getUserPlatformToken(userId, "trengo")
  if (!token) throw new NeedsConnectError("trengo")

  const payload: Record<string, unknown> = { message, internal_note: internalNote }
  if (attachmentIds.length > 0) payload.attachment_ids = attachmentIds

  if (email) {
    if (email.subject?.trim()) payload.subject = email.subject.trim()
    if (email.html?.trim()) payload.html = email.html
    // Trengo's v2 message endpoint 500'd on cc/bcc-as-array during the
    // Phase 3 probe but accepted cc-as-string. Receive-side `email_message.cc`
    // is also a single value - treating it as a comma-separated string keeps
    // both sides consistent. Empty arrays produce no header (correct).
    const ccStr = (email.cc ?? []).map((s) => s.trim()).filter(Boolean).join(", ")
    const bccStr = (email.bcc ?? []).map((s) => s.trim()).filter(Boolean).join(", ")
    if (ccStr) payload.cc = ccStr
    if (bccStr) payload.bcc = bccStr
  }

  const res = await fetch(`https://app.trengo.com/api/v2/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 401 || res.status === 403) {
    // Stored token rejected by Trengo (revoked / wrong workspace). Bubble
    // up as needs-connect so the UI surfaces the existing reconnect prompt
    // instead of the raw error.
    throw new NeedsConnectError("trengo")
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`Trengo send failed (${res.status}): ${errText.slice(0, 200)}`)
  }

  // Trengo's actual response shape (verified via probe 2026-05-06):
  //   { "message": { "id": <int>, "ticket_id": …, "type": "OUTBOUND", … } }
  // Older/other endpoints return { id } at top level or { data: { id } }, so
  // we try all three paths to stay robust. Without a valid message id the
  // mirror row gets `source_msg_id=trengo:msg:` (empty), which fails to dedup
  // against Trengo's later OUTBOUND webhook → the Hub shows the reply twice.
  const json = (await res.json()) as {
    id?: number | string
    message_id?: number | string
    data?: { id?: number | string }
    message?: { id?: number | string }
  }
  const id = json.message?.id ?? json.id ?? json.data?.id ?? json.message_id
  if (id == null) {
    throw new Error(
      `Trengo send returned no message id - keys: ${Object.keys(json).join(",")}`,
    )
  }
  return { message_id: String(id) }
}

// --- Slack ---------------------------------------------------------------

async function sendSlackReplyAsUser(
  userId: string,
  channel: string,
  message: string,
  threadTs: string | undefined,
): Promise<{ ts: string }> {
  const token = await getUserPlatformToken(userId, "slack")
  if (!token) throw new NeedsConnectError("slack")

  const body: Record<string, unknown> = {
    channel,
    text: message,
    as_user: true,
  }
  if (threadTs) body.thread_ts = threadTs

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  })

  const json = (await res.json()) as { ok: boolean; ts?: string; error?: string }
  if (!json.ok) {
    throw new Error(`Slack send failed: ${json.error ?? "unknown"}`)
  }
  return { ts: json.ts ?? "" }
}

// --- Public API ----------------------------------------------------------

export type ReplyResult = {
  source: "trengo" | "slack"
  outboundMsgId: string
  inboxEventId: string
}

/**
 * Send a reply to whichever platform produced this inbox event. Currently
 * supports Trengo and Slack - Monday "updates" are CRM-side notes, not chat
 * messages, and we don't surface a reply affordance for them.
 *
 * `internalNote=true` posts as a Trengo internal note (team-only bubble in
 * the conversation, invisible to the client). The Hub mirrors it with
 * is_internal=true so it renders with a distinct bubble in chat-pane, and
 * any `@FirstName` in the body fans out Updates to the tagged teammates
 * with a push notification. Slack doesn't have a native internal-note
 * concept, so internalNote is silently ignored on Slack threads.
 */
export type TemplateSendOption = {
  /** Trengo template name (slug, e.g. "rl_universal_roel"). */
  name: string
  /** Template language code (`nl`, `en`, etc.). Comes from the template
   *  record itself - composer never asks the AM. */
  language: string
  /** Ordered values for `{{1}}`, `{{2}}`, … placeholders. */
  params: string[]
  /** The template's source body (with `{{N}}` placeholders intact). The
   *  composer already has it from the template-list fetch, so passing it
   *  through lets the Hub mirror render the actual sent text without a
   *  second Trengo round-trip. */
  body?: string
}

export async function replyToInboxEvent(
  userId: string,
  eventId: string,
  message: string,
  options: {
    internalNote?: boolean
    attachmentIds?: number[]
    /** When set, sends a WhatsApp Business template instead of free text.
     *  Required for outbound outside the 24h conversation window (Meta
     *  rule); also valid inside the window when the AM picks Template
     *  mode. Mutually exclusive with `attachmentIds` and `internalNote`
     *  (Trengo's template endpoint doesn't support either). */
    template?: TemplateSendOption
    /** Email-only extras: subject override, CC/BCC, HTML body. Ignored
     *  on non-email Trengo channels (WhatsApp etc. ignore them at the
     *  Trengo end too) but we still gate at the route layer. `message`
     *  remains the plain-text fallback when `email.html` is set. */
    email?: EmailExtras
  } = {},
): Promise<ReplyResult> {
  const trimmed = message.trim()
  const template = options.template
  const emailHasHtml = !!options.email?.html?.trim()
  // Allow empty plain `message` when there's at least one of: attachment,
  // template, or rich-text HTML body (email composer sends `message` as a
  // plain-text fallback derived from the HTML; if HTML is set, message can
  // legitimately be empty for the same call).
  const attachmentIds = (options.attachmentIds ?? []).filter((n) => Number.isFinite(n))
  if (!trimmed && attachmentIds.length === 0 && !template && !emailHasHtml) {
    throw new Error("Empty reply")
  }
  const internalNote = options.internalNote === true

  if (template) {
    if (internalNote) throw new Error("Templates can't be sent as internal notes")
    if (attachmentIds.length > 0) {
      throw new Error("Templates can't be combined with attachments - Meta limitation")
    }
    if (!template.name?.trim()) throw new Error("Template name required")
    if (!template.language?.trim()) throw new Error("Template language required")
  }

  const event = await loadEvent(eventId)
  if (!event) throw new Error("Event not found")

  if (event.source === "monday") {
    throw new Error("Monday updates aren't replyable from the Hub")
  }
  if (event.source !== "trengo" && event.source !== "slack") {
    throw new Error(`Reply not supported for source: ${event.source}`)
  }
  if (template && event.source !== "trengo") {
    throw new Error("Templates only supported on Trengo (WhatsApp) threads")
  }

  const supabase = await createAdminClient()

  // Resolve the user's identity for the outbound row (for author_name_cached
  // + author_external when we mirror the sent message back into inbox_events).
  const { data: hubUser } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("id", userId)
    .maybeSingle()
  if (!hubUser) throw new Error("Hub user not found")

  let outboundId = ""
  let sourceMsgId = ""
  let createdAtSrc = new Date().toISOString()
  // Body we mirror into inbox_events. For free text it's the user input; for
  // templates we render the rendered text by substituting {{n}} so the Hub
  // history shows what the customer actually saw, not just "[template:foo]".
  let mirrorBody = trimmed

  if (event.source === "trengo") {
    // source_thread is `trengo:ticket:<id>`
    const ticketId = (event.source_thread ?? "").replace(/^trengo:ticket:/, "")
    if (!ticketId) throw new Error("Missing Trengo ticket id on event")
    if (template) {
      const r = await sendTrengoTemplateAsUser(
        userId,
        ticketId,
        template.name,
        template.language,
        template.params,
        // hsm_id lookup needs the channel id; events carry it from the
        // original Trengo webhook, so propagate it straight through.
        event.trengo_channel_id,
      )
      outboundId = r.message_id
      sourceMsgId = `trengo:msg:${outboundId}`
      // Render placeholders for the mirror so Hub history matches what the
      // customer actually received - that's the sanitised single-line
      // version, not the multi-line composer draft. We re-apply the
      // sanitiser here (idempotent) instead of plumbing it through the
      // send function's return value.
      const sanitisedForMirror: TemplateSendOption = {
        ...template,
        params: template.params.map(sanitizeWaTemplateParam),
      }
      mirrorBody =
        renderTemplatePreview(sanitisedForMirror) || `[Template: ${template.name}]`
    } else {
      // For internal notes, rewrite `@Full Name` mentions to Trengo handles
      // (`@roy430594`) so Trengo creates a REAL mention + notification for the
      // tagged teammate. The Hub keeps the readable name version (mirrorBody /
      // fan-out below both use `trimmed`). Roy 2026-07-16.
      const trengoBody = internalNote
        ? await convertMentionNamesToHandles(trimmed)
        : trimmed
      const r = await sendTrengoReplyAsUser(
        userId,
        ticketId,
        trengoBody,
        internalNote,
        attachmentIds,
        options.email,
      )
      outboundId = r.message_id
      sourceMsgId = `trengo:msg:${outboundId}`
    }
  } else {
    // Slack - source_thread is either `slack:thread:<channel>:<thread_ts>` or
    // `slack:channel:<channel>`. Channel ID is also the second segment of
    // thread_key for DMs (slack:dm:<user_id> doesn't carry channel, so we
    // pull it from the source_msg_id parts: slack:msg:<channel>:<ts>).
    if (!trimmed) {
      // Slack rejects empty text and we don't pipe attachments to Slack
      // (no upload endpoint), so refuse early with a clear message.
      throw new Error("Slack replies require a text body - attachments aren't supported here")
    }
    let channel = ""
    let threadTs: string | undefined

    if (event.source_thread?.startsWith("slack:thread:")) {
      const parts = event.source_thread.split(":")
      channel = parts[2] ?? ""
      threadTs = parts[3]
    } else if (event.source_thread?.startsWith("slack:channel:")) {
      channel = event.source_thread.replace(/^slack:channel:/, "")
    } else if (event.source_msg_id?.startsWith("slack:msg:")) {
      const parts = event.source_msg_id.split(":")
      channel = parts[2] ?? ""
    }
    if (!channel) throw new Error("Could not determine Slack channel for reply")

    const r = await sendSlackReplyAsUser(userId, channel, trimmed, threadTs)
    outboundId = r.ts
    sourceMsgId = `slack:msg:${channel}:${outboundId}`
    createdAtSrc = new Date(parseFloat(r.ts) * 1000).toISOString()
  }

  // Mirror the outbound reply back into inbox_events so the chat thread in
  // the Hub stays a complete picture. For templates, mirrorBody holds the
  // rendered text (with {{n}} substituted) - Hub history matches what the
  // customer received, not just "[template:foo]".
  const previewSource = mirrorBody.length > 0 ? mirrorBody : trimmed
  const titlePreview =
    previewSource.length > 100 ? previewSource.slice(0, 100) + "…" : previewSource
  const bodyFull = previewSource.length > 100 ? previewSource : null

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: "chat",
      client_id: event.client_id,
      author_id: userId,
      assignee_id: userId,
      title: titlePreview,
      body: bodyFull,
      status: "read", // user just sent it - already read for them
      source: event.source,
      source_thread: event.source_thread,
      source_msg_id: sourceMsgId,
      thread_key: event.thread_key,
      scope: event.scope,
      author_kind: "rl_team",
      author_external: null, // we're posting via user-token; external id varies per platform
      author_name_cached: hubUser.name ?? hubUser.email,
      classify_method: "manual",
      created_at_src: createdAtSrc,
      // Propagate the original event's channel id so the outbound row passes
      // the per-user channel-subscription filter (Trengo only - Slack uses
      // different routing and channel_id stays null for it).
      trengo_channel_id: event.source === "trengo" ? event.trengo_channel_id : null,
      // Internal-note flag drives the team-only yellow bubble in chat-pane
      // and gates the @-mention fan-out below.
      is_internal: internalNote,
    })
    .select("id")
    .single()

  if (error || !inserted) {
    // The outbound send already succeeded - surface the storage error but
    // don't let it look like the reply itself failed.
    console.error("Reply mirror insert failed:", error)
    throw new Error("Reply sent, but failed to store in Hub history")
  }

  // Internal-note @-mention fan-out: when the AM tags a teammate inside a
  // team-only note (`@Stefan kun je dit even checken?`), each tagged user
  // gets an Update in their inbox + a push notification - same shape as
  // the task-comment mention pipeline. Skipped for client-visible replies
  // (a stray @-mention there is just a typo and shouldn't ping anyone).
  if (internalNote) {
    fanOutMentionsForInternalNote(supabase, {
      sourceEventId: event.id,
      noteEventId: inserted.id,
      noteBody: trimmed,
      clientId: event.client_id,
      authorUserId: userId,
      authorName: hubUser.name ?? hubUser.email ?? "Iemand",
    }).catch((e) => console.error("Internal-note mention fan-out failed:", e))
  }

  // Smart contact-name extraction: when the AM types something like
  // "Hi Evelyn" / "Ha Marian" in a free-text reply to a contact whose
  // current name is weak (Unknown, raw phone number, email username), pull
  // the greeting target as the new contact name and propagate to Trengo.
  // Templates and internal notes are skipped (templates are formulaic and
  // their first variable is usually the name already; internal notes are
  // team-to-team and their @mentions point at staff, not the contact).
  if (
    !template &&
    !internalNote &&
    event.source === "trengo" &&
    event.thread_key?.startsWith("trengo:contact:") &&
    trimmed.length > 0
  ) {
    smartUpdateContactNameFromGreeting({
      supabase,
      threadKey: event.thread_key,
      messageBody: trimmed,
    }).catch((e) => console.error("Smart name extraction failed:", e))
  }

  return {
    source: event.source,
    outboundMsgId: outboundId,
    inboxEventId: inserted.id,
  }
}

/**
 * Parse `@FirstName` patterns out of an internal-note body, resolve them
 * to Hub user ids, and emit one Update event + one push notification per
 * mentioned user. Mirror of the task-comment mention path so the
 * notification feel is consistent across the inbox.
 *
 * Skips the author (no point pinging yourself) and dedupes when the same
 * user is @'d twice in one note. Uses fire-and-forget semantics on the
 * caller side - a flake here shouldn't roll back the reply.
 */
async function fanOutMentionsForInternalNote(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  args: {
    sourceEventId: string
    noteEventId: string
    noteBody: string
    clientId: string
    authorUserId: string
    authorName: string
  },
): Promise<void> {
  // Greedy capture: an @-mention is `@` followed by 1-N name tokens. The
  // up-to-5 secondary tokens allow Dutch tussenvoegsel + multi-word
  // surnames ("Roel van der Harst" = 4 words). Resolution then walks
  // longest-prefix-first so "@Roel van der Harst kun je" still matches
  // the 4-word user name (the trailing "kun je" gets dropped).
  const captures = Array.from(
    args.noteBody.matchAll(
      /@([A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+){0,5})/g,
    ),
  )
    .map((m) => m[1].trim())
    .filter(Boolean)
  if (captures.length === 0) return

  const { data: rows } = await supabase
    .from("users")
    .select("id, name")
    .not("name", "is", null)
  if (!rows) return

  const ids = new Set<string>()
  for (const cap of captures) {
    const tokens = cap.split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    let matchedRow: { id: string; name: string } | null = null
    // Try full-name longest-prefix first.
    for (let i = tokens.length; i >= 1 && !matchedRow; i--) {
      const candidate = tokens.slice(0, i).join(" ").toLowerCase()
      for (const row of rows as Array<{ id: string; name: string | null }>) {
        const name = (row.name ?? "").toLowerCase().trim()
        if (name && name === candidate) {
          matchedRow = { id: row.id, name }
          break
        }
      }
    }
    // Last resort: first-name-only (single-word capture, matches the
    // first token of any user's full name - same UX as the picker).
    if (!matchedRow && tokens.length === 1) {
      const single = tokens[0].toLowerCase()
      for (const row of rows as Array<{ id: string; name: string | null }>) {
        const name = (row.name ?? "").toLowerCase().trim()
        if (name && name.split(/\s+/)[0] === single) {
          matchedRow = { id: row.id, name }
          break
        }
      }
    }
    if (matchedRow && matchedRow.id !== args.authorUserId) {
      ids.add(matchedRow.id)
    }
  }
  if (ids.size === 0) return

  // Resolve a client name for the notification title - falls back to the
  // raw client_id if the client isn't in the cache (rare, but tolerable).
  const { data: clientRow } = await supabase
    .from("clients")
    .select("name")
    .eq("monday_item_id", args.clientId)
    .maybeSingle()
  const clientName =
    (clientRow?.name as string | undefined) ?? args.clientId ?? "client"

  const titlePreview = `${args.authorName} mentioned you in ${clientName}`
  const bodyPreview =
    args.noteBody.length > 240 ? args.noteBody.slice(0, 237) + "…" : args.noteBody

  for (const mentionedId of ids) {
    const { data: notif, error: notifErr } = await supabase
      .from("inbox_events")
      .insert({
        kind: "update",
        client_id: args.clientId,
        author_id: args.authorUserId,
        assignee_id: mentionedId,
        title: titlePreview,
        body: bodyPreview,
        status: "unread",
        source: "manual",
        source_ref: {
          mention_in_event_id: args.sourceEventId,
          mention_in_note_id: args.noteEventId,
          mention_origin: "internal_note",
        },
        author_kind: "rl_team",
        classify_method: "manual",
      })
      .select("id")
      .single()
    if (notifErr) {
      console.error("Mention notification insert failed:", notifErr.message)
      continue
    }
    if (notif?.id) {
      sendPushToUser(mentionedId, {
        title: titlePreview,
        body: bodyPreview,
        url: "/inbox",
        tag: `mention-${notif.id}`,
      }).catch((e) => console.error("Mention push failed:", e))
    }
  }
}

/** Substitute `{{1}}`, `{{2}}`, … in a template's source body with the
 *  user-supplied params, in order. Returns the rendered text we mirror into
 *  inbox_events so Hub history shows what the customer actually received.
 *  Falls back to `[Template: name]` if the composer didn't pass the body
 *  through (defensive - shouldn't happen on the happy path). */
function renderTemplatePreview(template: TemplateSendOption): string {
  if (!template.body) {
    if (template.params.length === 0) return `[Template: ${template.name}]`
    return `[Template: ${template.name}] ${template.params.join(" · ")}`
  }
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, idx) => {
    const i = parseInt(idx, 10) - 1
    return template.params[i] ?? ""
  })
}

// --- Smart contact-name extraction --------------------------------------

/**
 * Pull a likely first-name out of an outbound greeting like "Hi Evelyn,",
 * "Ha Marian", "Hey Pieter!". Returns null when no greeting is found OR
 * the captured token is in a stoplist of false positives (Team, Support,
 * Allemaal, etc.). Case-insensitive on the greeting word; the captured
 * name must start with a capital letter to avoid grabbing "hi friends" or
 * "hello there" type phrases.
 */
function extractGreetingName(message: string): string | null {
  if (!message) return null
  const re =
    /\b(?:hi|hey|hello|hallo|ha|beste|dag|goedemorgen|goedemiddag|goedenavond)\s+([A-ZÀ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]{1,29})(?=\s*[,.!?\n]|$)/i
  const m = message.match(re)
  if (!m) return null
  const candidate = m[1].trim()
  const STOPLIST = new Set([
    "Team", "Support", "Admin", "All", "Allemaal", "Everyone", "Iedereen",
    "Sir", "Madam", "Mevrouw", "Meneer", "Daar", "There",
    "Friends", "Vrienden", "Folks", "Mensen", "People", "Lieve",
  ])
  if (STOPLIST.has(candidate)) return null
  return candidate
}

/** Heuristic: is the contact's current cached name a "weak" placeholder we
 *  should overwrite? Phone numbers (+31…), email addresses/usernames, and
 *  the literal "Unknown" all count as weak. A real human name (Capital
 *  start, no digits, doesn't match the external id) is treated as strong
 *  and left alone - manual edits via the editable header always win. */
function isCurrentNameWeak(currentName: string | null, authorExternal: string | null): boolean {
  const t = (currentName ?? "").trim()
  if (!t) return true
  if (t === "Unknown") return true
  if (/^\+?\d/.test(t)) return true // starts with phone digit
  if (/^[\(\d\s\-\+]+$/.test(t)) return true // pure phone-ish chars
  if (/@/.test(t)) return true // email-as-name
  if (authorExternal) {
    const ext = authorExternal.toLowerCase().trim()
    if (t.toLowerCase() === ext) return true
    const emailUser = ext.split("@")[0]
    if (emailUser && t.toLowerCase() === emailUser) return true
  }
  return false
}

/** Best-effort: when the AM types a greeting in a free-text reply, pull the
 *  name and propagate it to the Trengo contact (and Hub-side mirror) - but
 *  only when the existing name is a weak placeholder. Fire-and-forget; never
 *  throws because send already succeeded. */
async function smartUpdateContactNameFromGreeting(args: {
  supabase: Awaited<ReturnType<typeof createAdminClient>>
  threadKey: string
  messageBody: string
}): Promise<void> {
  const extracted = extractGreetingName(args.messageBody)
  if (!extracted) return

  const contactId = args.threadKey.replace(/^trengo:contact:/, "")
  if (!contactId) return

  // Check the latest contact-authored event for the cached display name +
  // raw author_external (phone / email). Outbound mirrors are skipped.
  const { data } = await args.supabase
    .from("inbox_events")
    .select("author_name_cached, author_external")
    .eq("thread_key", args.threadKey)
    .neq("author_kind", "rl_team")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ author_name_cached: string | null; author_external: string | null }>()
  if (!data) return

  if (!isCurrentNameWeak(data.author_name_cached, data.author_external)) return
  // Don't update if the extracted name already appears in the current name
  // (e.g. "Evelyn van Dijk" - we'd just be re-setting a more specific name
  // to the first token).
  if (data.author_name_cached?.toLowerCase().includes(extracted.toLowerCase())) return

  try {
    await updateTrengoContactName(contactId, extracted)
    // Mirror the new name into Hub-side rows so the thread list picks it
    // up immediately (without waiting for the next inbound webhook).
    await args.supabase
      .from("inbox_events")
      .update({ author_name_cached: extracted })
      .eq("thread_key", args.threadKey)
      .neq("author_kind", "rl_team")
  } catch (e) {
    console.error("smartUpdateContactNameFromGreeting: Trengo write failed", e)
  }
}
