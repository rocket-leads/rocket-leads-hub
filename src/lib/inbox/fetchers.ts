import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
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
  source: InboxSource
  source_ref: Record<string, unknown> | null
  monday_update_id: string | null
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
  return {
    id: row.id,
    kind: row.kind,
    clientId: row.client_id,
    clientName: clientMap.get(row.client_id)?.name ?? "(unknown)",
    authorId: row.author_id,
    authorName: row.author?.name ?? row.author?.email ?? "Unknown",
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    commentCount: row.inbox_comments?.[0]?.count ?? 0,
  }
}

const ITEM_SELECT = `
  id, kind, client_id, author_id, assignee_id, title, body, status, priority,
  due_date, source, source_ref, monday_update_id, created_at, updated_at, completed_at,
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
    .from("inbox_items")
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

  // Visibility: skip when scoped to a specific client (the API caller has
  // already verified access to that client) or when caller is admin.
  if (!filters.clientId) {
    const allowed = await getAllowedClientIds(userId, role)
    if (allowed !== "all") {
      const ids = allowed
      // Always allow author/assignee on the item; otherwise require client access.
      // PostgREST `or` with nested `in.(...)` — IDs are numeric Monday strings so
      // no quoting is needed.
      const inClause = ids.length > 0 ? `,client_id.in.(${ids.join(",")})` : ""
      query = query.or(
        `author_id.eq.${userId},assignee_id.eq.${userId}${inClause}`,
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
    .from("inbox_items")
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
      if (!inAllowed) return null
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

  const [updatesRes, tasksRes] = await Promise.all([
    supabase
      .from("inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "update")
      .eq("status", "unread"),
    supabase
      .from("inbox_items")
      .select("id", { count: "exact", head: true })
      .eq("assignee_id", userId)
      .eq("kind", "task")
      .in("status", ["open", "in_progress"]),
  ])

  return {
    unreadUpdates: updatesRes.count ?? 0,
    openTasks: tasksRes.count ?? 0,
  }
}

export type { InboxKind, InboxPriority, InboxSource, TaskStatus, UpdateStatus }
