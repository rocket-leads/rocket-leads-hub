import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { getUserTrengoChannelIds } from "@/lib/inbox/user-prefs"
import type {
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

function rowToItem(row: RawInboxRow, clientMap: Map<string, MondayClient>): InboxItem {
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
    title: row.title,
    body: row.body,
    status: row.status as UpdateStatus | TaskStatus,
    priority: row.priority,
    dueDate: row.due_date,
    source: row.source,
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
  if (filters.assignedToMe) query = query.eq("assignee_id", userId)

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

  // Visibility: skip when scoped to a specific client (the API caller has
  // already verified access to that client) or when caller is admin.
  if (!filters.clientId) {
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

  const { data, error } = await query
  if (error) throw new Error(`Failed to list inbox items: ${error.message}`)

  const clientMap = await getMondayClientMap()
  return ((data ?? []) as unknown as RawInboxRow[]).map((r) => rowToItem(r, clientMap))
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

  const clientMap = await getMondayClientMap()
  return rowToItem(row, clientMap)
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
 * Counts for the sidebar badge: unread updates assigned to me + open/in-progress
 * tasks assigned to me. Cheap — two indexed queries.
 */
export async function getInboxBadgeCounts(
  userId: string,
): Promise<{ unreadUpdates: number; openTasks: number }> {
  const supabase = await createAdminClient()

  // Snoozed tasks shouldn't ping the sidebar — that's the point of snoozing.
  // Active = snoozed_until IS NULL OR has already passed.
  const nowIso = new Date().toISOString()
  const [updatesRes, tasksRes] = await Promise.all([
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "update")
      .eq("status", "unread"),
    supabase
      .from("inbox_events")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "task")
      .in("status", ["open", "in_progress"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`),
  ])

  return {
    unreadUpdates: updatesRes.count ?? 0,
    openTasks: tasksRes.count ?? 0,
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

export type ChatThreadSummary = {
  threadKey: string
  scope: ChatScope
  source: InboxSource
  /** Display name — primary other-party (Trengo contact, Slack channel, etc). */
  primaryName: string
  /** Linked Hub client name when client_id is set on any event in the thread. */
  clientName: string | null
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
  author: { id: string; name: string | null; email: string } | null
  assignee: { id: string; name: string | null; email: string } | null
}

const CHAT_SELECT = `
  id, source, scope, thread_key, client_id, author_id, assignee_id,
  author_kind, author_external, author_name_cached, title, body, status,
  created_at, created_at_src,
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

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const channelIds = await getUserTrengoChannelIds(userId)
      const inClause = allowed.length > 0 ? `,client_id.in.(${allowed.join(",")})` : ""
      const channelClause =
        channelIds.length > 0 ? `,trengo_channel_id.in.(${channelIds.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}${channelClause}`,
      )
    }
  }

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

  const clientMap = await getMondayClientMap()

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
    threads.push({
      threadKey,
      scope: latest.scope === "external" ? "external" : "internal",
      source: latest.source,
      primaryName,
      clientName,
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

export async function getChatThreadMessages(
  threadKey: string,
  userId: string,
  role: Role,
): Promise<ChatMessage[]> {
  const supabase = await createAdminClient()

  let query = supabase
    .from("inbox_events")
    .select(CHAT_SELECT)
    .eq("thread_key", threadKey)
    .order("created_at", { ascending: true })

  if (role !== "admin") {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const channelIds = await getUserTrengoChannelIds(userId)
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
    }
  })
}

export type { InboxKind, InboxPriority, InboxSource, TaskStatus, UpdateStatus }
