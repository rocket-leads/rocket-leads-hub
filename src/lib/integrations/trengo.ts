import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { ResolvedEntity } from "./resolved-entity"

let cachedToken: { value: string; expiresAt: number } | null = null

async function getTrengoToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "trengo")
    .single()
  if (!data) throw new Error("Trengo token not configured. Go to Settings → API Tokens.")
  const token = decrypt(data.token_encrypted)
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function trengoFetch<T>(path: string, retries = 3): Promise<T> {
  const token = (await getTrengoToken()).trim()
  const url = `https://app.trengo.com/api/v2${path}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      next: { revalidate: 300 },
    })

    // Retry on rate limit with exponential backoff
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10)
      const delay = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt
      await sleep(delay)
      continue
    }

    const contentType = res.headers.get("content-type") ?? ""

    if (!contentType.includes("application/json")) {
      throw new Error(`Trengo endpoint not found: ${path}`)
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Trengo API error ${res.status}: ${(data.message as string) ?? JSON.stringify(data)}`)
    }
    return res.json() as Promise<T>
  }

  throw new Error("Trengo API rate limit exceeded after retries")
}

export type TrengoChannel = {
  id: number
  /** Trengo's `name` field is null for many WhatsApp/Email channels - the
   *  human-readable label lives in different fields per channel type
   *  (title / display_name / phone / email_address / from). Coalesce before
   *  showing to users. Type kept loose to reflect API reality. */
  name: string | null
  type: string
  /** All additional fields Trengo returns. Probed for display name fallbacks. */
  title?: string | null
  display_name?: string | null
  phone?: string | null
  email_address?: string | null
  from?: string | null
  // Allow any other shape Trengo returns without breaking callers.
  [key: string]: unknown
}

// Trengo calls these "tickets" in their API
export type TrengoConversation = {
  id: number
  status: string
  subject: string | null
  channel: TrengoChannel | null
  contact: { id: number; name: string; email?: string } | null
  /** Trengo's /tickets list endpoint returns activity timestamps, NOT a
   *  `latest_message` object. The shape they document on GET /tickets:
   *    - latest_message_at         "YYYY-MM-DD HH:mm:ss" (any direction)
   *    - latest_received_message_at "YYYY-MM-DD HH:mm:ss" (inbound only)
   *  Both omitted on tickets with no message activity yet. We pull these
   *  to bound the polling-cron's per-ticket /messages fetch to tickets
   *  that actually moved in the lookback window. */
  latest_message_at: string | null
  latest_received_message_at: string | null
  messages_count: number | null
  /** @deprecated Some Hub callers historically read `c.latest_message`
   *  on /tickets results. The endpoint doesn't populate it - those code
   *  paths fell silent (preview never rendered). Kept optional so the
   *  type still compiles for legacy readers; new code should call
   *  `fetchMessages(ticketId)` or rely on `latest_message_at`. */
  latest_message?: { id: number; message: string; type: string; created_at: string } | null
  created_at: string
  closed_at: string | null
  assignee: { name: string } | null
}

export type TrengoMessage = {
  id: number
  /** Trengo's `GET /tickets/{id}/messages` returns the text in `message`,
   *  not `body` (confirmed via probe). Some plans / legacy callers used
   *  `body` so we keep both optional - readers should prefer
   *  `message ?? body`. */
  body?: string
  message?: string
  author_type: "User" | "Contact" | string
  author: { id: number; name: string } | null
  created_at: string
  type: string
  attachments: Array<{ name: string; url: string }> | null
  /** Email-specific envelope, present only for messages on Trengo email
   *  channels. Subject + From/To/Cc come through here even when the
   *  outer `message` field is the plain-text or HTML body. Used by the
   *  Hub's polling cron to capture subject + sender address into
   *  inbox_events.email_subject / email_from. */
  email_message?: {
    subject?: string | null
    from?: string | null
    to?: string | null
    cc?: string | null
    html?: string | null
  } | null
  /** Author id for team-authored messages (OUTBOUND / NOTE). Trengo puts the
   *  agent's numeric user id here; `agent` carries the full object. */
  user_id?: number | null
  /** Full author object on team messages (name, email, profile_image). More
   *  reliable than the legacy `author` field, which is null on notes. */
  agent?: {
    id: number
    name?: string | null
    first_name?: string | null
    email?: string | null
    profile_image?: string | null
  } | null
  /** Structured @-mentions on a note — authoritative list of mentioned Trengo
   *  user ids, so we don't have to regex the body. */
  mentions?: Array<{ user_id: number }> | null
}

/** A Trengo workspace user (agent). Used to resolve note authors + @-mention
 *  targets to their display name, and to map them onto Hub users by name. */
export type TrengoUser = {
  id: number
  name: string | null
  first_name: string | null
  email: string | null
  profile_image: string | null
}

type TicketPage = {
  data: TrengoConversation[]
  meta?: { current_page: number; last_page: number }
}

type MessagePage = {
  data: TrengoMessage[]
  meta?: { current_page: number; last_page: number }
}

const MAX_PAGES = 10

export async function fetchConversations(contactId: string): Promise<TrengoConversation[]> {
  const all: TrengoConversation[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const data = await trengoFetch<TicketPage>(
      `/tickets?contact_id=${contactId}&page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/** True for any Trengo channel whose `type` describes an email channel
 *  (Trengo uses "email", "imap", "outlook", or sometimes a "*mail*"
 *  marker). Centralised so the workspace-wide and per-AM helpers agree
 *  on what counts as an email channel. */
export function isEmailChannelType(type: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase()
  return t === "email" || t.includes("mail") || t === "imap" || t === "outlook"
}

/** True for any Trengo channel whose `type` describes a WhatsApp channel
 *  (`whatsapp`, `wa_*`, etc.). Centralised so the Settings → Users
 *  dropdown and any future WA-bootstrap helper agree on what counts. */
export function isWhatsAppChannelType(type: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase()
  return t.includes("whatsapp") || t.startsWith("wa_") || t === "wa"
}

/**
 * Return the workspace's first Trengo email channel. Used to bootstrap a
 * new outbound email ticket when the contact has no existing email
 * thread - Dr. Ludidi etc. who's email-primary on Monday but has never
 * been emailed through Trengo before.
 *
 * Returns null when no email channel exists in this workspace.
 *
 * Prefer `findAmEmailChannel(amUserId)` for client-update sends - that
 * picks the AM's personally-selected email channel (so the email goes
 * FROM the AM's address, not the workspace's generic catch-all).
 */
export async function findFirstEmailChannel(): Promise<TrengoChannel | null> {
  const channels = await fetchTrengoChannels()
  return channels.find((c) => isEmailChannelType(c.type)) ?? null
}

/**
 * Resolve the email channel an AM should send FROM. Reads the AM's
 * explicit `users.primary_email_channel_id` setting (configured at
 * /account → Outbound sender channels) and looks up the channel in
 * the workspace metadata. Returns null when the AM hasn't picked one
 * yet - caller surfaces a clear "configure your outbound channel"
 * error instead of silently falling back to the workspace catch-all
 * (the Roel-vs-`rocket-lea-mail.*@trengomail.com` bug).
 *
 * Note: this used to intersect `trengo_channel_ids` (the VISIBILITY
 * set) with workspace email channels. That overloaded one column for
 * two unrelated concepts - fixed by adding `primary_email_channel_id`
 * (migration 20240043). Visibility stays on `trengo_channel_ids`;
 * outbound is its own explicit column.
 */
export async function findAmEmailChannel(
  amUserId: string,
): Promise<TrengoChannel | null> {
  const { getUserPrimaryChannels } = await import("@/lib/inbox/user-prefs")
  const [{ primaryEmailChannelId }, allChannels] = await Promise.all([
    getUserPrimaryChannels(amUserId),
    fetchTrengoChannels(),
  ])
  if (primaryEmailChannelId == null) return null
  return allChannels.find((c) => c.id === primaryEmailChannelId) ?? null
}

/**
 * Resolve the WhatsApp channel an AM should send FROM. Mirrors
 * `findAmEmailChannel` - reads `users.primary_wa_channel_id` and looks
 * up the workspace channel. Returns null when unset (current send paths
 * fall back to the existing-ticket channel anyway, since WhatsApp has
 * no bootstrap flow - kept here for future use).
 */
export async function findAmWaChannel(
  amUserId: string,
): Promise<TrengoChannel | null> {
  const { getUserPrimaryChannels } = await import("@/lib/inbox/user-prefs")
  const [{ primaryWaChannelId }, allChannels] = await Promise.all([
    getUserPrimaryChannels(amUserId),
    fetchTrengoChannels(),
  ])
  if (primaryWaChannelId == null) return null
  return allChannels.find((c) => c.id === primaryWaChannelId) ?? null
}

/**
 * Send an email to a Trengo contact via the user's token, creating a
 * brand-new ticket. Returns the new ticket id + the message id.
 *
 * Two-step because Trengo's `POST /api/v2/tickets/messages` shortcut
 * returns 405 - that route is read-only. Standard REST flow:
 *   1. `POST /api/v2/tickets`     → create ticket (channel + contact + subject)
 *   2. `POST /api/v2/tickets/{id}/messages` → send body into new ticket
 *
 * If either step fails, the thrown error includes the step + Trengo's
 * response so the dialog's red banner is self-debuggable.
 */
/**
 * Send an email to a raw email address — no Hub-side contact lookup,
 * no contact_id juggling. Mirrors the WhatsApp `wa_sessions` shape that
 * takes `recipient_phone_number` directly: pass the channel + email +
 * subject + body, Trengo resolves/creates the contact internally with
 * the right privacy pairing.
 *
 * Tries a series of body shapes Trengo's `POST /v2/tickets` is known
 * to accept (embedded contact object → flat contact_email fields →
 * identifier). Falls back to the legacy `findOrCreate + ticket(contact_id)`
 * flow when none of the direct shapes succeed, so worksp​aces on older
 * API versions keep working.
 *
 * Roy 2026-06-16: previous flow created a workspace-shared contact, then
 * tried to pair it with a personal email channel, which Trengo 422'd
 * with "Je kunt een (niet)privécontact niet gebruiken voor een
 * (niet)persoonlijk kanaal". By letting Trengo own the contact step we
 * sidestep the privacy mismatch entirely.
 */
export async function sendEmailToAddressAsUser(args: {
  userToken: string
  channelId: number
  email: string
  name?: string
  subject: string
  body: string
}): Promise<{ ticketId: string; messageId: string }> {
  const { userToken, channelId, email, name, subject, body } = args
  const displayName = name ?? email

  // Each candidate is a different shape of body that `POST /v2/tickets`
  // might accept. We try them in order; first 2xx that returns a ticket
  // id wins. Trengo's API doesn't document the exact shape for "create
  // ticket by identifier" — these are the three most likely patterns
  // based on how their other endpoints (wa_sessions, contacts, ticket
  // responses) are structured.
  const candidates: Array<Record<string, unknown>> = [
    // Nested contact - mirrors the GET /tickets response shape.
    {
      channel_id: channelId,
      subject,
      contact: { email, name: displayName },
    },
    // Flat fields - same convention as wa_sessions' recipient_phone_number.
    {
      channel_id: channelId,
      subject,
      contact_email: email,
      contact_name: displayName,
    },
    // Generic identifier - some Trengo endpoints accept this for any
    // channel type.
    {
      channel_id: channelId,
      subject,
      identifier: email,
      contact_name: displayName,
    },
  ]

  let lastErr = ""
  let lastStatus = 0
  for (const payload of candidates) {
    const res = await fetch(`https://app.trengo.com/api/v2/tickets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      const json = (await res.json()) as {
        id?: number | string
        ticket_id?: number | string
        data?: { id?: number | string; ticket_id?: number | string }
      }
      const ticketId =
        json.id ?? json.ticket_id ?? json.data?.id ?? json.data?.ticket_id
      if (ticketId) {
        return sendBodyIntoTicket({ userToken, ticketId: String(ticketId), subject, body })
      }
    } else {
      lastStatus = res.status
      lastErr = await res.text().catch(() => "")
    }
  }

  // Direct shapes all rejected — fall back to the legacy 2-step flow.
  // findOrCreateTrengoEmailContact now prefers channel-scoped lookups
  // first, so this still avoids the privacy-mismatch most of the time;
  // the surfaced error mentions which path we tried last so the AM
  // sees something actionable rather than "unknown".
  try {
    const contact = await findOrCreateTrengoEmailContact({
      userToken,
      channelId,
      email,
      name: displayName,
    })
    return await createEmailMessageForContact({
      userToken,
      contactId: String(contact.id),
      channelId,
      subject,
      body,
    })
  } catch (e) {
    const fallbackMsg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Trengo email-send failed via every shape we know. Last direct-send response (${lastStatus}): ${lastErr.slice(0, 200)}. Fallback flow: ${fallbackMsg.slice(0, 300)}`,
    )
  }
}

/** Internal helper - posts the body into a freshly-created ticket. Used
 *  by both `sendEmailToAddressAsUser` (after the direct ticket-create
 *  worked) and `createEmailMessageForContact` (after the legacy 2-step
 *  contact + ticket flow). */
async function sendBodyIntoTicket(args: {
  userToken: string
  ticketId: string
  subject: string
  body: string
}): Promise<{ ticketId: string; messageId: string }> {
  const sendRes = await fetch(
    `https://app.trengo.com/api/v2/tickets/${args.ticketId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.userToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: args.body,
        subject: args.subject,
        internal_note: false,
      }),
    },
  )
  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => "")
    throw new Error(
      `Trengo email-send failed (${sendRes.status}, ticket=${args.ticketId}): ${errText.slice(0, 300)}`,
    )
  }
  const sendJson = (await sendRes.json()) as {
    id?: number | string
    message?: { id?: number | string }
    data?: { id?: number | string }
  }
  const messageId = sendJson.message?.id ?? sendJson.id ?? sendJson.data?.id
  if (!messageId) {
    throw new Error(
      `Trengo email-send returned no id - keys: ${Object.keys(sendJson).join(",")}`,
    )
  }
  return { ticketId: args.ticketId, messageId: String(messageId) }
}

export async function createEmailMessageForContact(args: {
  userToken: string
  contactId: string
  channelId: number
  subject: string
  body: string
}): Promise<{ ticketId: string; messageId: string }> {
  // Step 1 - create the ticket.
  const createRes = await fetch(`https://app.trengo.com/api/v2/tickets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.userToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      channel_id: args.channelId,
      contact_id: args.contactId,
      subject: args.subject,
    }),
  })
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "")
    // Trengo enforces contact/channel privacy pairing — a personal
    // (per-user) channel must be used with a private contact and
    // vice versa. When the contact resolution returned a workspace-
    // shared contact but the AM's outbound channel is personal,
    // Trengo returns a 422 with the literal placeholder error
    // "Je kunt een (niet)privécontact niet gebruiken voor een
    // (niet)persoonlijk kanaal". Surface a clearer Dutch hint so the
    // AM knows what to fix instead of staring at Trengo's templated
    // copy. Roy 2026-06-16.
    const lower = errText.toLowerCase()
    if (
      createRes.status === 422 &&
      (lower.includes("privécontact") || lower.includes("priv\\u00e9contact")) &&
      (lower.includes("persoonlijk kanaal") || lower.includes("persoonlijk%20kanaal"))
    ) {
      throw new Error(
        `Trengo weigert deze combinatie: de outbound email-channel (id ${args.channelId}) is een persoonlijk kanaal, maar het contact (id ${args.contactId}) is een workspace-gedeeld contact. Verwissel het outbound channel naar een gedeeld kanaal in /account → Outbound sender channels, of maak het contact in Trengo persoonlijk voor deze AM.`,
      )
    }
    throw new Error(
      `Trengo create-ticket failed (${createRes.status}, channel=${args.channelId}, contact=${args.contactId}): ${errText.slice(0, 300)}`,
    )
  }
  const createJson = (await createRes.json()) as {
    id?: number | string
    ticket_id?: number | string
    data?: { id?: number | string; ticket_id?: number | string }
  }
  const ticketId =
    createJson.id ?? createJson.ticket_id ?? createJson.data?.id ?? createJson.data?.ticket_id
  if (!ticketId) {
    throw new Error(
      `Trengo create-ticket returned no id - keys: ${Object.keys(createJson).join(",")}`,
    )
  }

  // Step 2 - send the message into the new ticket. Mirrors the regular
  // outbound email reply payload (subject re-stated for clarity even
  // though the ticket already carries it).
  const sendRes = await fetch(
    `https://app.trengo.com/api/v2/tickets/${ticketId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.userToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: args.body,
        subject: args.subject,
        internal_note: false,
      }),
    },
  )
  if (!sendRes.ok) {
    const errText = await sendRes.text().catch(() => "")
    throw new Error(
      `Trengo email-send failed (${sendRes.status}, ticket=${ticketId}): ${errText.slice(0, 300)}`,
    )
  }
  const sendJson = (await sendRes.json()) as {
    id?: number | string
    message?: { id?: number | string }
    data?: { id?: number | string }
  }
  const messageId = sendJson.message?.id ?? sendJson.id ?? sendJson.data?.id
  if (!messageId) {
    throw new Error(
      `Trengo email-send returned no id - keys: ${Object.keys(sendJson).join(",")}`,
    )
  }
  return { ticketId: String(ticketId), messageId: String(messageId) }
}

/**
 * List all channels in the Trengo workspace. Used by the per-user channel
 * subscription picker on /account so users can pick which Trengo channels
 * (Email, WhatsApp, Voice, etc.) surface in their Hub Client Inbox.
 *
 * Uses the system Trengo token - channel listings are workspace-wide metadata,
 * not tied to a specific agent. Cheap and cached for 5 minutes by trengoFetch.
 */
export async function fetchTrengoChannels(): Promise<TrengoChannel[]> {
  const data = await trengoFetch<{ data: TrengoChannel[] }>(`/channels`)
  return [...data.data].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

/**
 * List all Trengo workspace users (agents). Used to resolve note authors and
 * @-mention targets (Trengo stores mentions as `@<firstname><userId>` handles
 * + a structured `mentions` array) to display names, and to map them onto Hub
 * users by name. Cached 5 min by trengoFetch. Small workspace → one page.
 */
export async function fetchTrengoUsers(): Promise<TrengoUser[]> {
  const data = await trengoFetch<{ data: TrengoUser[] }>(`/users`)
  return data.data
}

/**
 * Trengo's `/channels` returns `name` as the channel-TYPE literal
 * ("Email", "Wa_business") for most channels - useless for picking
 * between several email channels in a dropdown. The user-given label
 * lives in `title` (Trengo sidebar), and for default channels that
 * sidebar label is also generic - the actual routable identifier
 * (email address / phone) sits in `display_name`.
 *
 * Single source of truth so admin + per-user channel listings agree.
 */
const GENERIC_TRENGO_TITLES = new Set([
  "email",
  "wa_business",
  "whatsapp",
  "sms",
  "voip",
  "voice",
  "chat",
  "telegram",
  "facebook",
  "instagram",
  "custom",
  "playground",
])

export function deriveTrengoChannelDisplayName(c: TrengoChannel): string {
  const title = typeof c.title === "string" ? c.title.trim() : ""
  const displayName = typeof c.display_name === "string" ? c.display_name.trim() : ""
  const emailAddress = typeof c.email_address === "string" ? c.email_address.trim() : ""
  const phone = typeof c.phone === "string" ? c.phone.trim() : ""
  const name = typeof c.name === "string" ? c.name.trim() : ""

  if (title && !GENERIC_TRENGO_TITLES.has(title.toLowerCase())) return title
  if (displayName) return displayName
  if (emailAddress) return emailAddress
  if (phone) return phone
  if (title) return title
  if (name) return name
  return `Channel ${c.id}`
}

/** Email-specific channel metadata exposed by `GET /channels`. We surface
 *  the signature + sender info to the email composer so the AM gets the same
 *  signature Trengo's web UI uses, without us having to maintain a Hub-side
 *  copy. Placeholders like `[agent.first_name]` are NOT substituted here -
 *  Trengo replaces them at send time, so the composer should preview them
 *  literally. */
export type TrengoEmailChannelInfo = {
  channelId: number
  title: string
  senderEmail: string | null
  senderName: string | null
  /** "[agent.first_name] | Rocket Leads" - Trengo substitutes per-agent. */
  senderNamePersonal: string | null
  /** HTML signature block. May contain Trengo placeholders. */
  signature: string | null
}

/**
 * Look up an email channel's send-side metadata (signature, sender labels)
 * by channel id. Backed by the cached `/channels` fetch - calling this on
 * every composer open is cheap.
 *
 * Returns null if the channel doesn't exist OR isn't an email channel
 * (signature lookup on a WhatsApp channel is meaningless).
 */
export async function fetchEmailChannelInfo(
  channelId: number,
): Promise<TrengoEmailChannelInfo | null> {
  const channels = await fetchTrengoChannels()
  const ch = channels.find((c) => c.id === channelId)
  if (!ch) return null
  const ec = (ch as { emailChannel?: Record<string, unknown> | null }).emailChannel
  if (!ec || typeof ec !== "object") return null
  return {
    channelId: ch.id,
    title: ch.title ?? ch.display_name ?? `Channel ${ch.id}`,
    senderEmail: typeof ec.sender_email === "string" ? ec.sender_email : null,
    senderName: typeof ec.sender_name === "string" ? ec.sender_name : null,
    senderNamePersonal:
      typeof ec.sender_name_personal === "string" ? ec.sender_name_personal : null,
    signature: typeof ec.signature === "string" ? ec.signature : null,
  }
}

/** A WhatsApp Business HSM template registered in Trengo. The fields we
 *  consume in the composer: `title` for the picker label, `message` for the
 *  preview + variable extraction (`{{1}}{{2}}…`), `language` for the send
 *  payload, `channel_id` for filtering. `components` carries header/button
 *  hints we surface as preview-only (we don't customize them). */
export type TrengoWaTemplate = {
  id: number
  title: string
  slug: string
  message: string
  channel_id: number
  language: string
  status: string
  category: string | null
  components: Array<{
    id: number
    type: string
    sub_type: string | null
    value: string | null
  }>
}

/**
 * List approved WhatsApp templates for a specific channel. Server-side
 * filtering on `status` + `channel_id` is supported by Trengo (verified via
 * web-UI sniff during Phase 0 audit); without it we'd need to walk all 25
 * pages of the workspace template pool to find the ~50-70 that match each
 * channel - too expensive even with the 5-minute cache.
 *
 * Returns the FULL filtered list (paginated server-side, but we collect all
 * pages here so the UI gets one array). Cached for 5 minutes by trengoFetch.
 */
export async function fetchWaTemplates(channelId: number): Promise<TrengoWaTemplate[]> {
  const all: TrengoWaTemplate[] = []
  let page = 1
  while (page <= MAX_PAGES) {
    const data = await trengoFetch<{
      data: TrengoWaTemplate[]
      meta?: { current_page: number; last_page: number }
    }>(`/wa_templates?status=ACCEPTED&channel_id=${channelId}&page=${page}`)
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }
  // Stable, alphabetic order so the picker isn't reshuffled on every refresh.
  return all.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Subset of a Trengo contact's fields we read for outbound destination
 * decisions. The full Trengo `Contact` returns many more fields - we type
 * only what we use so the surface area stays narrow.
 */
export type TrengoContact = {
  id: number
  name: string | null
  email: string | null
  phone: string | null
  full_name: string | null
}

/**
 * Look up a single Trengo contact by id. Used by:
 *  - Client detail dialog: display the email/phone that an outbound is
 *    going to ("recipient verification" UX) so an admin sees the actual
 *    address before pressing send.
 *  - Test-send path: resolve the test contact's phone for WhatsApp
 *    `wa_sessions` calls (the endpoint accepts a raw phone number, no
 *    ticket needed), and derive the email for email-mode bootstrapping.
 *
 * Uses the system Trengo token - contact records aren't per-agent gated.
 * Returns null on 404 so callers can render a clean "no test contact set"
 * state without a try/catch wrapper.
 */
export async function fetchTrengoContact(
  contactId: number | string,
): Promise<TrengoContact | null> {
  try {
    const data = await trengoFetch<{ data?: TrengoContact } | TrengoContact>(
      `/contacts/${contactId}`,
    )
    const obj = (data as { data?: TrengoContact }).data ?? (data as TrengoContact)
    if (!obj || typeof obj.id !== "number") return null
    return {
      id: obj.id,
      name: obj.name ?? null,
      email: obj.email ?? null,
      phone: obj.phone ?? null,
      full_name: obj.full_name ?? null,
    }
  } catch {
    return null
  }
}

/**
 * Map a raw Trengo contact to the unified ResolvedEntity. The subline
 * carries phone + email so the AM can disambiguate same-named contacts -
 * "Brian Verheij" alone is useless when a company has separate WhatsApp,
 * email, and billing contacts each named differently, which is exactly the
 * scenario Roy flagged as the Trengo blind spot.
 *
 * Returns ok status for now; once we add archive detection / last-message
 * staleness later we can flip a contact to "warning" when it hasn't seen
 * activity in months.
 */
function toResolvedTrengoContact(c: TrengoContact): ResolvedEntity {
  const subParts: string[] = []
  if (c.phone) subParts.push(c.phone)
  if (c.email) subParts.push(c.email)
  const displayName = c.full_name ?? c.name ?? c.email ?? c.phone ?? String(c.id)
  return {
    id: String(c.id),
    name: displayName,
    subline: subParts.length > 0 ? subParts.join(" · ") : undefined,
  }
}

/**
 * Search Trengo contacts by name/email/phone for the ConnectedEntity picker.
 *
 * Uses Trengo's native `/contacts?term=<query>` substring search - no
 * client-side cache needed because the workspace contact count (10k+) is
 * too large to keep in memory and Trengo's search is fast enough on
 * single round-trip. Empty query returns the first page (most-recently-
 * created) so the picker isn't blank on cold-open.
 *
 * Roy 2026-06-09: this is the hardest field to verify by ID alone because
 * companies often have several Trengo contacts (WhatsApp / email / billing
 * person) and only one of them is the "right" one for the Hub. Multi-
 * contact support (`trengo_contact_ids jsonb`) is planned as a follow-up;
 * this single-contact picker covers ~90% of cases.
 */
export async function searchTrengoContacts(
  query: string,
  limit = 10,
): Promise<ResolvedEntity[]> {
  const trimmed = query.trim()
  const cap = Math.min(Math.max(limit, 1), 25)
  const path = trimmed.length === 0 ? `/contacts` : `/contacts?term=${encodeURIComponent(trimmed)}`

  type Page = {
    data?: TrengoContact[]
  } & { [key: string]: unknown }
  // Trengo's contact list endpoint returns either `{data: […]}` or a bare
  // array depending on workspace plan / API version. Cover both shapes.
  const raw = await trengoFetch<Page | TrengoContact[]>(path)
  const contacts = Array.isArray(raw) ? raw : (raw.data ?? [])
  return contacts.slice(0, cap).map(toResolvedTrengoContact)
}

/**
 * Resolve a single Trengo contact ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger - without this, a typo'd
 * trengo_contact_id silently breaks the per-client Inbox + Timeline tabs
 * with no visible signal in the panel.
 *
 * Returns null on 404 / not-found / archived; throws on auth/transport
 * failures so the picker shows "couldn't verify" rather than "definitely
 * broken".
 */
export async function resolveTrengoContact(
  id: string,
): Promise<ResolvedEntity | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const contact = await fetchTrengoContact(trimmed)
  if (!contact) return null
  return toResolvedTrengoContact(contact)
}

/**
 * Find or create a Trengo contact for an arbitrary email address. Used by
 * the ad-hoc test-send flow: the dialog accepts a raw email at send-time
 * (no persisted "Test contact" config), and Trengo's email channel needs
 * a contact_id to post a ticket against. We try POST /v2/contacts first
 * (cheap when the email is new); on the duplicate-conflict response we
 * fall back to a search lookup.
 *
 * `channelId` should be the email channel the contact will live under -
 * Trengo scopes contacts to channels for email.
 */
export async function findOrCreateTrengoEmailContact(args: {
  userToken: string
  channelId: number
  email: string
  name?: string
}): Promise<{ id: number }> {
  const { userToken, channelId, email, name } = args

  // Search FIRST, scoped to the target channel. Trengo enforces that a
  // private (personal-channel-bound) contact cannot be paired with a
  // non-personal channel and vice versa — so the old "POST then fall
  // back to global search" strategy returned a SHARED workspace contact
  // for a personal channel, which then 422'd at create-ticket time with
  // "Je kunt een (niet)privécontact niet gebruiken voor een
  // (niet)persoonlijk kanaal" (Roy 2026-06-16 ticket). Filtering the
  // search by channel_id keeps the privacy levels aligned.
  const scopedSearch = await fetch(
    `https://app.trengo.com/api/v2/contacts?term=${encodeURIComponent(email)}&channel_id=${channelId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/json",
      },
    },
  )
  if (scopedSearch.ok) {
    const json = (await scopedSearch.json()) as {
      data?: Array<{ id?: number | string; email?: string; channel_id?: number | string }>
    }
    // Prefer an exact channel match; Trengo may ignore the filter on
    // some plans and return cross-channel hits, so we re-filter here.
    const match = json.data?.find(
      (c) =>
        c.email === email &&
        (c.channel_id == null || Number(c.channel_id) === channelId),
    )
    if (match?.id != null) return { id: Number(match.id) }
  }

  // No existing contact in the target channel — try the channel-scoped
  // POST endpoint so Trengo creates the contact with privacy matching
  // the channel (personal channel → private contact). Falls back to the
  // global endpoint if Trengo's API version on this workspace doesn't
  // expose the scoped route.
  const scopedCreate = await fetch(
    `https://app.trengo.com/api/v2/channels/${channelId}/contacts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ email, name: name ?? email }),
    },
  )
  if (scopedCreate.ok) {
    const json = (await scopedCreate.json()) as {
      id?: number | string
      data?: { id?: number | string }
    }
    const id = json.data?.id ?? json.id
    if (id != null) return { id: Number(id) }
  }

  // Final fallback: the original behaviour (global POST + global
  // search). Kept so older Trengo workspaces that don't expose the
  // scoped endpoint still bootstrap a contact — they don't have the
  // privacy-pairing constraint, so the cross-channel hit is harmless.
  const createRes = await fetch(`https://app.trengo.com/api/v2/contacts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      channel_id: channelId,
      email,
      name: name ?? email,
    }),
  })
  if (createRes.ok) {
    const json = (await createRes.json()) as {
      id?: number | string
      data?: { id?: number | string }
    }
    const id = json.data?.id ?? json.id
    if (id != null) return { id: Number(id) }
  }

  const searchRes = await fetch(
    `https://app.trengo.com/api/v2/contacts?term=${encodeURIComponent(email)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/json",
      },
    },
  )
  if (searchRes.ok) {
    const json = (await searchRes.json()) as {
      data?: Array<{ id?: number | string; email?: string }>
    }
    const match = json.data?.find((c) => c.email === email)
    if (match?.id != null) return { id: Number(match.id) }
  }

  const errText = await createRes.text().catch(() => "")
  throw new Error(
    `Couldn't find or create a Trengo contact for ${email}: ${errText.slice(0, 200)}`,
  )
}

/**
 * Update a Trengo contact's name. Used by the inbox composer's editable
 * conversation header - the AM types a real name over an "Unknown"/phone-
 * number contact and we propagate it back to Trengo so every workspace
 * surface picks it up. System token (workspace-wide write); contact updates
 * aren't per-agent attributed in Trengo.
 *
 * Trengo's documented verb for contact updates is PATCH; falls back to PUT
 * if PATCH 405's (some accounts have older API versions exposed). Throws on
 * non-2xx so callers can surface the error inline.
 */
export async function updateTrengoContactName(
  contactId: number | string,
  name: string,
): Promise<{ id: number; name: string }> {
  const token = (await getTrengoToken()).trim()
  const url = `https://app.trengo.com/api/v2/contacts/${contactId}`
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  }
  const body = JSON.stringify({ name })

  let res = await fetch(url, { method: "PATCH", headers, body })
  if (res.status === 405) {
    res = await fetch(url, { method: "PUT", headers, body })
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`Trengo contact update failed (${res.status}): ${txt.slice(0, 200)}`)
  }
  const data = (await res.json()) as { id?: number | string; name?: string; data?: { id?: number; name?: string } }
  const id = Number(data.id ?? data.data?.id ?? contactId)
  return { id, name: (data.name ?? data.data?.name ?? name) as string }
}

export async function fetchMessages(ticketId: number): Promise<TrengoMessage[]> {
  const all: TrengoMessage[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const data = await trengoFetch<MessagePage>(
      `/tickets/${ticketId}/messages?page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}

/**
 * Per-user GET against the Trengo v2 API, using the user's personal token
 * instead of the workspace one. Used by the private-channel polling cron:
 * private/personal email inboxes don't trigger the workspace webhook, so we
 * pull tickets on each user's behalf via *their* token (which has read
 * access to their own private inbox).
 *
 * No retry/backoff loop here - the cron runs on a 15-min cadence so a
 * single failed cycle just resyncs next time. Rate-limit (429) is bubbled
 * up so the cron tracker logs it as an error rather than silently
 * succeeding.
 */
async function trengoFetchAsUser<T>(path: string, userToken: string): Promise<T> {
  const url = `https://app.trengo.com/api/v2${path}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${userToken.trim()}`,
      Accept: "application/json",
    },
    cache: "no-store",
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(
      `Trengo user-token API error ${res.status} on ${path}: ${text.slice(0, 200)}`,
    )
  }
  return res.json() as Promise<T>
}

/**
 * List the first page of tickets on a channel using the user's personal
 * token. Returns tickets sorted by Trengo's default (most recent first).
 *
 * Why only page 1: the polling cron runs every 15 min - any ticket older
 * than the lookback window is already either ingested (by an earlier
 * cycle) or never going to be. One page (50 tickets default) is plenty
 * for that window for any single user.
 */
export async function fetchUserTicketsForChannel(args: {
  userToken: string
  channelId: number
}): Promise<TrengoConversation[]> {
  const { userToken, channelId } = args
  const data = await trengoFetchAsUser<TicketPage>(
    `/tickets?channel_id=${channelId}&page=1`,
    userToken,
  )
  return data.data
}

/**
 * List the first page of messages on a ticket using the user's personal
 * token. Mirrors `fetchMessages(ticketId)` but goes through the user's
 * auth so private-inbox tickets (which the workspace token can't read)
 * are accessible.
 */
export async function fetchUserTicketMessages(args: {
  userToken: string
  ticketId: number
}): Promise<TrengoMessage[]> {
  const { userToken, ticketId } = args
  const data = await trengoFetchAsUser<MessagePage>(
    `/tickets/${ticketId}/messages?page=1`,
    userToken,
  )
  return data.data
}
