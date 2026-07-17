import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { getTrengoChannelLookup } from "@/lib/inbox/fetchers"
import { stripHtml } from "@/lib/html"
import {
  fetchUserTicketsForChannel,
  fetchUserTicketMessages,
  type TrengoConversation,
  type TrengoMessage,
} from "@/lib/integrations/trengo"
import {
  getTrengoMentionContext,
  rewriteMentionHandles,
  resolveMentionedHubIds,
  type TrengoMentionContext,
} from "@/lib/inbox/trengo-mentions"

/**
 * Per-user polling backfill for Trengo private/personal inboxes.
 *
 * Background (Roy 2026-06-12): Trengo's workspace-level INBOUND webhook
 * doesn't fire for tickets routed to private/personal email channels -
 * confirmed empirically (Roy Personal had 28 unread tickets in Trengo
 * while the Hub's `inbox_events` had 0 for that channel id). We can't
 * change Trengo's webhook behaviour, but each user can hand the Hub
 * their personal API token, which DOES grant read access to their own
 * private inbox.
 *
 * This cron walks every Hub user who has both (a) a personal Trengo
 * token connected in /account, and (b) at least one channel subscribed
 * via /account → Inbox subscriptions. For each subscribed channel we
 * pull the first page of recent tickets with the user's token, peek at
 * `latest_message`, and upsert it into `inbox_events` using the same
 * dedupe key the webhook uses (`source_msg_id = trengo:msg:<id>`). When
 * the webhook later starts firing for that channel (or already does for
 * shared channels), the dedupe means we don't double-insert.
 *
 * Trade-offs made:
 *   - We only ingest `latest_message` per ticket (one inbox row per
 *     ticket per cycle). For threads with multiple new messages between
 *     runs we'll miss the interim ones in the inbox list - but the
 *     conversation view re-fetches messages directly from Trengo on
 *     open, so nothing is permanently lost.
 *   - 60-minute lookback window. The cron runs every 15 min; 60 min
 *     covers occasional misses without re-fetching ancient history.
 *   - All subscribed channels are polled (not just "silent" ones). The
 *     dedupe handles the overlap with the webhook for shared channels,
 *     and the extra API calls are cheap.
 *   - Errors per user are caught + logged; one bad token doesn't kill
 *     the whole run.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

/** How far back to look at message timestamps. The cron now runs EVERY MINUTE
 *  (Roy 2026-07-17: private-channel WhatsApp/email must arrive near-real-time -
 *  Trengo's INBOUND webhook doesn't fire for private channels, so this poll is
 *  the only path). A 20-min window still absorbs ~20 missed cycles (Vercel
 *  hiccup, 429 backoff) while keeping the per-run message re-fetch bounded so
 *  minute-cadence polling doesn't hammer Trengo's rate limit. Use `?since=` for
 *  a wider one-shot catch-up. */
const LOOKBACK_MINUTES = 20

type UserToScan = {
  id: string
  email: string
  channelIds: number[]
}

async function loadUsersToScan(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<UserToScan[]> {
  const { data: rows } = await supabase
    .from("users")
    .select("id, email, trengo_channel_ids")
    .not("trengo_channel_ids", "is", null)

  const candidates = (rows ?? [])
    .map((r) => ({
      id: r.id as string,
      email: r.email as string,
      channelIds: (Array.isArray(r.trengo_channel_ids) ? r.trengo_channel_ids : []) as number[],
    }))
    .filter((u) => u.channelIds.length > 0)

  // Only users who've actually connected a personal Trengo token can poll
  // their own private inbox. Filter sequentially so we don't hammer the
  // supabase pool with parallel lookups on a possibly-large user list.
  const { data: tokenRows } = await supabase
    .from("user_platform_tokens")
    .select("user_id")
    .eq("platform", "trengo")
  const tokenUsers = new Set((tokenRows ?? []).map((r) => r.user_id as string))

  return candidates.filter((u) => tokenUsers.has(u.id))
}

/** A single ingest decision for one Trengo message. Built from a ticket's
 *  `latest_message` (or from a per-ticket /messages fetch) so the cron
 *  body can dedupe + insert in batch shape. */
type EventToInsert = {
  sourceMsgId: string
  channelId: number
  ticketId: number
  contactId: string
  contactName: string | null
  body: string
  /** Original HTML body, preserved for email messages so the chat pane
   *  can render the mail with formatting/images instead of the stripped
   *  plain text. Null for WhatsApp/Slack where the source is already
   *  plain text. */
  bodyHtml: string | null
  /** Email subject line, captured from `email_message.subject` on the
   *  Trengo /messages response. Drives the prominent subject header in
   *  EmailMessageCard. Null for WhatsApp/Slack. */
  emailSubject: string | null
  /** Sender's email address (envelope From), so the chat pane can show
   *  `noreply@vueling.com` next to the display name and the AM can spot
   *  phishing at a glance. Null for non-email rows. */
  emailFrom: string | null
  authorKind: "rl_team" | "client"
  /** True for Trengo internal notes (NOTE / INTERNAL_* types) - @mentions to
   *  teammates and externally-posted [AI Summary] blocks. Rendered as internal
   *  notes (yellow) and excluded from the client-facing conversation metrics. */
  isInternal: boolean
  authorName: string
  createdAtSrc: string
  /** Hub user ids @-mentioned in this note (resolved from Trengo's structured
   *  mentions / inline handles). Drives the mention fan-out so the tagged
   *  teammate sees it in their Mentioned inbox. Empty for non-notes. */
  mentionedHubUserIds: string[]
}

/** Trengo's parseable timestamp format is "YYYY-MM-DD HH:mm:ss" in UTC.
 *  Native Date parsing handles ISO but not the space-separated form on
 *  all engines, so we coerce explicitly. */
function parseTrengoTimestamp(s: string | null): number | null {
  if (!s) return null
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z"
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** True when the ticket has had message activity inside the lookback
 *  window per Trengo's `latest_message_at` / `latest_received_message_at`
 *  bookkeeping. We prefer the inbound timestamp (we ingest inbound rows)
 *  but fall back to the any-direction one so tickets with only outbound
 *  activity still surface for de-duped inserts. */
function ticketIsFresh(ticket: TrengoConversation, cutoffMs: number): boolean {
  const received = parseTrengoTimestamp(ticket.latest_received_message_at)
  if (received != null && received >= cutoffMs) return true
  const anyDirection = parseTrengoTimestamp(ticket.latest_message_at)
  if (anyDirection != null && anyDirection >= cutoffMs) return true
  return false
}

/** The authoritative channel for a ticket = the channel a webhook row already
 *  stored for it (webhook rows carry classify_method='ai'). Returns null when
 *  no webhook row exists yet (genuinely silent channel), so the caller falls
 *  back to the fetched channel. */
async function lookupTicketWebhookChannel(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  ticketId: number,
): Promise<number | null> {
  const { data } = await supabase
    .from("inbox_events")
    .select("trengo_channel_id")
    .eq("source_thread", `trengo:ticket:${ticketId}`)
    .eq("classify_method", "ai")
    .not("trengo_channel_id", "is", null)
    .limit(1)
    .maybeSingle<{ trengo_channel_id: number | null }>()
  return data?.trengo_channel_id ?? null
}

function eventsFromMessageList(
  realChannelId: number,
  ticket: TrengoConversation,
  messages: TrengoMessage[],
  cutoffMs: number,
  ctx: TrengoMentionContext,
): EventToInsert[] {
  const out: EventToInsert[] = []
  // `realChannelId` is resolved by the caller as the ticket's OWN channel
  // (never the polled channelId). Roy 2026-07-16: strict per-channel — a
  // ticket must always live under its true line, so email tickets that leak
  // into a WhatsApp-channel poll (Trengo's `?channel_id=` filter returns a
  // personal token's tickets across ALL channels) are never stamped with the
  // WhatsApp channel. That mis-stamping filed hundreds of monday-notification
  // and other emails under "Danny WhatsApp" / "Roy Vosters" WA channels.
  for (const m of messages) {
    // Same timestamp normalization as the ticket-level check - Trengo's
    // "YYYY-MM-DD HH:mm:ss" doesn't parse uniformly without coercing
    // to ISO+Z first.
    const createdMs = parseTrengoTimestamp(m.created_at)
    if (createdMs == null || createdMs < cutoffMs) continue
    // Trengo's /messages endpoint returns the text in `message` for
    // some plans and `body` for others. Prefer `message` (current API)
    // but accept `body` so we don't drop legacy-shaped rows.
    const raw = (m.message ?? m.body ?? "").trim()
    if (!raw) continue
    // Strip HTML at ingest so the body lands as readable text - email
    // tickets carry raw HTML in `message`/`body` (signature blocks,
    // marketing wrappers, the works) and the chat bubble's
    // whitespace-pre-wrap rendering otherwise dumps "<p><span ...>"
    // literally. The webhook already strips at write time (since
    // 2026-05-05); polling cron now matches.
    let body = stripHtml(raw).trim()
    if (!body) continue
    const contact = ticket.contact
    const contactId = String(contact?.id ?? "")
    if (!contactId) continue
    // Direction comes from Trengo's `type` field (INBOUND / OUTBOUND /
    // NOTE / INTERNAL_*) which is reliable across plans. `author_type`
    // is a secondary signal - emails frequently arrive with it null,
    // which used to flip every inbound mail to "rl_team" → purple bubble
    // (Roy 2026-06-12 screenshot: Saxo email appeared as if sent BY us).
    const messageType = (m.type ?? "").toUpperCase()
    const inboundType =
      messageType === "INBOUND" || messageType === "INBOUND_MESSAGE"
    const outboundType =
      messageType.startsWith("OUTBOUND") || messageType.startsWith("NOTE") || messageType.includes("INTERNAL")
    // Internal notes (@mentions, [AI Summary] posts) - not client conversation.
    const isInternal = messageType.startsWith("NOTE") || messageType.includes("INTERNAL")
    const authorKind: "rl_team" | "client" = inboundType
      ? "client"
      : outboundType
        ? "rl_team"
        : m.author_type === "Contact"
          ? "client"
          : "rl_team"
    // Preserve original HTML when the payload looks HTML-ish so the
    // chat pane can render a real email layout. Trengo sometimes ships
    // a richer HTML version in `email_message.html` (with images, the
    // signature block, the works) than what the top-level `message`
    // field carries — prefer that when present. Heuristic: any `<` in
    // either source suggests markup; plain-text WhatsApp/Slack stays
    // null so the renderer falls back to the plain-text bubble.
    const emailHtml = m.email_message?.html?.trim() ?? null
    const bodyHtml = emailHtml && emailHtml.includes("<")
      ? emailHtml
      : raw.includes("<") ? raw : null
    const emailSubject = m.email_message?.subject?.trim() || null
    const emailFrom = m.email_message?.from?.trim() || null
    // Author name resolution depends on direction:
    //   - INBOUND (client): the sender is the contact, even when
    //     Trengo's `author` field points at the assigned agent. Without
    //     this, the chat row showed "Roy Vosters" for emails from
    //     external senders like La Plage Casanis (Roy 2026-06-13).
    //   - OUTBOUND / NOTE (rl_team): the sender is the agent. Trengo puts
    //     the real author in `m.agent` / `m.user_id` — `m.author` is null on
    //     notes, which used to fall through to the contact name ("TikTok
    //     Finance Team" instead of "Mike Sauer"). Roy 2026-07-16.
    // Bot/automation notes (Trengo AI Summary + AI Notes) carry no agent /
    // user_id. They must NOT be attributed to the contact (Roy 2026-07-16: an
    // [AI Summary] note showed "esther koelewijn | misi" + her avatar as if she
    // wrote it). Trengo renders these as a system "T" author — mirror that with
    // a system label so the yellow note reads as automated, not customer-said.
    const isBotNote = isInternal && m.user_id == null && !m.agent
    const botLabel = /^\s*\[?\s*ai\s+summary/i.test(body)
      ? "AI Summary"
      : /^\s*\[?\s*ai\s+note/i.test(body)
        ? "AI Note"
        : "Trengo"
    const teamAuthorName =
      m.agent?.name ??
      (m.user_id != null ? ctx.trengoById.get(m.user_id)?.name : undefined) ??
      m.author?.name ??
      (isBotNote ? botLabel : contact?.name) ??
      "Unknown"
    const authorName =
      authorKind === "client"
        ? contact?.name ?? m.author?.name ?? "Unknown"
        : isBotNote
          ? botLabel
          : teamAuthorName
    // Internal note @-mentions: resolve the tagged Hub users (structured
    // `mentions` array first, inline `@handle` fallback), and rewrite the
    // stored body's `@<first><id>` handles to `@Full Name` so it reads
    // naturally and the Hub's mention colouring lights it up.
    let mentionedHubUserIds: string[] = []
    if (isInternal) {
      mentionedHubUserIds = resolveMentionedHubIds(ctx, {
        structuredMentionUserIds: (m.mentions ?? []).map((x) => x.user_id),
        body: raw,
        authorTrengoUserId: m.user_id ?? null,
      })
      body = rewriteMentionHandles(body, ctx.trengoById)
    }
    out.push({
      sourceMsgId: `trengo:msg:${m.id}`,
      channelId: realChannelId,
      ticketId: ticket.id,
      contactId,
      contactName: contact?.name ?? null,
      body,
      bodyHtml,
      emailSubject,
      emailFrom,
      authorKind,
      isInternal,
      authorName,
      createdAtSrc: m.created_at,
      mentionedHubUserIds,
    })
  }
  return out
}

/** Per-existing-row state used by the upsert path. */
type ExistingRowState = {
  /** Webhook-origin row (carries a non-null `raw` payload). Webhook
   *  rows are authoritative - the cron should leave them alone. */
  isWebhook: boolean
  /** Current status in the DB. Polling-cron upserts must preserve a
   *  user's explicit `mark_read` action: when the user closed the
   *  ticket via the green ✓ the row is `status='read'`. Without this
   *  check the next cron cycle would flip it back to `unread` (every
   *  inbound mail derives to `unread` from authorKind), undoing the
   *  user's gesture. Roy 2026-06-12. */
  status: string
  /** authorKind currently stored for this row. Compared against the
   *  freshly-derived value to detect bug-ridden rows: if the existing
   *  authorKind disagrees with what we now derive, the row was ingested
   *  with the old broken heuristic (every inbound mail was tagged
   *  `rl_team`) and its `status='read'` is a side-effect of that bug,
   *  NOT a user gesture. Reset to derived status. */
  authorKind: string | null
  /** author_id currently on the row. A Hub-sent outbound (internal note /
   *  reply) mirror carries the real Hub user id here; the polling cron stamps
   *  the shared system id. Lets us leave Hub-authored rows untouched so the
   *  re-ingest never clobbers "Roy Vosters + avatar" with the Trengo agent
   *  name. Roy 2026-07-16. */
  authorId: string | null
}

/**
 * Look up which of the candidate source_msg_ids already exist in
 * inbox_events, together with the info the upsert path needs to make
 * the right call: webhook-origin rows are skipped entirely (their
 * `raw` payload + AI classify metadata is authoritative); polling-
 * origin rows are eligible for refresh, but their existing `status`
 * is preserved so the cron doesn't re-flip a user-marked-read ticket
 * back to unread on the next cycle.
 */
async function findExistingRows(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  sourceMsgIds: string[],
): Promise<Map<string, ExistingRowState>> {
  const out = new Map<string, ExistingRowState>()
  if (sourceMsgIds.length === 0) return out
  const { data } = await supabase
    .from("inbox_events")
    .select("source_msg_id, raw, status, author_kind, author_id")
    .eq("source", "trengo")
    .in("source_msg_id", sourceMsgIds)
  for (const r of data ?? []) {
    out.set(r.source_msg_id as string, {
      isWebhook: r.raw != null,
      status: (r.status as string) ?? "unread",
      authorKind: (r.author_kind as string | null) ?? null,
      authorId: (r.author_id as string | null) ?? null,
    })
  }
  return out
}

type InsertResult = { inserted: number; lastError: string | null }

async function insertEvents(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  systemAuthorId: string,
  events: EventToInsert[],
  existing: Map<string, ExistingRowState>,
): Promise<InsertResult> {
  if (events.length === 0) return { inserted: 0, lastError: null }

  // Look up linked clients for the contact ids in this batch. Same shape
  // the webhook uses - so listChatThreads etc. group these rows under
  // the right client when one exists.
  const contactIds = Array.from(new Set(events.map((e) => e.contactId)))
  const clientByContact = new Map<string, { monday_item_id: string }>()
  for (const contactId of contactIds) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("monday_item_id")
      .contains("trengo_contact_ids", [contactId])
      .maybeSingle()
    if (clientRow) clientByContact.set(contactId, clientRow as { monday_item_id: string })
  }

  const rows = events.map((e) => {
    const titlePreview = e.body.length > 100 ? e.body.slice(0, 100) + "…" : e.body
    const bodyFull = e.body.length > 100 ? e.body : null
    // Status policy:
    //   - new row: derive from authorKind (inbound from client -> unread)
    //   - existing polling row, correctly attributed, user marked read:
    //     keep 'read' so the cron doesn't undo the user's gesture
    //   - existing polling row whose authorKind we are CORRECTING (was
    //     'rl_team' under the old bug, now 'client'): the stored
    //     status='read' is a bug-relict, not a user gesture. Reset to
    //     derived so emails the user never saw as unread surface in
    //     the Unread filter.
    //   - existing polling row still unread: derive as normal.
    const existingState = existing.get(e.sourceMsgId)
    const derivedStatus = e.authorKind === "client" ? "unread" : "read"
    const authorKindMatches =
      !existingState || existingState.authorKind === e.authorKind
    const status =
      existingState &&
      existingState.status === "read" &&
      authorKindMatches
        ? "read"
        : derivedStatus
    return {
      kind: "chat" as const,
      client_id: clientByContact.get(e.contactId)?.monday_item_id ?? "",
      author_id: systemAuthorId,
      assignee_id: systemAuthorId,
      title: titlePreview || `Message from ${e.authorName}`,
      body: bodyFull,
      body_html: e.bodyHtml,
      email_subject: e.emailSubject,
      email_from: e.emailFrom,
      status,
      source: "trengo",
      source_thread: `trengo:ticket:${e.ticketId}`,
      source_msg_id: e.sourceMsgId,
      thread_key: `trengo:contact:${e.contactId}`,
      scope: "external",
      author_kind: e.authorKind,
      author_external: e.authorKind === "client" ? e.contactId : "",
      author_name_cached: e.authorName,
      // Allowed values per migration 20240017's CHECK constraint are
      // 'ai' | 'manual' | NULL. Polling-cron ingest isn't AI-classified
      // (we don't infer kind, we just mirror the row) so use 'manual'.
      classify_method: "manual",
      created_at_src: e.createdAtSrc,
      trengo_channel_id: e.channelId,
      is_internal: e.isInternal,
    }
  })

  // Upsert on (source, source_msg_id) so a re-run refreshes any rows
  // ingested earlier with stale fields (early polling-cron runs had a
  // bad author-kind heuristic + un-stripped HTML body, see the row
  // shaping above). The unique index in migration 20240017 is exactly
  // (source, source_msg_id) which is what supabase-js needs to merge.
  // Per-row fallback kicks in if the batch upsert fails so one bad
  // apple doesn't sink the whole batch.
  const batchResult = await supabase
    .from("inbox_events")
    .upsert(rows, { onConflict: "source,source_msg_id" })
  if (!batchResult.error) return { inserted: rows.length, lastError: null }

  console.error(
    "[pull-trengo-private-channels] batch upsert failed, falling back to per-row:",
    batchResult.error.message,
  )

  let inserted = 0
  let lastError: string | null = batchResult.error.message
  for (const row of rows) {
    const { error } = await supabase
      .from("inbox_events")
      .upsert(row, { onConflict: "source,source_msg_id" })
    if (error) {
      lastError = error.message
      continue
    }
    inserted++
  }
  return { inserted, lastError }
}

/**
 * Fan out @-mentions from internal notes: one `kind: "update"` row per tagged
 * Hub user so the mention lands in their Mentioned inbox (source_ref carries
 * the thread key the Mentioned view keys on). Deduped across cron cycles via a
 * deterministic source_msg_id `trengo:mention:<noteMsgId>:<hubUserId>`, upserted
 * on (source, source_msg_id). Mirrors the webhook's fan-out for notes that only
 * ever arrive through the polling path (personal channels). Roy 2026-07-16.
 */
async function insertMentionUpdates(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  systemAuthorId: string,
  candidates: EventToInsert[],
  channelLookup: Map<number, { kind: string | null; name: string }>,
): Promise<number> {
  const withMentions = candidates.filter((c) => c.mentionedHubUserIds.length > 0)
  if (withMentions.length === 0) return 0

  // Resolve client per contact so the mention lands under the right client.
  const contactIds = Array.from(new Set(withMentions.map((c) => c.contactId)))
  const clientByContact = new Map<string, string>()
  for (const contactId of contactIds) {
    const { data: clientRow } = await supabase
      .from("clients")
      .select("monday_item_id")
      .contains("trengo_contact_ids", [contactId])
      .maybeSingle()
    if (clientRow) clientByContact.set(contactId, (clientRow as { monday_item_id: string }).monday_item_id)
  }

  const rows: Record<string, unknown>[] = []
  for (const c of withMentions) {
    const noteMsgId = c.sourceMsgId.replace(/^trengo:msg:/, "")
    const label = c.contactName ?? "conversation"
    const preview = c.body.length > 240 ? c.body.slice(0, 237) + "…" : c.body
    const chan = channelLookup.get(c.channelId)
    // Point the mention at the PER-CHANNEL ticket (`...|ch:<channel>`), not the
    // bare contact, so opening it lands on the exact same ticket as in the
    // channel view - identical layout, notes + messages fused. Roy 2026-07-17.
    for (const hubId of c.mentionedHubUserIds) {
      rows.push({
        kind: "update",
        client_id: clientByContact.get(c.contactId) ?? "",
        author_id: systemAuthorId,
        assignee_id: hubId,
        title: `${c.authorName} mentioned you in ${label}`,
        body: preview,
        status: "unread",
        source: "trengo",
        source_msg_id: `trengo:mention:${noteMsgId}:${hubId}`,
        source_ref: {
          trengo_mention_in_thread_key: `trengo:contact:${c.contactId}|ch:${c.channelId}`,
          trengo_mention_contact_name: c.contactName,
          trengo_mention_channel_name: chan?.name ?? null,
          trengo_mention_channel_kind: chan?.kind ?? null,
        },
        author_kind: "rl_team",
        author_name_cached: c.authorName,
        classify_method: "manual",
        created_at_src: c.createdAtSrc,
      })
    }
  }
  if (rows.length === 0) return 0
  const { error } = await supabase
    .from("inbox_events")
    .upsert(rows, { onConflict: "source,source_msg_id" })
  if (error) {
    console.error("[pull-trengo-private-channels] mention fan-out failed:", error.message)
    return 0
  }
  return rows.length
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("pull-trengo-private-channels")
  const startedAt = Date.now()

  // `?since=<hours>` widens the lookback for one-shot manual triggers
  // (initial backfill, troubleshooting a missed cycle). Default stays at
  // the 60-min window since that's all the scheduled run needs. Capped
  // at 30 days because dedupe gets quadratic-ish on huge result sets and
  // anything older than a month is irrelevant for the chat inbox.
  const sinceHoursParam = req.nextUrl.searchParams.get("since")
  const sinceHours =
    sinceHoursParam && Number.isFinite(Number(sinceHoursParam))
      ? Math.min(Math.max(Number(sinceHoursParam), 1), 24 * 30)
      : null
  const lookbackMinutes = sinceHours != null ? sinceHours * 60 : LOOKBACK_MINUTES
  const cutoffMs = startedAt - lookbackMinutes * 60 * 1000

  try {
    const supabase = await createAdminClient()

    // System author id - matches the webhook so author_id is consistent
    // across both ingest paths.
    const { data: hq } = await supabase
      .from("users")
      .select("id")
      .eq("email", "rocketleadshq@gmail.com")
      .maybeSingle()
    if (!hq?.id) {
      throw new Error("System author user (rocketleadshq@gmail.com) not found")
    }

    // Trengo user directory (id → name/avatar) + Trengo→Hub user map, built
    // once per run and reused across every note so @-mention fan-out + author
    // resolution don't re-fetch the /users list per ticket.
    const mentionCtx = await getTrengoMentionContext(supabase)
    const channelLookup = await getTrengoChannelLookup()

    const users = await loadUsersToScan(supabase)
    let totalChannelsScanned = 0
    let totalTicketsSeen = 0
    let totalEventsInserted = 0
    let totalFreshTickets = 0
    let totalCandidates = 0
    let totalDeduped = 0
    let lastInsertError: string | null = null
    const perUserErrors: Array<{ userId: string; email: string; error: string }> = []

    // ?debug=1 returns the keys + a sample of the first ticket seen so
    // we can diagnose unexpected Trengo response shapes without poking
    // around in SQL. Strictly diagnostic - leaves the database alone
    // when set.
    const debug = req.nextUrl.searchParams.get("debug") === "1"
    type DebugSample = {
      userEmail: string
      channelId: number
      ticketCount: number
      firstTicketKeys: string[]
      firstTicketSample: Record<string, unknown>
    }
    const debugSamples: DebugSample[] = []

    for (const user of users) {
      const token = await getUserPlatformToken(user.id, "trengo")
      if (!token) continue

      for (const channelId of user.channelIds) {
        totalChannelsScanned++
        try {
          const tickets = await fetchUserTicketsForChannel({
            userToken: token,
            channelId,
          })
          totalTicketsSeen += tickets.length

          if (debug && tickets.length > 0 && debugSamples.length < 6) {
            const first = tickets[0] as unknown as Record<string, unknown>
            debugSamples.push({
              userEmail: user.email,
              channelId,
              ticketCount: tickets.length,
              firstTicketKeys: Object.keys(first),
              firstTicketSample: Object.fromEntries(
                Object.entries(first).filter(
                  ([k]) =>
                    k === "id" ||
                    k === "status" ||
                    k === "subject" ||
                    k.includes("latest") ||
                    k.includes("message") ||
                    k === "created_at" ||
                    k === "updated_at",
                ),
              ),
            })
          }

          // Trengo's /tickets list endpoint returns activity timestamps
          // (`latest_message_at` / `latest_received_message_at`), not a
          // `latest_message` object. So we can't derive an event from
          // the ticket payload alone - we have to fetch /messages for
          // each ticket that moved in the lookback window. Filtering on
          // the activity stamps caps the API budget to "tickets that
          // actually changed" instead of "first page of every channel".
          const freshTickets = tickets.filter((t) => ticketIsFresh(t, cutoffMs))
          totalFreshTickets += freshTickets.length
          const candidates: EventToInsert[] = []
          for (const ticket of freshTickets) {
            try {
              const messages = await fetchUserTicketMessages({
                userToken: token,
                ticketId: ticket.id,
              })
              // Resolve the ticket's TRUE channel and NEVER fall back to the
              // polled channelId. Trengo's `?channel_id=X` filter leaks a
              // personal token's tickets across all their channels, so the
              // polled channel is not a safe guess. Priority:
              //   1) `ticket.channel.id` from the list response (present +
              //      authoritative — verified 2026-07-16 the list DOES carry it)
              //   2) an existing webhook row's channel for this ticket
              // If neither resolves, SKIP the ticket rather than mis-file it
              // under the WhatsApp line we happened to be polling. Roy
              // 2026-07-16: strict per-channel, never mix WhatsApp with email.
              const webhookCh = await lookupTicketWebhookChannel(supabase, ticket.id)
              const realChannelId = ticket.channel?.id ?? webhookCh ?? null
              if (realChannelId == null) {
                console.warn(
                  `[pull-trengo-private-channels] ticket ${ticket.id} has no resolvable channel (polled ${channelId}) - skipping to avoid mis-filing`,
                )
                await new Promise((r) => setTimeout(r, 200))
                continue
              }
              candidates.push(
                ...eventsFromMessageList(realChannelId, ticket, messages, cutoffMs, mentionCtx),
              )
            } catch (e) {
              console.error(
                `[pull-trengo-private-channels] /messages failed for ticket ${ticket.id}:`,
                e instanceof Error ? e.message : e,
              )
            }
            // Throttle: ~5 req/sec ceiling so a single-user backfill
            // (?since=168 walks ~150 fresh tickets on a busy private
            // inbox) doesn't 429 the user's Trengo token. Roy
            // 2026-06-13 still hit 429 with 100ms; bumped to 200ms.
            // Trengo's stated rate is 60/min ≈ 1/sec - 5/sec leaves
            // headroom for repeat-triggered manual backfills within
            // the same minute. Steady-state cycle (60-min lookback,
            // typically <10 fresh tickets per channel) shrugs this off.
            await new Promise((r) => setTimeout(r, 200))
          }
          totalCandidates += candidates.length

          // Dedupe by source_msg_id - the webhook may have inserted
          // these for shared channels; private channels pass through
          // fresh on first run.
          const existing = await findExistingRows(
            supabase,
            candidates.map((c) => c.sourceMsgId),
          )
          // Skip webhook-origin rows (their `raw` payload + classify_conf
          // is authoritative). Polling-origin rows + brand-new rows
          // flow through the upsert with the status-preservation rules
          // applied inside insertEvents.
          totalDeduped += Array.from(existing.values()).filter((e) => e.isWebhook).length
          const toInsert = candidates.filter((c) => {
            const ex = existing.get(c.sourceMsgId)
            if (!ex) return true
            // Webhook rows are authoritative - never re-ingest.
            if (ex.isWebhook) return false
            // Hub-sent outbound (internal note / reply) mirror carries the real
            // Hub author + name + avatar. The polling cron would re-derive the
            // author from Trengo and clobber it, so leave those rows untouched.
            // Identified by author_id pointing at a real Hub user, not the
            // shared system id the cron itself stamps. Roy 2026-07-16.
            if (ex.authorKind === "rl_team" && ex.authorId && ex.authorId !== hq.id) {
              return false
            }
            return true
          })
          const result = await insertEvents(supabase, hq.id, toInsert, existing)
          totalEventsInserted += result.inserted
          if (result.lastError) lastInsertError = result.lastError
          // Fan out @-mentions in the notes we just ingested so tagged
          // teammates see them in their Mentioned inbox. Idempotent across
          // cycles (deterministic source_msg_id). Runs on `toInsert` so it
          // skips webhook / Hub-authored rows (those fan out elsewhere).
          await insertMentionUpdates(supabase, hq.id, toInsert, channelLookup)
        } catch (e) {
          perUserErrors.push({
            userId: user.id,
            email: user.email,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    }

    const metrics = {
      users: users.length,
      channelsScanned: totalChannelsScanned,
      ticketsSeen: totalTicketsSeen,
      freshTickets: totalFreshTickets,
      candidates: totalCandidates,
      deduped: totalDeduped,
      eventsInserted: totalEventsInserted,
      lastInsertError,
      perUserErrorCount: perUserErrors.length,
      lookbackMinutes,
      durationMs: Date.now() - startedAt,
    }

    if (perUserErrors.length > 0 && perUserErrors.length === users.length) {
      await tracker.fail(
        new Error(`All ${users.length} users failed: ${perUserErrors[0]?.error}`),
        metrics,
      )
    } else if (perUserErrors.length > 0) {
      await tracker.partial(
        `${perUserErrors.length}/${users.length} users had errors`,
        metrics,
      )
    } else {
      await tracker.ok(metrics)
    }

    // Per-user error list is always returned so an admin can spot a
    // stale/revoked Trengo token without re-running with ?debug=1. We
    // strip the userId to keep the response self-contained (admin can
    // map by email already).
    return NextResponse.json({
      ok: true,
      ...metrics,
      perUserErrors: perUserErrors.map(({ email, error }) => ({ email, error })),
      ...(debug ? { debugSamples } : {}),
    })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pull-trengo-private-channels failed" },
      { status: 500 },
    )
  }
}
