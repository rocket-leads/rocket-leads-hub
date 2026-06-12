import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import {
  fetchUserTicketsForChannel,
  fetchUserTicketMessages,
  type TrengoConversation,
  type TrengoMessage,
} from "@/lib/integrations/trengo"

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

/** How far back to look at message timestamps. 4× the cron cadence (15
 *  min) so a temporarily-failed cycle doesn't permanently drop a
 *  message - the next cycle re-tries the same window. */
const LOOKBACK_MINUTES = 60

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
  authorKind: "rl_team" | "client"
  authorName: string
  createdAtSrc: string
}

function inboundFromLatestMessage(
  channelId: number,
  ticket: TrengoConversation,
  cutoffMs: number,
): EventToInsert | null {
  const latest = ticket.latest_message
  if (!latest) return null
  const createdMs = new Date(latest.created_at).getTime()
  if (!Number.isFinite(createdMs) || createdMs < cutoffMs) return null
  const body = (latest.message ?? "").trim()
  if (!body) return null

  const contact = ticket.contact
  const contactId = String(contact?.id ?? "")
  if (!contactId) return null

  // Trengo's latest_message doesn't carry author_type. Use the contact
  // name as the inbound author - cron only ingests INBOUND-shaped rows
  // anyway since outbound replies originate from the Hub composer itself
  // and already write to inbox_events via the existing send path.
  const contactName = contact?.name ?? null
  return {
    sourceMsgId: `trengo:msg:${latest.id}`,
    channelId,
    ticketId: ticket.id,
    contactId,
    contactName,
    body,
    authorKind: "client",
    authorName: contactName ?? "Unknown",
    createdAtSrc: latest.created_at,
  }
}

function eventsFromMessageList(
  channelId: number,
  ticket: TrengoConversation,
  messages: TrengoMessage[],
  cutoffMs: number,
): EventToInsert[] {
  const out: EventToInsert[] = []
  for (const m of messages) {
    const createdMs = new Date(m.created_at).getTime()
    if (!Number.isFinite(createdMs) || createdMs < cutoffMs) continue
    const body = (m.body ?? "").trim()
    if (!body) continue
    const contact = ticket.contact
    const contactId = String(contact?.id ?? "")
    if (!contactId) continue
    const authorKind: "rl_team" | "client" = m.author_type === "Contact" ? "client" : "rl_team"
    out.push({
      sourceMsgId: `trengo:msg:${m.id}`,
      channelId,
      ticketId: ticket.id,
      contactId,
      contactName: contact?.name ?? null,
      body,
      authorKind,
      authorName: m.author?.name ?? contact?.name ?? "Unknown",
      createdAtSrc: m.created_at,
    })
  }
  return out
}

async function findExistingMsgIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  sourceMsgIds: string[],
): Promise<Set<string>> {
  if (sourceMsgIds.length === 0) return new Set()
  const { data } = await supabase
    .from("inbox_events")
    .select("source_msg_id")
    .eq("source", "trengo")
    .in("source_msg_id", sourceMsgIds)
  return new Set((data ?? []).map((r) => r.source_msg_id as string))
}

async function insertEvents(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  systemAuthorId: string,
  events: EventToInsert[],
): Promise<number> {
  if (events.length === 0) return 0

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
    return {
      kind: "chat" as const,
      client_id: clientByContact.get(e.contactId)?.monday_item_id ?? "",
      author_id: systemAuthorId,
      assignee_id: systemAuthorId,
      title: titlePreview || `Message from ${e.authorName}`,
      body: bodyFull,
      status: e.authorKind === "client" ? "unread" : "read",
      source: "trengo",
      source_thread: `trengo:ticket:${e.ticketId}`,
      source_msg_id: e.sourceMsgId,
      thread_key: `trengo:contact:${e.contactId}`,
      scope: "external",
      author_kind: e.authorKind,
      author_external: e.authorKind === "client" ? e.contactId : "",
      author_name_cached: e.authorName,
      classify_method: "polling_backfill",
      created_at_src: e.createdAtSrc,
      trengo_channel_id: e.channelId,
    }
  })

  const { error } = await supabase.from("inbox_events").insert(rows)
  if (error) {
    console.error("[pull-trengo-private-channels] insert failed:", error.message)
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
  const cutoffMs = startedAt - LOOKBACK_MINUTES * 60 * 1000

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

    const users = await loadUsersToScan(supabase)
    let totalChannelsScanned = 0
    let totalTicketsSeen = 0
    let totalEventsInserted = 0
    const perUserErrors: Array<{ userId: string; email: string; error: string }> = []

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

          // First pass: collect just the latest_message-derived rows for
          // tickets that updated in the lookback window.
          const candidates: EventToInsert[] = []
          for (const ticket of tickets) {
            const single = inboundFromLatestMessage(channelId, ticket, cutoffMs)
            if (single) candidates.push(single)
          }

          // Dedupe by source_msg_id - the webhook may have inserted these
          // for shared channels; private channels will pass through fresh.
          const existing = await findExistingMsgIds(
            supabase,
            candidates.map((c) => c.sourceMsgId),
          )
          const fresh = candidates.filter((c) => !existing.has(c.sourceMsgId))

          // Per-ticket follow-up: pull the full message list only when the
          // latest-message ingest told us this ticket is in scope AND the
          // ticket is genuinely fresh (not deduped). Keeps the API budget
          // bounded - max one /messages call per *new* ticket per cycle.
          const expanded: EventToInsert[] = []
          for (const freshEvent of fresh) {
            try {
              const messages = await fetchUserTicketMessages({
                userToken: token,
                ticketId: freshEvent.ticketId,
              })
              const fromList = eventsFromMessageList(channelId, tickets.find((t) => t.id === freshEvent.ticketId)!, messages, cutoffMs)
              if (fromList.length > 0) {
                expanded.push(...fromList)
              } else {
                expanded.push(freshEvent)
              }
            } catch (e) {
              // Fall back to the latest_message row if the per-ticket
              // expand fails - better than dropping the conversation.
              console.error(
                `[pull-trengo-private-channels] /messages failed for ticket ${freshEvent.ticketId}:`,
                e instanceof Error ? e.message : e,
              )
              expanded.push(freshEvent)
            }
          }

          // Final dedupe against existing rows after the per-ticket
          // expand may have surfaced extra message ids.
          const existing2 = await findExistingMsgIds(
            supabase,
            expanded.map((c) => c.sourceMsgId),
          )
          const toInsert = expanded.filter((c) => !existing2.has(c.sourceMsgId))
          const inserted = await insertEvents(supabase, hq.id, toInsert)
          totalEventsInserted += inserted
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
      eventsInserted: totalEventsInserted,
      perUserErrorCount: perUserErrors.length,
      lookbackMinutes: LOOKBACK_MINUTES,
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

    return NextResponse.json({ ok: true, ...metrics })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pull-trengo-private-channels failed" },
      { status: 500 },
    )
  }
}
