import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { fetchTrengoChannels } from "@/lib/integrations/trengo"
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
  /** External author identifier — the Trengo contact id / Slack user id /
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
   *  - 'active'  (default for active filters) — hide currently snoozed items
   *  - 'snoozed' — show ONLY currently snoozed items
   *  - 'all'     — return both, ignoring snooze state
   */
  snoozed?: "active" | "snoozed" | "all"
}

/**
 * Build the visibility filter set for a user.
 *
 * Returns "all" for admins (no client filter applied), or the list of Monday
 * item IDs they can see — which is derived from the cached Monday boards plus
 * their user_column_mappings (same logic as Watch List / Clients overview).
 *
 * Items where the user is author or assignee are always visible regardless
 * of this list — that's enforced at query time.
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
 * the cache is cold and Monday is unreachable — names will render as
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
  // Prefer author_name_cached when set — webhook ingesters store the real
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
  // instead of the "(unknown)" fallback — the AM should know to link this
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
  // time (since 2026-05-05), but historical rows from before that fix —
  // and any future ingest path we forget to wire — would otherwise dump
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
  due_date, snoozed_until, source, source_ref, monday_update_id, trengo_channel_id,
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

  // Tasks/Updates are strictly "for me" — assignee-driven regardless of
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
  // exclusively. Promotions still happen — they're just promotions
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

  // Snooze handling — defaults to hiding snoozed items in "active" task views.
  // PostgREST `or` lets us express "snoozed_until IS NULL OR snoozed_until <= now".
  const snoozeMode = filters.snoozed ?? (filters.kind === "task" ? "active" : "all")
  if (snoozeMode === "active") {
    const nowIso = new Date().toISOString()
    query = query.or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
  } else if (snoozeMode === "snoozed") {
    const nowIso = new Date().toISOString()
    query = query.gt("snoozed_until", nowIso)
  }

  // Visibility for non-Tasks/Updates queries (chat substrate, mixed views,
  // /api/inbox without a kind param). Skip when scoped to a specific client
  // — the API caller already verified that access — or when caller is admin.
  //
  // Tasks/Updates already enforce the strict assignee filter above and don't
  // need this broader OR clause. Keeping it would silently re-open the
  // self-authored / "anything on my clients" leak we just closed.
  const isTaskOrUpdate = filters.kind === "task" || filters.kind === "update"
  if (!filters.clientId && !isTaskOrUpdate) {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const ids = allowed
      const channelIds = await getUserTrengoChannelIds(userId)
      // Always allow author/assignee on the item; otherwise require client access
      // OR a Trengo channel subscription match. PostgREST `or` with nested
      // `in.(...)` — IDs are numeric so no quoting is needed.
      const inClause = ids.length > 0 ? `,client_id.in.(${ids.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  // Unassigned-only Trengo filter — applies to admins and non-admins alike.
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

  // Unassigned-only Trengo gate — applies to admins and non-admins alike.
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
 * access + participant fallback) — counting messages, not threads, so the
 * sidebar number lines up with the per-thread unread counts. Snoozed tasks
 * are excluded to keep the badge silent while the user has parked them.
 */
export async function getInboxBadgeCounts(
  userId: string,
  role: Role = "member",
): Promise<{ unreadUpdates: number; openTasks: number; unreadChats: number }> {
  const supabase = await createAdminClient()

  // Snoozed tasks shouldn't ping the sidebar — that's the point of snoozing.
  // Active = snoozed_until IS NULL OR has already passed.
  const nowIso = new Date().toISOString()

  // Build the chat visibility query in the same shape as listChatThreads:
  // channel-subscription narrowing always applies (admins included), then
  // role-based access on top for non-admins.
  let chatQuery = supabase
    .from("inbox_events")
    .select("id", { count: "exact", head: true })
    .not("thread_key", "is", null)
    .eq("status", "unread")

  const channelIds = await getUserTrengoChannelIds(userId)
  if (channelIds.length > 0) {
    chatQuery = chatQuery.or(
      `trengo_channel_id.in.(${channelIds.join(",")}),source.neq.trengo`,
    )
  }

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      chatQuery = chatQuery.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

  // Unassigned-only Trengo gate — exclude tickets currently claimed in Trengo
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
      // Same de-dup as listInboxItems — chat-substrate events are counted
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

  return {
    unreadUpdates: updatesRes.count ?? 0,
    openTasks: tasksRes.count ?? 0,
    unreadChats: chatsRes.count ?? 0,
  }
}

// --- Chat substrate fetchers (Phase C.7) ----------------------------------
//
// Inbox events that carry a thread_key are part of the chat substrate —
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
 *  We only differentiate WhatsApp vs email today — voice / chat / social are
 *  bucketed under `other` until we surface them. Null when the thread isn't
 *  Trengo (Slack threads ride a separate icon path). */
export type ChatChannelKind = "whatsapp" | "email" | "other" | null

export type ChatThreadSummary = {
  threadKey: string
  scope: ChatScope
  source: InboxSource
  /** Display name — primary other-party (Trengo contact, Slack channel, etc). */
  primaryName: string
  /** Linked Hub client name when client_id is set on any event in the thread. */
  clientName: string | null
  /** WhatsApp / email / other — drives the icon shown next to the thread.
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
  /** Most recent message timestamp (uses created_at_src when available). */
  latestAt: string
  /** Latest event id — used by the reply UI to derive source/thread metadata. */
  latestEventId: string
  totalCount: number
  unreadCount: number
}

export type ChatMessage = {
  id: string
  authorKind: "rl_team" | "client" | "external" | null
  authorName: string
  authorExternal: string | null
  body: string
  /** Display-time timestamp — created_at_src when the source provided one. */
  at: string
  source: InboxSource
  status: string
  /** Team-only annotation (Trengo "internal note") — rendered as a yellow
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
  status: string
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
  author_kind, author_external, author_name_cached, title, body, status,
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
      const t = (c.type ?? "").toUpperCase()
      let kind: ChatChannelKind = "other"
      if (t === "WA_BUSINESS" || t === "WHATSAPP" || t.includes("WHATSAPP")) {
        kind = "whatsapp"
      } else if (t === "EMAIL") {
        kind = "email"
      }
      // Mirror the display logic from /api/integrations/trengo/channels:
      // prefer `title` (Trengo sidebar label), fall back to display_name and
      // finally `Channel <id>` so the UI never shows a blank.
      const title = typeof c.title === "string" ? c.title.trim() : ""
      const display = typeof c.display_name === "string" ? c.display_name.trim() : ""
      const name =
        title && title.toLowerCase() !== t.toLowerCase()
          ? title
          : display || `Channel ${c.id}`
      map.set(c.id, { kind, name })
    }
  } catch {
    // If Trengo is briefly unreachable, the chat list still renders without
    // channel decoration — falling back to the generic chat icon.
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
    // Cap the raw row pull — threads with hundreds of messages still surface
    // because we group post-hoc. 1k is generous for now.
    .limit(1000)

  // Trengo channel subscriptions ALWAYS narrow the Client Inbox down to the
  // user's chosen channels — applies to admins too. Without this, an admin
  // sees every Trengo conversation in the workspace regardless of which
  // channels they actually want to follow. Non-Trengo events bypass this
  // filter via `source.neq.trengo`.
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

  // Unassigned-only Trengo gate. Tickets claimed in Trengo leave the Hub.
  query = query.or(
    `trengo_assignee_user_id.is.null,source.neq.trengo`,
  )

  const { data, error } = await query
  if (error) throw new Error(`Failed to list chat threads: ${error.message}`)

  const rows = ((data ?? []) as unknown as RawChatRow[]).filter((r) => r.thread_key)

  // Group by thread_key. Newest event wins for the summary fields since rows
  // are already ordered by created_at DESC.
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
  // assignee column existed carry NULL — without this pass, those threads
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
    const primaryName = deriveThreadName(threadKey, fallbackName)
    const clientName = latest.client_id
      ? clientMap.get(latest.client_id)?.name ?? null
      : null
    const previewSrc = latest.body ?? latest.title ?? ""
    const latestPreview =
      previewSrc.length > 120 ? previewSrc.slice(0, 120) + "…" : previewSrc
    const unreadCount = threadRows.filter((r) => r.status === "unread").length

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
    }

    threads.push({
      threadKey,
      scope: latest.scope === "external" ? "external" : "internal",
      source: latest.source,
      primaryName,
      clientName,
      channelKind,
      channelName,
      trengoChannelId,
      latestPreview,
      latestAt: rowDisplayAt(latest),
      latestEventId: latest.id,
      totalCount: threadRows.length,
      unreadCount,
    })
  }

  threads.sort((a, b) => b.latestAt.localeCompare(a.latestAt))
  return threads
}

/**
 * Mark every unread chat event in a thread as read for the calling user.
 *
 * We only flip rows the user is actually allowed to see — the visibility
 * filter mirrors `getChatThreadMessages` (channel subscription + client
 * access + participant fallback). Pre-fetching the event ids first keeps the
 * UPDATE simple and avoids any chance of writing through a broken visibility
 * filter — same pattern we use on the thread fetch.
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
  // to mark it read — they shouldn't even be seeing it. Cheap guard.
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
 * Mark a chat thread "unread" — flip the most recent visible event back to
 * status='unread' so the thread shows up as unread in the list and bumps the
 * sidebar badge by one. We only touch the latest event (not every read row in
 * the thread) because "unread" is a presentation signal, not a per-message
 * archival state — bringing one event back is enough for the thread to surface
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

  // Same claimed-ticket gate as markChatThreadRead — a Trengo-claimed thread
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

export async function getChatThreadMessages(
  threadKey: string,
  userId: string,
  role: Role,
): Promise<ChatMessage[]> {
  const supabase = await createAdminClient()

  // Hide message history once the Trengo ticket has been claimed by anyone.
  // Same reasoning as listChatThreads — the Hub doesn't show owned tickets.
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
    return {
      id: r.id,
      authorKind,
      authorName: rowAuthorName(r),
      authorExternal: r.author_external ?? null,
      body: (r.body ?? r.title ?? "").trim(),
      at: rowDisplayAt(r),
      source: r.source,
      status: r.status,
      isInternal: r.is_internal === true,
    }
  })
}

export type { InboxKind, InboxPriority, InboxSource, TaskStatus, UpdateStatus }
