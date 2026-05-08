import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchTicket } from "@/lib/integrations/trengo"

/**
 * Outbound reply path — sends a Hub reply back to the source platform AS the
 * logged-in Hub user, never as a generic system bot. Uses the user's stored
 * platform token from `user_platform_tokens` (set up via /account in C.3).
 *
 * If the user hasn't connected the relevant platform yet, throws a typed
 * "needs_connect" error so callers can surface "Connect your Slack first" in
 * the UI rather than a confusing API failure.
 *
 * Successful sends also write the outbound message back into inbox_events so
 * the chat thread in the Hub stays a complete history — both received and
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

type InboxEventRow = {
  id: string
  source: "manual" | "automation" | "trengo" | "slack" | "monday" | "watchlist" | "meeting"
  source_thread: string | null
  source_msg_id: string | null
  thread_key: string | null
  scope: "external" | "internal" | null
  client_id: string
  /** Trengo channel id of the original event — propagated to the outbound
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

async function sendTrengoReplyAsUser(
  userId: string,
  ticketId: string,
  message: string,
  internalNote: boolean,
): Promise<{ message_id: string }> {
  const token = await getUserPlatformToken(userId, "trengo")
  if (!token) throw new NeedsConnectError("trengo")

  const res = await fetch(`https://app.trengo.com/api/v2/tickets/${ticketId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ message, internal_note: internalNote }),
  })

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
      `Trengo send returned no message id — keys: ${Object.keys(json).join(",")}`,
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
 * supports Trengo and Slack — Monday "updates" are CRM-side notes, not chat
 * messages, and we don't surface a reply affordance for them.
 *
 * `internalNote=true` posts as a Trengo team-only annotation rather than a
 * customer-visible message — used by the Comment tab in the chat composer
 * so AM and CM can chat about the client inline in the same thread without
 * the client ever seeing it. Slack has no equivalent (no team-only sub-thread
 * mode for DMs/channels), so internal notes there fall back to a Hub-only
 * mirror (no outbound Slack post).
 */
export async function replyToInboxEvent(
  userId: string,
  eventId: string,
  message: string,
  options: { internalNote?: boolean; mentionedUserIds?: string[] } = {},
): Promise<ReplyResult> {
  const trimmed = message.trim()
  if (!trimmed) throw new Error("Empty reply")

  const internalNote = options.internalNote === true

  const event = await loadEvent(eventId)
  if (!event) throw new Error("Event not found")

  if (event.source === "monday") {
    throw new Error("Monday updates aren't replyable from the Hub")
  }
  if (event.source !== "trengo" && event.source !== "slack") {
    throw new Error(`Reply not supported for source: ${event.source}`)
  }
  // Slack doesn't have a team-only annotation; reject internal notes there
  // so the caller sees a clear error rather than a silent customer-visible
  // post. Once Phase E (Hub-native team chat) ships, this branch goes away.
  if (event.source === "slack" && internalNote) {
    throw new Error("Internal notes aren't supported on Slack threads yet")
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

  // Captured from Trengo post-send when applicable, so the outbound mirror
  // row reflects the assignee Trengo auto-applied to the ticket once a
  // teammate replied. Without this, Hub-originated replies leave the row
  // unassigned, which means the thread stays in the Hub's "unassigned-only"
  // inbox even though the user just claimed it.
  let trengoAssigneeUserId: number | null = null

  if (event.source === "trengo") {
    // source_thread is `trengo:ticket:<id>`
    const ticketId = (event.source_thread ?? "").replace(/^trengo:ticket:/, "")
    if (!ticketId) throw new Error("Missing Trengo ticket id on event")
    const r = await sendTrengoReplyAsUser(userId, ticketId, trimmed, internalNote)
    outboundId = r.message_id
    sourceMsgId = `trengo:msg:${outboundId}`
    // Re-read the ticket so the mirror row carries the now-current assignee.
    // Best-effort: failure here doesn't block the user — they sent the reply
    // already, and the next webhook will fix the value if the API is flaky.
    try {
      const ticket = await fetchTicket(ticketId)
      trengoAssigneeUserId = ticket?.assignee?.id ?? null
    } catch (e) {
      console.warn("[reply] post-send fetchTicket failed", e)
    }
  } else {
    // Slack — source_thread is either `slack:thread:<channel>:<thread_ts>` or
    // `slack:channel:<channel>`. Channel ID is also the second segment of
    // thread_key for DMs (slack:dm:<user_id> doesn't carry channel, so we
    // pull it from the source_msg_id parts: slack:msg:<channel>:<ts>).
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
  // the Hub stays a complete picture.
  const titlePreview = trimmed.length > 100 ? trimmed.slice(0, 100) + "…" : trimmed
  const bodyFull = trimmed.length > 100 ? trimmed : null

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: "chat",
      client_id: event.client_id,
      author_id: userId,
      assignee_id: userId,
      title: titlePreview,
      body: bodyFull,
      status: "read", // user just sent it — already read for them
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
      is_internal: internalNote,
      // Propagate the original event's channel id so the outbound row passes
      // the per-user channel-subscription filter (Trengo only — Slack uses
      // different routing and channel_id stays null for it).
      trengo_channel_id: event.source === "trengo" ? event.trengo_channel_id : null,
      trengo_assignee_user_id: trengoAssigneeUserId,
    })
    .select("id")
    .single()

  if (error || !inserted) {
    // The outbound send already succeeded — surface the storage error but
    // don't let it look like the reply itself failed.
    console.error("Reply mirror insert failed:", error)
    throw new Error("Reply sent, but failed to store in Hub history")
  }

  // @-mention fan-out (internal notes only). For each colleague tagged in the
  // composer, we drop a `kind=update` row on their inbox so the mention
  // surfaces in their Updates tab + sidebar badge + push notification (the
  // existing inbox_events insert trigger handles push). Note rows live on the
  // chat substrate (thread_key set), but mention updates intentionally do
  // NOT — they're standalone notifications that point back at the source.
  if (internalNote && options.mentionedUserIds?.length) {
    const uniqueIds = Array.from(new Set(options.mentionedUserIds)).filter(
      (id) => id !== userId, // never mention yourself
    )
    if (uniqueIds.length > 0) {
      // Validate that the IDs actually exist as Hub users (don't trust the
      // client) and resolve a client name for the title.
      const [{ data: validUsers }, { data: clientForTitle }] = await Promise.all([
        supabase.from("users").select("id").in("id", uniqueIds),
        event.client_id
          ? supabase
              .from("clients")
              .select("name")
              .eq("monday_item_id", event.client_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      const allowedIds = (validUsers ?? []).map((u) => (u as { id: string }).id)
      if (allowedIds.length > 0) {
        const authorName = hubUser.name ?? hubUser.email
        const clientName = (clientForTitle as { name?: string } | null)?.name ?? null
        const titleSuffix = clientName ? ` op ${clientName}` : ""
        const previewBody = trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed

        const mentionRows = allowedIds.map((mentionedId) => ({
          kind: "update" as const,
          client_id: event.client_id,
          author_id: userId,
          assignee_id: mentionedId,
          title: `${authorName} noemde je in een note${titleSuffix}`,
          body: previewBody,
          status: "unread",
          source: "manual" as const,
          // Point back at the original event so the recipient can navigate
          // there from their update — the existing detail dialog + chat pane
          // can hydrate from this id.
          source_ref: {
            mention: true,
            note_event_id: inserted.id,
            thread_key: event.thread_key,
          },
          author_name_cached: authorName,
          classify_method: "manual",
        }))

        const { error: mentionErr } = await supabase
          .from("inbox_events")
          .insert(mentionRows)
        if (mentionErr) {
          // Non-fatal — the note itself already saved. Log and move on.
          console.warn("[reply] @-mention fan-out failed", mentionErr)
        }
      }
    }
  }

  return {
    source: event.source,
    outboundMsgId: outboundId,
    inboxEventId: inserted.id,
  }
}
