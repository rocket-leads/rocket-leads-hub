import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import {
  fetchTrengoChannels,
  isEmailChannelType,
  isWhatsAppChannelType,
} from "@/lib/integrations/trengo"
import { filterClientsByUser } from "@/lib/clients/filter"
import { getUserTrengoChannelIds } from "@/lib/inbox/user-prefs"
import { stripHtml } from "@/lib/html"
import type {
  InboxChannelKind,
  InboxItem,
  InboxComment,
  InboxKind,
  InboxPriority,
  InboxSource,
  TaskStatus,
  UpdateStatus,
} from "@/types/inbox"

type Role = string

type RawInboxRow = {
  id: string
  kind: InboxKind
  client_id: string
  author_id: string
  assignee_id: string
  title: string
  body: string | null
  status: string
  priority: InboxPriority | null
  due_date: string | null
  /** Optional ISO timestamp pinning a task to a specific time of day on
   *  the calendar. Null when the user hasn't dragged it onto the time
   *  grid yet (falls back to the all-day strip). */
  scheduled_at: string | null
  snoozed_until: string | null
  source: InboxSource
  source_ref: Record<string, unknown> | null
  monday_update_id: string | null
  trengo_channel_id: number | null
  /** Trengo agent currently assigned to the ticket. Null = unassigned and
   *  eligible for the Hub inbox. Non-null = someone in Trengo is handling
   *  it; the row is hidden from the Hub. */
  trengo_assignee_user_id: number | null
  /** Set by webhook ingesters to the *real* author name (the Trengo contact,
   *  Monday user, or Slack user) since the FK `author_id` always points at the
   *  system HQ account for those events. Manual creates leave it null. */
  author_name_cached: string | null
  /** External author identifier - the Trengo contact id / Slack user id /
   *  Monday user id from the original event. Used by the "Link to client" UX
   *  to know which Trengo contact to attach to a client. */
  author_external: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  author: { id: string; name: string | null; email: string } | null
  assignee: { id: string; name: string | null; email: string } | null
  inbox_comments: Array<{ count: number }> | null
}

type ListFilters = {
  kind?: InboxKind
  clientId?: string
  assignedToMe?: boolean
  /**
   * Explicit status list. When omitted, defaults to the "active" set
   * (unread for updates; open + in_progress for tasks). Pass an empty
   * array to short-circuit and return nothing.
   */
  statuses?: string[]
  /**
   * Snooze handling:
   *  - 'active'  (default for active filters) - hide currently snoozed items
   *  - 'snoozed' - show ONLY currently snoozed items
   *  - 'all'     - return both, ignoring snooze state
   */
  snoozed?: "active" | "snoozed" | "all"
}

/**
 * Build the visibility filter set for a user.
 *
 * Returns "all" for admins (no client filter applied), or the list of Monday
 * item IDs they can see - which is derived from the cached Monday boards plus
 * their user_column_mappings (same logic as Watch List / Clients overview).
 *
 * Items where the user is author or assignee are always visible regardless
 * of this list - that's enforced at query time.
 */
async function getAllowedClientIds(
  userId: string,
  role: Role,
): Promise<"all" | string[]> {
  if (role === "admin") return "all"

  let allClients: MondayClient[] = []
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  if (cached) {
    allClients = [...cached.onboarding, ...cached.current]
  } else {
    try {
      const fresh = await fetchBothBoards()
      allClients = [...fresh.onboarding, ...fresh.current]
    } catch {
      allClients = []
    }
  }

  const filtered = await filterClientsByUser(allClients, userId, role)
  return filtered.map((c) => c.mondayItemId)
}

/**
 * Returns a map of Monday item ID → Monday client, used to attach client
 * names to inbox items in list responses. Falls back to an empty map if
 * the cache is cold and Monday is unreachable - names will render as
 * "(unknown)" rather than crashing the list.
 */
async function getMondayClientMap(): Promise<Map<string, MondayClient>> {
  const map = new Map<string, MondayClient>()
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const all = cached
    ? [...cached.onboarding, ...cached.current]
    : await fetchBothBoards()
        .then((d) => [...d.onboarding, ...d.current])
        .catch(() => [])
  for (const c of all) map.set(c.mondayItemId, c)
  return map
}

function rowToItem(
  row: RawInboxRow,
  clientMap: Map<string, MondayClient>,
  channelLookup: Map<number, { kind: ChatChannelKind; name: string }>,
): InboxItem {
  // Prefer author_name_cached when set - webhook ingesters store the real
  // Trengo contact / Monday user / Slack user there because the FK author_id
  // is forced to the system HQ account. Manual creates leave it null and
  // fall through to the joined Hub user, which is correct for those rows.
  const authorName =
    row.author_name_cached?.trim() ||
    row.author?.name ||
    row.author?.email ||
    "Unknown"

  // Trengo events whose contact id isn't on any client.trengo_contact_ids[]
  // land with client_id="". Surface this so the UI can render "Unlinked"
  // instead of the "(unknown)" fallback - the AM should know to link this
  // contact to the right client. Other sources always have a client_id set.
  const isUnlinked = row.source === "trengo" && (!row.client_id || row.client_id === "")
  const linkedClientName = clientMap.get(row.client_id)?.name

  // Resolve channel medium for Trengo rows so the row UI can show the
  // WhatsApp/email-specific brand mark instead of the generic Trengo cyan.
  let channelKind: InboxChannelKind = null
  if (row.source === "trengo" && row.trengo_channel_id != null) {
    channelKind = channelLookup.get(row.trengo_channel_id)?.kind ?? "other"
  }

  // Defensive HTML strip on title/body. Webhook ingesters strip at write
  // time (since 2026-05-05), but historical rows from before that fix -
  // and any future ingest path we forget to wire - would otherwise dump
  // raw `<p><a class="user_mention_editor router">…</a></p>` into the row
  // UI. Cheap to run (regex on a short string) and a no-op when the field
  // is already plain text. We only invoke it when the field actually looks
  // HTML-shaped to avoid the regex pass on the 99% of rows that are clean.
  const cleanTitle = row.title.includes("<") ? stripHtml(row.title) : row.title
  const cleanBody =
    row.body && row.body.includes("<") ? stripHtml(row.body) : row.body

  return {
    id: row.id,
    kind: row.kind,
    clientId: row.client_id,
    clientName: linkedClientName ?? (isUnlinked ? "" : "(unknown)"),
    authorId: row.author_id,
    authorName,
    authorExternal: row.author_external,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee?.name ?? row.assignee?.email ?? "Unknown",
    title: cleanTitle,
    body: cleanBody,
    status: row.status as UpdateStatus | TaskStatus,
    priority: row.priority,
    dueDate: row.due_date,
    scheduledAt: row.scheduled_at,
    source: row.source,
    channelKind,
    sourceRef: row.source_ref,
    mondayUpdateId: row.monday_update_id,
    isUnlinked,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    commentCount: row.inbox_comments?.[0]?.count ?? 0,
  }
}

const ITEM_SELECT = `
  id, kind, client_id, author_id, assignee_id, title, body, status, priority,
  due_date, scheduled_at, snoozed_until, source, source_ref, monday_update_id, trengo_channel_id,
  trengo_assignee_user_id,
  author_name_cached, author_external,
  created_at, updated_at, completed_at,
  author:users!inbox_items_author_id_fkey(id, name, email),
  assignee:users!inbox_items_assignee_id_fkey(id, name, email),
  inbox_comments(count)
`

export async function listInboxItems(
  userId: string,
  role: Role,
  filters: ListFilters = {},
): Promise<InboxItem[]> {
  const supabase = await createAdminClient()

  let query = supabase
    .from("inbox_events")
    .select(ITEM_SELECT)
    .order("created_at", { ascending: false })

  if (filters.kind) query = query.eq("kind", filters.kind)
  if (filters.clientId) query = query.eq("client_id", filters.clientId)

  // Tasks/Updates are strictly "for me" - assignee-driven regardless of
  // the assignedToMe toggle. Without this, an AM saw items they merely
  // authored for someone else (e.g. Roel writing an update on Mike's
  // client → showing up in Roel's own Updates tab) or items they had
  // generic client-access to. That's noise: Tasks/Updates panes are a
  // to-do list, not a "everything happening on my clients" feed. Mention
  // routing already lands on assignee_id via the Monday webhook ingest
  // (lib/webhooks/monday/route.ts:261) so @-mentions still reach the
  // right person through this same filter.
  if (filters.kind === "task" || filters.kind === "update") {
    query = query.eq("assignee_id", userId)
  } else if (filters.assignedToMe) {
    query = query.eq("assignee_id", userId)
  }

  // De-dup the dual-inbox: Trengo and Slack ingest set `thread_key` on
  // every row so the chat substrate (Client Inbox / future Team Inbox) can
  // group them. When the classifier promotes one of those messages to
  // kind=update or kind=task it would otherwise show up BOTH in the
  // Tasks/Updates tab AND in the Client Inbox thread, which is what Roy
  // flagged as "te veel dubbele berichten."
  //
  // Rule: discrete tabs (Tasks / Updates) only show events that are NOT
  // part of a chat thread. Trengo/Slack rows live in the chat substrate
  // exclusively. Promotions still happen - they're just promotions
  // INSIDE the substrate (Make-task on a chat row creates a fresh
  // thread-less task; the original chat event stays in the thread).
  if (filters.kind === "task" || filters.kind === "update") {
    query = query.is("thread_key", null)
  }

  if (filters.statuses) {
    if (filters.statuses.length === 0) return []
    query = query.in("status", filters.statuses)
  } else {
    if (filters.kind === "update") query = query.eq("status", "unread")
    else if (filters.kind === "task") query = query.in("status", ["open", "in_progress"])
  }

  // Snooze handling - defaults to hiding snoozed items in active views for
  // both Tasks AND Updates. Copilot-scheduled reminder Updates store their
  // surface-on date in snoozed_until, so without this default they'd appear
  // in today's Updates list the moment they're created. PostgREST `or` lets
  // us express "snoozed_until IS NULL OR snoozed_until <= now".
  const snoozeMode = filters.snoozed ?? "active"
  if (snoozeMode === "active") {
    const nowIso = new Date().toISOString()
    query = query.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
  } else if (snoozeMode === "snoozed") {
    const nowIso = new Date().toISOString()
    query = query.gt("snoozed_until", nowIso)
  }

  // Visibility for non-Tasks/Updates queries (chat substrate, mixed views,
  // /api/inbox without a kind param). Skip when scoped to a specific client
  // - the API caller already verified that access - or when caller is admin.
  //
  // Tasks/Updates already enforce the strict assignee filter above and don't
  // need this broader OR clause. Keeping it would silently re-open the
  // self-authored / "anything on my clients" leak we just closed.
  //
  // Role-split (Roy 2026-06-09 - isolation pass):
  //   - admin: sees everything (no filter)
  //   - AM / other: client-access + Trengo channel subscription path stays
  //     (they own client conversations and need the wide view)
  //   - cm_only: chat rows ONLY when they authored or are explicitly
  //     assigned. No bulk visibility via client access or channel
  //     subscription. CMs work assignment-driven, not access-driven -
  //     @-mentions reach them as kind=update rows; client-conversation
  //     hand-offs reach them via assignee_id. Anything else is noise.
  const isTaskOrUpdate = filters.kind === "task" || filters.kind === "update"
  if (!filters.clientId && !isTaskOrUpdate) {
    const audienceRole = await resolveInboxAudienceRole(userId, role)
    if (audienceRole === "cm_only") {
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}`,
      )
    } else if (audienceRole !== "admin") {
      const allowed = await getAllowedClientIds(userId, role)
      if (allowed !== "all") {
        const ids = allowed
        const channelIds = await getUserTrengoChannelIds(userId)
        const inClause = ids.length > 0 ? `,client_id.in.(${ids.join(",")})` : ""
        const channelClause =
          channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
        query = query.or(
          `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
        )
      }
    }
  }

  // Unassigned-only Trengo filter - applies to admins and non-admins alike.
  // Tickets claimed by anyone in Trengo are owned by Trengo's UI, not the
  // Hub. Non-Trengo events bypass this filter entirely.
  query = query.or(
    `trengo_assignee_user_id.is.null,source.neq.trengo`,
  )

  const { data, error } = await query
  if (error) throw new Error(`Failed to list inbox items: ${error.message}`)

  const [clientMap, channelLookup] = await Promise.all([
    getMondayClientMap(),
    getTrengoChannelLookup(),
  ])
  return ((data ?? []) as unknown as RawInboxRow[]).map((r) =>
    rowToItem(r, clientMap, channelLookup),
  )
}

export async function getInboxItem(
  id: string,
  userId: string,
  role: Role,
): Promise<InboxItem | null> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_events")
    .select(ITEM_SELECT)
    .eq("id", id)
    .single()

  if (error || !data) return null
  const row = data as unknown as RawInboxRow

  // Unassigned-only Trengo gate - applies to admins and non-admins alike.
  // Once a teammate claims the ticket in Trengo, it leaves the Hub even if
  // a user previously had access via channel subscription.
  if (row.source === "trengo" && row.trengo_assignee_user_id != null) {
    return null
  }

  // Visibility check
  if (role !== "admin") {
    const isParticipant = row.author_id === userId || row.assignee_id === userId
    if (!isParticipant) {
      const allowed = await getAllowedClientIds(userId, role)
      const allAllowed = allowed === "all"
      const inAllowed = allAllowed || allowed.includes(row.client_id)
      if (!inAllowed) {
        // Channel-subscription fallback: visible if the row's Trengo channel
        // is in the user's subscribed set.
        const channelIds = await getUserTrengoChannelIds(userId)
        const channelMatch =
          row.trengo_channel_id != null && channelIds.includes(row.trengo_channel_id)
        if (!channelMatch) return null
      }
    }
  }

  const [clientMap, channelLookup] = await Promise.all([
    getMondayClientMap(),
    getTrengoChannelLookup(),
  ])
  return rowToItem(row, clientMap, channelLookup)
}

export async function listInboxComments(itemId: string): Promise<InboxComment[]> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_comments")
    .select(`
      id, item_id, author_id, body, monday_update_id, created_at,
      author:users!inbox_comments_author_id_fkey(id, name, email)
    `)
    .eq("item_id", itemId)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`Failed to list comments: ${error.message}`)

  type Row = {
    id: string
    item_id: string
    author_id: string
    body: string
    monday_update_id: string | null
    created_at: string
    author: { name: string | null; email: string } | null
  }

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    itemId: r.item_id,
    authorId: r.author_id,
    authorName: r.author?.name ?? r.author?.email ?? "Unknown",
    body: r.body,
    mondayUpdateId: r.monday_update_id,
    createdAt: r.created_at,
  }))
}

/**
 * Counts for the sidebar badge: unread updates + open/in-progress tasks +
 * unread chat messages the user can see (Client Inbox + Team Inbox).
 *
 * Tasks/updates are scoped to assignee_id (mine to do). Chats use the same
 * visibility set as the Client/Team Inbox (channel subscriptions + client
 * access + participant fallback) - counting messages, not threads, so the
 * sidebar number lines up with the per-thread unread counts. Snoozed tasks
 * are excluded to keep the badge silent while the user has parked them.
 */
/**
 * Per-user Monday role mapping → "what kind of relationship does this Hub
 * user have with clients". Drives the Client Inbox tab visibility (CM-only
 * users don't get the tab unless they have an unread chat directly
 * assigned to them - i.e. a mention).
 *
 * Returns:
 *   - "admin"            Hub role is "admin" → always sees everything
 *   - "am"               Mapped as account_manager (with or without CM)
 *                        → sees Client Inbox by default (AM owns client
 *                        conversations)
 *   - "cm_only"          Mapped as campaign_manager ONLY → hidden unless
 *                        they have an unread chat assigned to them
 *   - "other"            No relevant mapping → default behaviour
 */
export type InboxAudienceRole = "admin" | "am" | "cm_only" | "other"

export async function resolveInboxAudienceRole(
  userId: string,
  hubRole: Role,
): Promise<InboxAudienceRole> {
  if (hubRole === "admin") return "admin"
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("user_column_mappings")
    .select("monday_column_role")
    .eq("user_id", userId)
    .in("monday_column_role", ["account_manager", "campaign_manager"])
  const roles = new Set((data ?? []).map((r) => r.monday_column_role as string))
  if (roles.has("account_manager")) return "am"
  if (roles.has("campaign_manager")) return "cm_only"
  return "other"
}

export async function getInboxBadgeCounts(
  userId: string,
  role: Role = "member",
): Promise<{
  unreadUpdates: number
  openTasks: number
  unreadChats: number
  /** True when the Client Inbox tab should be visible for this user.
   *  Hidden for cm_only users with no unread chat assigned to them.
   *  AMs / admins always see it. Roy 2026-06-09. */
  showClientInbox: boolean
}> {
  const supabase = await createAdminClient()

  // Snoozed tasks shouldn't ping the sidebar - that's the point of snoozing.
  // Active = snoozed_until IS NULL OR has already passed.
  const nowIso = new Date().toISOString()

  // Resolve the audience role first - the chat visibility query branches on
  // it. CMs see chat rows only when explicitly assigned; AMs/admins keep
  // the channel-subscription + client-access path.
  const audienceRole = await resolveInboxAudienceRole(userId, role)

  // Scope filter: the only chat tab in the UI is "Klanten Inbox" which is
  // hard-wired to scope="external". Slack-ingested events land at
  // scope="internal" and have no place to be read - the Team Inbox tab is
  // intentionally hidden (see inbox-view.tsx comment near line 618). Without
  // this filter, internal events accumulate forever and inflate the badge
  // (Roy 2026-05-23: Danny's tab showed "274" while all 24 client conversations
  // were read - the 274 were ghost Slack rows).
  let chatQuery = supabase
    .from("inbox_events")
    .select("id", { count: "exact", head: true })
    .not("thread_key", "is", null)
    .eq("scope", "external")
    .eq("status", "unread")

  // Channel subscriptions broaden visibility for every role - CMs included
  // (Roy 2026-06-12: CMs need their private email channels in the Kanalen
  // tab, not just assignment-driven chat). Resolved up front so the CM
  // and AM branches can share the value.
  const subscribedChannelIds = await getUserTrengoChannelIds(userId)

  if (audienceRole === "cm_only") {
    // CM-only: assignee/author by default, plus rows on any channel the
    // CM explicitly subscribed to in /account. Without the channel sub
    // path the Kanalen tab is empty for CMs even when they're connected.
    const channelClause =
      subscribedChannelIds.length > 0
        ? `,trengo_channel_id.in.(${subscribedChannelIds.join(",")})`
        : ""
    chatQuery = chatQuery.or(
      `author_id.eq.${userId},assignee_id.eq.${userId}${channelClause}`,
    )
  } else {
    // AM / admin / other: channel-subscription narrowing always applies,
    // then role-based access on top for non-admins.
    if (subscribedChannelIds.length > 0) {
      chatQuery = chatQuery.or(
        `trengo_channel_id.in.(${subscribedChannelIds.join(",")}),source.neq.trengo`,
      )
    }
    if (role !== "admin") {
      const allowed = await getAllowedClientIds(userId, role)
      if (allowed !== "all") {
        const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
        const channelClause =
          subscribedChannelIds.length > 0
            ? `,trengo_channel_id.in.(${subscribedChannelIds.join(",")})`
            : ""
        chatQuery = chatQuery.or(
          `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
        )
      }
    }
  }

  // Unassigned-only Trengo gate - exclude tickets currently claimed in Trengo
  // from the badge so the count matches what the Client Inbox actually shows.
  chatQuery = chatQuery.or(
    `trengo_assignee_user_id.is.null,source.neq.trengo`,
  )

  const [updatesRes, tasksRes, chatsRes] = await Promise.all([
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "update")
      .eq("status", "unread")
      // Same de-dup as listInboxItems - chat-substrate events are counted
      // by the chats query below, never by tasks/updates badges.
      .is("thread_key", null),
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "task")
      .in("status", ["open", "in_progress"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .is("thread_key", null),
    chatQuery,
  ])

  const unreadChats = chatsRes.count ?? 0
  // CM gets the Kanalen tab when (a) they have an assigned chat row,
  // OR (b) they've subscribed to any Trengo channels in /account. Roy
  // 2026-06-12: CMs need their private email channels available even
  // before the first message arrives, so the gate is "are they wired
  // up to receive" not "have they already received something".
  const showClientInbox =
    audienceRole !== "cm_only" || unreadChats > 0 || subscribedChannelIds.length > 0

  return {
    unreadUpdates: updatesRes.count ?? 0,
    openTasks: tasksRes.count ?? 0,
    unreadChats,
    showClientInbox,
  }
}

// --- Chat substrate fetchers (Phase C.7) ----------------------------------
//
// Inbox events that carry a thread_key are part of the chat substrate -
// continuous conversation threads from Trengo (per-contact) and Slack
// (per-DM, per-channel, per-mpim). They live in the Team Inbox / Client
// Inbox tabs, separate from the discrete Tasks/Updates panes.
//
// scope routes:
//   - 'external' → Client Inbox tab (Trengo today, future client-facing chats)
//   - 'internal' → Team Inbox tab (Slack DMs + channels)
//
// Visibility mirrors listInboxItems(): admins see all, others see threads
// where they're author/assignee of any event OR have access to the linked
// client. We filter at the event level then group, so a thread shows up
// with whatever events the user can see.

export type ChatScope = "external" | "internal"

/** High-level channel medium used to drive the icon/badge in the thread row.
 *  We only differentiate WhatsApp vs email today - voice / chat / social are
 *  bucketed under `other` until we surface them. Null when the thread isn't
 *  Trengo (Slack threads ride a separate icon path). */
export type ChatChannelKind = "whatsapp" | "email" | "other" | null

export type ChatThreadSummary = {
  threadKey: string
  scope: ChatScope
  source: InboxSource
  /** Display name - primary other-party (Trengo contact, Slack channel, etc). */
  primaryName: string
  /** Linked Hub client name when client_id is set on any event in the thread. */
  clientName: string | null
  /** Monday item id of the linked client - surfaced so the chat-pane can
   *  create tasks/updates against this thread's client without an extra
   *  lookup. Null when the thread isn't linked yet (Trengo "unlinked"). */
  clientId: string | null
  /** WhatsApp / email / other - drives the icon shown next to the thread.
   *  Resolved from Trengo channel id at fetch time so the UI doesn't need
   *  a separate roundtrip. Null for Slack and other non-Trengo sources. */
  channelKind: ChatChannelKind
  /** Human-readable Trengo channel name (e.g. "Roy Personal", "Roy Vosters"
   *  for the WA line). Useful in the thread header so the user can see
   *  exactly which inbox the message came in on. */
  channelName: string | null
  /** Trengo channel id (numeric). Surfaced so the WhatsApp composer can
   *  fetch the templates approved for this channel without an extra
   *  thread-detail round-trip. Null for non-Trengo sources. */
  trengoChannelId: number | null
  /** Most recent message preview (truncated). */
  latestPreview: string
  /** Latest email subject across the thread - drives the bold title on
   *  email rows in the list. Null when the thread is WhatsApp/Slack or
   *  the latest email row didn't carry a subject (rare for real mail).
   *  Roy 2026-06-13: email rows should headline the subject, not the
   *  body preview - subject is the actual "what is this" signal. */
  latestSubject: string | null
  /** Most recent message timestamp (uses created_at_src when available). */
  latestAt: string
  /** Latest event id - used by the reply UI to derive source/thread metadata. */
  latestEventId: string
  totalCount: number
  unreadCount: number
  /** Triage state derived per thread (Roy 2026-06-13):
   *   - isStarred  : true when any row in the thread is starred
   *   - isArchived : true when the LATEST row is archived (thread-level
   *                  archive moves the whole conversation out of the
   *                  Active inbox; an old archived ancestor + fresh new
   *                  inbound un-archives at thread level naturally)
   *   - snoozedUntil : max snoozed_until across the thread, or null when
   *                    nothing is snoozed past now. Drives the client-side
   *                    "Snoozed" filter and the "hide while snoozed"
   *                    default in Active views. */
  isStarred: boolean
  isArchived: boolean
  snoozedUntil: string | null
}

export type ChatMessage = {
  id: string
  authorKind: "rl_team" | "client" | "external" | null
  authorName: string
  authorExternal: string | null
  body: string
  /** Original HTML body for email messages, when the ingest path
   *  captured it (Roy 2026-06-13). When present the chat pane renders
   *  the message in a sandboxed iframe so the email shows up with
   *  proper paragraphs, images, and links instead of the stripped
   *  plain-text bubble. Null for plain-text sources (WhatsApp, Slack,
   *  Monday updates). */
  bodyHtml: string | null
  /** Email subject - prominent header on the email card. Null for
   *  non-email sources. */
  emailSubject: string | null
  /** Sender's email address (the envelope From), shown next to the
   *  display name so the AM can spot phishing at a glance. Null for
   *  non-email sources. */
  emailFromAddress: string | null
  /** Display-time timestamp - created_at_src when the source provided one. */
  at: string
  source: InboxSource
  status: string
  /** Team-only annotation (Trengo "internal note") - rendered as a yellow
   *  bubble in the thread so the AM can tell at a glance what's customer-
   *  visible vs. team chatter. False for all client/external messages. */
  isInternal: boolean
}

type RawChatRow = {
  id: string
  source: InboxSource
  scope: string | null
  thread_key: string | null
  client_id: string
  author_id: string
  assignee_id: string
  author_kind: string | null
  author_external: string | null
  author_name_cached: string | null
  title: string
  body: string | null
  body_html: string | null
  email_subject: string | null
  email_from: string | null
  status: string
  starred: boolean | null
  archived_at: string | null
  snoozed_until: string | null
  created_at: string
  created_at_src: string | null
  trengo_channel_id: number | null
  trengo_assignee_user_id: number | null
  is_internal: boolean | null
  author: { id: string; name: string | null; email: string } | null
  assignee: { id: string; name: string | null; email: string } | null
}

const CHAT_SELECT = `
  id, source, scope, thread_key, client_id, author_id, assignee_id,
  author_kind, author_external, author_name_cached, title, body, body_html,
  email_subject, email_from, status, starred, archived_at, snoozed_until,
  created_at, created_at_src, trengo_channel_id, trengo_assignee_user_id, is_internal,
  author:users!inbox_items_author_id_fkey(id, name, email),
  assignee:users!inbox_items_assignee_id_fkey(id, name, email)
`

function rowAuthorName(row: RawChatRow): string {
  if (row.author_kind === "rl_team") {
    return row.author?.name ?? row.author?.email ?? row.author_name_cached ?? "Team"
  }
  return row.author_name_cached ?? "Unknown"
}

function rowDisplayAt(row: RawChatRow): string {
  return row.created_at_src ?? row.created_at
}

/** Resolve a Trengo channel id → its kind (whatsapp/email/other) plus the
 *  human-readable label. Result is small (< 100 channels) and the underlying
 *  Trengo fetch is itself cached for 5 minutes via the integrations layer,
 *  so calling this on every chat-pane poll is cheap. */
async function getTrengoChannelLookup(): Promise<
  Map<number, { kind: ChatChannelKind; name: string }>
> {
  const map = new Map<number, { kind: ChatChannelKind; name: string }>()
  try {
    const channels = await fetchTrengoChannels()
    for (const c of channels) {
      // Use the canonical helpers from trengo.ts so the lookup agrees with
      // every other place that decides "is this WA / email" - the previous
      // exact-match `t === "EMAIL"` missed IMAP / OUTLOOK / mail-prefixed
      // channel types and tagged them as "other", which made every email
      // thread fall through ChatListRowBody (generic chat icon, composer
      // stays open) instead of EmailListRowBody (Mail icon, collapsed reply).
      let kind: ChatChannelKind = "other"
      if (isWhatsAppChannelType(c.type)) {
        kind = "whatsapp"
      } else if (isEmailChannelType(c.type)) {
        kind = "email"
      }
      // Mirror the display logic from /api/integrations/trengo/channels:
      // prefer `title` (Trengo sidebar label), fall back to display_name and
      // finally `Channel <id>` so the UI never shows a blank.
      const typeUpper = (c.type ?? "").toUpperCase()
      const title = typeof c.title === "string" ? c.title.trim() : ""
      const display = typeof c.display_name === "string" ? c.display_name.trim() : ""
      const name =
        title && title.toLowerCase() !== typeUpper.toLowerCase()
          ? title
          : display || `Channel ${c.id}`
      map.set(c.id, { kind, name })
    }
  } catch {
    // If Trengo is briefly unreachable, the chat list still renders without
    // channel decoration - falling back to the generic chat icon.
  }
  return map
}

/** Derive a human-friendly primary name for a thread from its thread_key.
 *  We keep this deterministic so the UI doesn't need extra round-trips. */
function deriveThreadName(threadKey: string, fallback: string): string {
  // trengo:contact:<id> → use latest external author name
  // slack:dm:<user_id> → use latest external author name
  // slack:channel:<id> → "#<channel id>" until we resolve real names
  // slack:mpim:<id> → "Group DM"
  if (threadKey.startsWith("slack:channel:")) {
    return `#channel ${threadKey.replace("slack:channel:", "").slice(0, 8)}`
  }
  if (threadKey.startsWith("slack:mpim:")) return "Group DM"
  return fallback
}

/**
 * Best-effort extractor for the recipient name from an outbound greeting.
 *
 * Roy: our outbound WhatsApp templates always open with "Ha {Name}, ..."
 * (or "Hoi", "Hi", "Hallo", "Hey"). For threads where the lead hasn't
 * replied yet, the Trengo contact is just our own WhatsApp Business
 * display ("Team") and `author_name_cached` doesn't carry the real
 * recipient - so the inbox list showed "Team" for every row. By parsing
 * the greeting we can surface the actual recipient ("Patrick") without
 * waiting on a manual contact-to-client link.
 *
 * Conservative regex: requires a capitalised first letter, length 2–30,
 * optionally a second word, followed by a punctuation/newline terminator.
 * Returns null on no match so callers can fall back cleanly.
 */
const GREETING_RE =
  /^\s*(?:Ha|Hoi|Hi|Hallo|Hey|Hé)\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\-']{1,29}(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\-']{1,29})?)\s*[,!.\n]/
function extractRecipientFromGreeting(body: string | null | undefined): string | null {
  if (!body) return null
  const match = body.match(GREETING_RE)
  if (!match) return null
  const captured = match[1].trim()
  // Reject obvious non-names that occasionally slip through ("There",
  // "Everyone", etc.). Tiny stop-list - we'd rather miss-match and show
  // the generic name than confidently assign the wrong recipient.
  const STOP = new Set([
    "there", "everyone", "team", "all", "guys", "people", "iedereen", "team",
  ])
  if (STOP.has(captured.toLowerCase())) return null
  return captured
}

/** True when the resolved thread display name is the WhatsApp Business
 *  account's own display ("Team") or our generic fallback. Used as the
 *  trigger to fall back to greeting extraction. */
function isGenericThreadName(name: string): boolean {
  if (name === "Team" || name === "Unknown") return true
  if (/^team\b/i.test(name)) return true
  return false
}

export async function listChatThreads(
  userId: string,
  role: Role,
  scope: ChatScope,
): Promise<ChatThreadSummary[]> {
  const supabase = await createAdminClient()

  let query = supabase
    .from("inbox_events")
    .select(CHAT_SELECT)
    .not("thread_key", "is", null)
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    // Cap the raw row pull - threads with hundreds of messages still surface
    // because we group post-hoc. 1k is generous for now.
    .limit(1000)

  // Channel subscriptions broaden visibility for every role. Roy
  // 2026-06-12: CMs are mapped to "Kanalen" too - their private email
  // channels show in the inbox when they've subscribed in /account.
  const audienceRole = await resolveInboxAudienceRole(userId, role)
  const subscribedChannelIds = await getUserTrengoChannelIds(userId)

  if (audienceRole === "cm_only") {
    // CM: assignee/author by default; channel-subscription adds rows on
    // any channel the CM explicitly picked. Without that path the
    // Kanalen tab would always be empty for CMs.
    const channelClause =
      subscribedChannelIds.length > 0
        ? `,trengo_channel_id.in.(${subscribedChannelIds.join(",")})`
        : ""
    query = query.or(
      `author_id.eq.${userId},assignee_id.eq.${userId}${channelClause}`,
    )
  } else {
    // Trengo channel subscriptions ALWAYS narrow the Client Inbox down to the
    // user's chosen channels - applies to admins too. Without this, an admin
    // sees every Trengo conversation in the workspace regardless of which
    // channels they actually want to follow. Non-Trengo events bypass this
    // filter via `source.neq.trengo`.
    if (subscribedChannelIds.length > 0) {
      query = query.or(
        `trengo_channel_id.in.(${subscribedChannelIds.join(",")}),source.neq.trengo`,
      )
    }

    if (role !== "admin") {
      const allowed = await getAllowedClientIds(userId, role)
      if (allowed !== "all") {
        const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
        const channelClause =
          subscribedChannelIds.length > 0
            ? `,trengo_channel_id.in.(${subscribedChannelIds.join(",")})`
            : ""
        query = query.or(
          `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
        )
      }
    }
  }

  // Unassigned-only Trengo gate. Tickets claimed in Trengo leave the Hub.
  query = query.or(
    `trengo_assignee_user_id.is.null,source.neq.trengo`,
  )

  const { data, error } = await query
  if (error) throw new Error(`Failed to list chat threads: ${error.message}`)

  return groupAndDecorateChatRows(
    ((data ?? []) as unknown as RawChatRow[]).filter((r) => r.thread_key),
  )
}

/**
 * Group raw chat-substrate rows into per-thread summaries. Shared between
 * the full-visibility path (`listChatThreads` default) and the mentions-
 * only path (CM Mentions tab) so both produce the same thread shape.
 *
 * Rows are expected to be pre-filtered by visibility AND ordered
 * `created_at DESC` (newest first) by the caller - same contract the
 * inline grouping used before the extraction.
 */
async function groupAndDecorateChatRows(
  rows: RawChatRow[],
): Promise<ChatThreadSummary[]> {
  // Group by thread_key. Newest event wins for the summary fields since
  // rows are already ordered by created_at DESC.
  const byThread = new Map<string, { rows: RawChatRow[] }>()
  for (const row of rows) {
    const key = row.thread_key as string
    let entry = byThread.get(key)
    if (!entry) {
      entry = { rows: [] }
      byThread.set(key, entry)
    }
    entry.rows.push(row)
  }

  // Thread-level unassigned-only gate. The row-level filter on the query
  // already drops claimed events, but historical rows ingested before the
  // assignee column existed carry NULL - without this pass, those threads
  // would still surface (with stale NULL rows) once a teammate claims the
  // ticket. Drop any thread where at least one event has a non-null Trengo
  // assignee.
  for (const [key, entry] of byThread) {
    const claimed = entry.rows.some(
      (r) => r.source === "trengo" && r.trengo_assignee_user_id != null,
    )
    if (claimed) byThread.delete(key)
  }

  const clientMap = await getMondayClientMap()
  const channelLookup = await getTrengoChannelLookup()

  const threads: ChatThreadSummary[] = []
  for (const [threadKey, { rows: threadRows }] of byThread) {
    if (threadRows.length === 0) continue
    const latest = threadRows[0]
    const externalAuthor = threadRows.find(
      (r) => r.author_kind && r.author_kind !== "rl_team",
    )
    const fallbackName =
      externalAuthor?.author_name_cached ?? latest.author_name_cached ?? "Unknown"
    let primaryName = deriveThreadName(threadKey, fallbackName)

    // If the resolved name is the generic "Team" (our WhatsApp Business
    // display for outbound-only threads), try to surface the actual
    // recipient by parsing the templated greeting in any message body in
    // this thread. We walk through threadRows (DESC by created_at) so the
    // most-recently-sent greeting wins on the off-chance there are
    // multiple outbound openings. Roy: no more "Team / Team / Team" rows.
    if (isGenericThreadName(primaryName)) {
      for (const r of threadRows) {
        const candidate = extractRecipientFromGreeting(r.body)
        if (candidate) {
          primaryName = candidate
          break
        }
      }
    }
    const clientName = latest.client_id
      ? clientMap.get(latest.client_id)?.name ?? null
      : null
    const previewSrc = latest.body ?? latest.title ?? ""
    const latestPreview =
      previewSrc.length > 120 ? previewSrc.slice(0, 120) + "…" : previewSrc
    // Surface the freshest email subject across the thread so the list
    // row can headline it. Walk newest-first since `threadRows` is
    // already DESC by created_at; the first non-empty subject wins.
    let latestSubject: string | null = null
    for (const r of threadRows) {
      const s = r.email_subject?.trim()
      if (s) {
        latestSubject = s
        break
      }
    }
    const unreadCount = threadRows.filter((r) => r.status === "unread").length
    // Triage flags rolled up across the thread. isArchived follows the
    // freshest row so a new inbound un-archives the thread naturally
    // ("klant heeft op je archive geantwoord → back in inbox").
    const isStarred = threadRows.some((r) => r.starred === true)
    const isArchived = latest.archived_at != null
    let snoozedUntil: string | null = null
    for (const r of threadRows) {
      if (!r.snoozed_until) continue
      if (snoozedUntil == null || r.snoozed_until > snoozedUntil) {
        snoozedUntil = r.snoozed_until
      }
    }

    // Resolve channel kind/name from the most recent Trengo channel id we
    // saw on this thread. Walk back through events because the latest one
    // might be an outbound mirror without a channel id (legacy rows).
    let channelKind: ChatChannelKind = null
    let channelName: string | null = null
    let trengoChannelId: number | null = null
    if (latest.source === "trengo") {
      for (const r of threadRows) {
        if (r.trengo_channel_id != null) {
          trengoChannelId = r.trengo_channel_id
          const info = channelLookup.get(r.trengo_channel_id)
          if (info) {
            channelKind = info.kind
            channelName = info.name
          }
          break
        }
      }
      // Content-based email signal OVERRIDES the channel classification.
      // Some Trengo workspaces route mail through "multi-channel" inboxes
      // that show up as wa_business in /channels (root cause of the
      // persistent "WhatsApp icon on a clearly-email row" bug). We trust
      // the content over the channel type. Two layers:
      //   1) `email_subject` / `email_from` / `body_html` — set by the
      //      polling cron (and outbound email sends) only for emails.
      //   2) HTML/MIME markers in `body` — webhook-ingested rows don't
      //      fill the email_* columns, but emails still arrive with
      //      HTML structure that WhatsApp messages never have.
      // Roy 2026-06-15. Aggressive override is safe because WhatsApp
      // never serves `<!doctype>` / `<table>` / `Content-Type:` headers.
      const hasEmailFields = threadRows.some(
        (r) =>
          (r.email_subject && r.email_subject.length > 0) ||
          (r.email_from && r.email_from.length > 0) ||
          (r.body_html && r.body_html.length > 0),
      )
      const looksLikeEmail =
        hasEmailFields ||
        threadRows.some((r) => {
          const b = r.body
          if (!b || b.length === 0) return false
          const lower = b.toLowerCase()
          return (
            lower.includes("<!doctype") ||
            lower.includes("<html") ||
            lower.includes("<table") ||
            lower.includes("<head>") ||
            lower.includes("content-type: text/html") ||
            lower.includes("mime-version:")
          )
        })
      if (looksLikeEmail) {
        channelKind = "email"
      }
    }

    threads.push({
      threadKey,
      scope: latest.scope === "external" ? "external" : "internal",
      source: latest.source,
      primaryName,
      clientName,
      clientId: latest.client_id || null,
      channelKind,
      channelName,
      trengoChannelId,
      latestPreview,
      latestSubject,
      latestAt: rowDisplayAt(latest),
      latestEventId: latest.id,
      totalCount: threadRows.length,
      unreadCount,
      isStarred,
      isArchived,
      snoozedUntil,
    })
  }

  threads.sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  return threads
}

/**
 * Mark every unread chat event in a thread as read for the calling user.
 *
 * We only flip rows the user is actually allowed to see - the visibility
 * filter mirrors `getChatThreadMessages` (channel subscription + client
 * access + participant fallback). Pre-fetching the event ids first keeps the
 * UPDATE simple and avoids any chance of writing through a broken visibility
 * filter - same pattern we use on the thread fetch.
 *
 * Returns the number of rows updated. Idempotent: calling it again on a
 * thread with no unread events is a fast no-op.
 */
export async function markChatThreadRead(
  threadKey: string,
  userId: string,
  role: Role,
): Promise<{ updated: number }> {
  const supabase = await createAdminClient()

  // If the thread is currently claimed in Trengo, the user shouldn't be able
  // to mark it read - they shouldn't even be seeing it. Cheap guard.
  const { data: claimedRow } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("thread_key", threadKey)
    .eq("source", "trengo")
    .not("trengo_assignee_user_id", "is", null)
    .limit(1)
    .maybeSingle()
  if (claimedRow) return { updated: 0 }

  let query = supabase
    .from("inbox_events")
    .select("id")
    .eq("thread_key", threadKey)
    .eq("status", "unread")

  const channelIds = await getUserTrengoChannelIds(userId)
  if (channelIds.length > 0) {
    query = query.or(
      `trengo_channel_id.in.(${channelIds.join(",")}),source.neq.trengo`,
    )
  }

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load unread events: ${error.message}`)

  const ids = (data ?? []).map((r) => (r as { id: string }).id)
  if (ids.length === 0) return { updated: 0 }

  const { error: updErr } = await supabase
    .from("inbox_events")
    .update({ status: "read" })
    .in("id", ids)
  if (updErr) throw new Error(`Failed to mark thread read: ${updErr.message}`)

  return { updated: ids.length }
}

/**
 * Mark a chat thread "unread" - flip the most recent visible event back to
 * status='unread' so the thread shows up as unread in the list and bumps the
 * sidebar badge by one. We only touch the latest event (not every read row in
 * the thread) because "unread" is a presentation signal, not a per-message
 * archival state - bringing one event back is enough for the thread to surface
 * with a badge, and avoids quietly resurrecting old reads that were already
 * triaged.
 *
 * Visibility filter mirrors markChatThreadRead so users can only flip threads
 * they can actually see. Idempotent: if the latest event is already unread,
 * this is a no-op.
 */
export async function markChatThreadUnread(
  threadKey: string,
  userId: string,
  role: Role,
): Promise<{ updated: number }> {
  const supabase = await createAdminClient()

  // Same claimed-ticket gate as markChatThreadRead - a Trengo-claimed thread
  // shouldn't be mutable from the Hub.
  const { data: claimedRow } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("thread_key", threadKey)
    .eq("source", "trengo")
    .not("trengo_assignee_user_id", "is", null)
    .limit(1)
    .maybeSingle()
  if (claimedRow) return { updated: 0 }

  let query = supabase
    .from("inbox_events")
    .select("id, status")
    .eq("thread_key", threadKey)
    .order("created_at", { ascending: false })
    .limit(1)

  const channelIds = await getUserTrengoChannelIds(userId)
  if (channelIds.length > 0) {
    query = query.or(
      `trengo_channel_id.in.(${channelIds.join(",")}),source.neq.trengo`,
    )
  }

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load latest event: ${error.message}`)

  const row = (data ?? [])[0] as { id: string; status: string } | undefined
  if (!row) return { updated: 0 }
  if (row.status === "unread") return { updated: 0 }

  const { error: updErr } = await supabase
    .from("inbox_events")
    .update({ status: "unread" })
    .eq("id", row.id)
  if (updErr) throw new Error(`Failed to mark thread unread: ${updErr.message}`)

  return { updated: 1 }
}

/**
 * Visibility filter helper shared by the triage actions below. Returns
 * the list of inbox_events ids in `threadKey` that the caller can
 * actually act on - mirrors the channel-subscription + client-access
 * gate the read path uses, so a user can't star/archive/snooze rows
 * they couldn't see in the first place.
 */
async function visibleThreadEventIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  threadKey: string,
  userId: string,
  role: Role,
): Promise<string[]> {
  let query = supabase
    .from("inbox_events")
    .select("id")
    .eq("thread_key", threadKey)

  const channelIds = await getUserTrengoChannelIds(userId)
  if (channelIds.length > 0) {
    query = query.or(
      `trengo_channel_id.in.(${channelIds.join(",")}),source.neq.trengo`,
    )
  }
  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load thread events: ${error.message}`)
  return (data ?? []).map((r) => (r as { id: string }).id)
}

/**
 * Star / unstar every event in a chat thread (Roy 2026-06-13 triage).
 * Mirror-flip at the row level so the rolled-up `isStarred` thread
 * flag toggles in lockstep.
 */
export async function setChatThreadStarred(
  threadKey: string,
  userId: string,
  role: Role,
  starred: boolean,
): Promise<{ updated: number }> {
  const supabase = await createAdminClient()
  const ids = await visibleThreadEventIds(supabase, threadKey, userId, role)
  if (ids.length === 0) return { updated: 0 }
  const { error } = await supabase
    .from("inbox_events")
    .update({ starred })
    .in("id", ids)
  if (error) throw new Error(`Failed to update star: ${error.message}`)
  return { updated: ids.length }
}

/**
 * Archive / un-archive every event in a chat thread. Archived rows
 * stop showing in the Active inbox views; the rollup uses LATEST
 * row's archived_at so a fresh inbound on an archived thread naturally
 * pops it back into the inbox.
 */
export async function setChatThreadArchived(
  threadKey: string,
  userId: string,
  role: Role,
  archived: boolean,
): Promise<{ updated: number }> {
  const supabase = await createAdminClient()
  const ids = await visibleThreadEventIds(supabase, threadKey, userId, role)
  if (ids.length === 0) return { updated: 0 }
  const { error } = await supabase
    .from("inbox_events")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in("id", ids)
  if (error) throw new Error(`Failed to update archive: ${error.message}`)
  return { updated: ids.length }
}

/**
 * Snooze a chat thread until `until` (ISO timestamp) or clear the
 * snooze when `until` is null. Stamps every row so the rollup-MAX
 * inside groupAndDecorate sees the snooze regardless of which row
 * is the latest.
 */
export async function setChatThreadSnoozedUntil(
  threadKey: string,
  userId: string,
  role: Role,
  until: string | null,
): Promise<{ updated: number }> {
  const supabase = await createAdminClient()
  const ids = await visibleThreadEventIds(supabase, threadKey, userId, role)
  if (ids.length === 0) return { updated: 0 }
  const { error } = await supabase
    .from("inbox_events")
    .update({ snoozed_until: until })
    .in("id", ids)
  if (error) throw new Error(`Failed to update snooze: ${error.message}`)
  return { updated: ids.length }
}

export async function getChatThreadMessages(
  threadKey: string,
  userId: string,
  role: Role,
): Promise<ChatMessage[]> {
  const supabase = await createAdminClient()

  // Hide message history once the Trengo ticket has been claimed by anyone.
  // Same reasoning as listChatThreads - the Hub doesn't show owned tickets.
  const { data: claimedRow } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("thread_key", threadKey)
    .eq("source", "trengo")
    .not("trengo_assignee_user_id", "is", null)
    .limit(1)
    .maybeSingle()
  if (claimedRow) return []

  let query = supabase
    .from("inbox_events")
    .select(CHAT_SELECT)
    .eq("thread_key", threadKey)
    .order("created_at", { ascending: true })

  // Mirror listChatThreads: Trengo channel subscriptions narrow the chat
  // substrate even for admins. Without this, opening a thread surfaced via
  // the list filter would still show messages from non-subscribed channels
  // for the same contact.
  const channelIds = await getUserTrengoChannelIds(userId)
  if (channelIds.length > 0) {
    query = query.or(
      `trengo_channel_id.in.(${channelIds.join(",")}),source.neq.trengo`,
    )
  }

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to load thread: ${error.message}`)

  return ((data ?? []) as unknown as RawChatRow[]).map((r) => {
    const authorKind = (r.author_kind ?? null) as ChatMessage["authorKind"]
    // Defensive HTML strip: ingest paths (webhook, polling cron) should
    // already strip at write time, but legacy rows + email tickets
    // (where the body is raw HTML with signature blocks + tracking
    // wrappers) need a fallback so the chat bubble doesn't render
    // <p><span ...> literally. Cheap on the 99% of rows that are
    // already plain text - the `<` check skips the regex pass entirely.
    const rawBody = (r.body ?? r.title ?? "").trim()
    const body = rawBody.includes("<") ? stripHtml(rawBody).trim() : rawBody
    return {
      id: r.id,
      authorKind,
      authorName: rowAuthorName(r),
      authorExternal: r.author_external ?? null,
      body,
      bodyHtml: r.body_html ?? null,
      emailSubject: r.email_subject ?? null,
      emailFromAddress: r.email_from ?? null,
      at: rowDisplayAt(r),
      source: r.source,
      status: r.status,
      isInternal: r.is_internal === true,
    }
  })
}

export type { InboxKind, InboxPriority, InboxSource, TaskStatus, UpdateStatus }
