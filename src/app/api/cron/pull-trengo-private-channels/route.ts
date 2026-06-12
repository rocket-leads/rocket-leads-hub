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

function eventsFromMessageList(
  channelId: number,
  ticket: TrengoConversation,
  messages: TrengoMessage[],
  cutoffMs: number,
): EventToInsert[] {
  const out: EventToInsert[] = []
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
    const body = raw
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

type InsertResult = { inserted: number; lastError: string | null }

async function insertEvents(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  systemAuthorId: string,
  events: EventToInsert[],
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
      // Allowed values per migration 20240017's CHECK constraint are
      // 'ai' | 'manual' | NULL. Polling-cron ingest isn't AI-classified
      // (we don't infer kind, we just mirror the row) so use 'manual'.
      classify_method: "manual",
      created_at_src: e.createdAtSrc,
      trengo_channel_id: e.channelId,
    }
  })

  // Batch insert first - cheap when nothing conflicts. If anything
  // fails (most likely an in-batch duplicate that slipped past the
  // pre-dedupe), fall back to per-row inserts so one bad apple doesn't
  // sink the whole batch.
  const batchResult = await supabase.from("inbox_events").insert(rows)
  if (!batchResult.error) return { inserted: rows.length, lastError: null }

  console.error(
    "[pull-trengo-private-channels] batch insert failed, falling back to per-row:",
    batchResult.error.message,
  )

  let inserted = 0
  let lastError: string | null = batchResult.error.message
  for (const row of rows) {
    const { error } = await supabase.from("inbox_events").insert(row)
    if (error) {
      lastError = error.message
      continue
    }
    inserted++
  }
  return { inserted, lastError }
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
              candidates.push(
                ...eventsFromMessageList(channelId, ticket, messages, cutoffMs),
              )
            } catch (e) {
              console.error(
                `[pull-trengo-private-channels] /messages failed for ticket ${ticket.id}:`,
                e instanceof Error ? e.message : e,
              )
            }
          }
          totalCandidates += candidates.length

          // Dedupe by source_msg_id - the webhook may have inserted
          // these for shared channels; private channels pass through
          // fresh on first run.
          const existing = await findExistingMsgIds(
            supabase,
            candidates.map((c) => c.sourceMsgId),
          )
          totalDeduped += existing.size
          const toInsert = candidates.filter((c) => !existing.has(c.sourceMsgId))
          const result = await insertEvents(supabase, hq.id, toInsert)
          totalEventsInserted += result.inserted
          if (result.lastError) lastInsertError = result.lastError
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

    return NextResponse.json({ ok: true, ...metrics, ...(debug ? { debugSamples } : {}) })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "pull-trengo-private-channels failed" },
      { status: 500 },
    )
  }
}
