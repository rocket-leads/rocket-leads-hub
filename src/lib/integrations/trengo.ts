import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

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
  /** Trengo's `name` field is null for many WhatsApp/Email channels — the
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
  latest_message: { id: number; message: string; type: string; created_at: string } | null
  created_at: string
  closed_at: string | null
  assignee: { name: string } | null
}

export type TrengoMessage = {
  id: number
  body: string
  author_type: "User" | "Contact" | string
  author: { id: number; name: string } | null
  created_at: string
  type: string
  attachments: Array<{ name: string; url: string }> | null
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

/**
 * Return the workspace's first Trengo email channel. Used to bootstrap a
 * new outbound email ticket when the contact has no existing email
 * thread — Dr. Ludidi etc. who's email-primary on Monday but has never
 * been emailed through Trengo before.
 *
 * Returns null when no email channel exists in this workspace.
 *
 * Prefer `findAmEmailChannel(amUserId)` for client-update sends — that
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
 * yet — caller surfaces a clear "configure your outbound channel"
 * error instead of silently falling back to the workspace catch-all
 * (the Roel-vs-`rocket-lea-mail.*@trengomail.com` bug).
 *
 * Note: this used to intersect `trengo_channel_ids` (the VISIBILITY
 * set) with workspace email channels. That overloaded one column for
 * two unrelated concepts — fixed by adding `primary_email_channel_id`
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
 * `findAmEmailChannel` — reads `users.primary_wa_channel_id` and looks
 * up the workspace channel. Returns null when unset (current send paths
 * fall back to the existing-ticket channel anyway, since WhatsApp has
 * no bootstrap flow — kept here for future use).
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
 * returns 405 — that route is read-only. Standard REST flow:
 *   1. `POST /api/v2/tickets`     → create ticket (channel + contact + subject)
 *   2. `POST /api/v2/tickets/{id}/messages` → send body into new ticket
 *
 * If either step fails, the thrown error includes the step + Trengo's
 * response so the dialog's red banner is self-debuggable.
 */
export async function createEmailMessageForContact(args: {
  userToken: string
  contactId: string
  channelId: number
  subject: string
  body: string
}): Promise<{ ticketId: string; messageId: string }> {
  // Step 1 — create the ticket.
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
      `Trengo create-ticket returned no id — keys: ${Object.keys(createJson).join(",")}`,
    )
  }

  // Step 2 — send the message into the new ticket. Mirrors the regular
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
      `Trengo email-send returned no id — keys: ${Object.keys(sendJson).join(",")}`,
    )
  }
  return { ticketId: String(ticketId), messageId: String(messageId) }
}

/**
 * List all channels in the Trengo workspace. Used by the per-user channel
 * subscription picker on /account so users can pick which Trengo channels
 * (Email, WhatsApp, Voice, etc.) surface in their Hub Client Inbox.
 *
 * Uses the system Trengo token — channel listings are workspace-wide metadata,
 * not tied to a specific agent. Cheap and cached for 5 minutes by trengoFetch.
 */
export async function fetchTrengoChannels(): Promise<TrengoChannel[]> {
  const data = await trengoFetch<{ data: TrengoChannel[] }>(`/channels`)
  return [...data.data].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

/** Email-specific channel metadata exposed by `GET /channels`. We surface
 *  the signature + sender info to the email composer so the AM gets the same
 *  signature Trengo's web UI uses, without us having to maintain a Hub-side
 *  copy. Placeholders like `[agent.first_name]` are NOT substituted here —
 *  Trengo replaces them at send time, so the composer should preview them
 *  literally. */
export type TrengoEmailChannelInfo = {
  channelId: number
  title: string
  senderEmail: string | null
  senderName: string | null
  /** "[agent.first_name] | Rocket Leads" — Trengo substitutes per-agent. */
  senderNamePersonal: string | null
  /** HTML signature block. May contain Trengo placeholders. */
  signature: string | null
}

/**
 * Look up an email channel's send-side metadata (signature, sender labels)
 * by channel id. Backed by the cached `/channels` fetch — calling this on
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
 * channel — too expensive even with the 5-minute cache.
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
 * Update a Trengo contact's name. Used by the inbox composer's editable
 * conversation header — the AM types a real name over an "Unknown"/phone-
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
