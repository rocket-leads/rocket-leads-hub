/**
 * Shared types + pure helpers for the 3-pane unified inbox shell.
 *
 * These types were lifted out of `inbox-view.tsx` so the new shell components
 * (and the legacy view during migration) can share one canonical definition
 * without a circular import back into the monolith. `inbox-view.tsx` and
 * `chat-pane.tsx` re-export / import from here; nothing in this file imports
 * from those files, keeping the dependency edge one-directional.
 */
import type { InboxItem } from "@/types/inbox"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"

export type InboxUser = { id: string; name: string | null; email: string; role: string }
export type InboxClientOption = {
  id: string
  name: string
  /** Whether the client is currently live (Hub-canonical status). The composer
   *  client picker pins live ones to the top so AMs see their active book
   *  first instead of having to type to find them. */
  isLive?: boolean
}
export type CurrentUser = { id: string; name: string; role: string }

export type LockedClient = InboxClientOption & {
  /** Trengo contact ID - if present, the client's chat channels render. */
  trengoContactId?: string | null
  /** Role-based gate on the WhatsApp / Email channels. */
  canViewCommunication?: boolean
}

/**
 * The four rail channels. The unified feed interleaves rows tagged with one of
 * these; the rail toggles which channels are visible. Chat threads split into
 * `whatsapp` / `email` by their resolved `channelKind`; `other`/null Trengo
 * threads and Slack `internal` threads have no rail home and are dropped from
 * the feed (the rail stays an honest 4-up).
 */
export type FeedChannel = "tasks" | "updates" | "whatsapp" | "email"

export const ALL_CHANNELS: readonly FeedChannel[] = ["tasks", "updates", "whatsapp", "email"] as const

/** One unified feed row. Discriminated by `kind`: task/update carry `item`,
 *  chat carries `thread`. `channel` is precomputed so the feed filter and the
 *  rail badges agree on which bucket a row falls in. */
export type FeedRow = {
  /** inbox_events.id for task/update, threadKey for chat. Stable per row. */
  id: string
  channel: FeedChannel
  kind: "task" | "update" | "chat"
  /** ISO timestamp used for the single merged sort (newest first). */
  sortAt: string
  unread: boolean
  /** Chat unread message count; 0/1 for task/update (drives the dot only). */
  unreadCount: number
  title: string
  preview: string | null
  clientName: string | null
  item?: InboxItem
  thread?: ChatThreadSummary
}

/** Task "unread" ≈ still open; Update unread = literally unread. */
function itemIsUnread(item: InboxItem): boolean {
  if (item.kind === "update") return item.status === "unread"
  return item.status === "open"
}

/** Map a task/update InboxItem to a feed row. Returns null for the "chat" kind
 *  (chat flows through threads, not the item list). */
export function itemToFeedRow(item: InboxItem): FeedRow | null {
  if (item.kind === "chat") return null
  const channel: FeedChannel = item.kind === "task" ? "tasks" : "updates"
  return {
    id: item.id,
    channel,
    kind: item.kind,
    sortAt: item.updatedAt,
    unread: itemIsUnread(item),
    unreadCount: itemIsUnread(item) ? 1 : 0,
    title: item.title,
    preview: item.body,
    clientName: item.clientName,
    item,
  }
}

/** Map a chat thread to a feed row. Returns null when the thread's channel has
 *  no rail home (other / null / Slack) so it drops out of the 4-channel feed. */
export function threadToFeedRow(thread: ChatThreadSummary): FeedRow | null {
  let channel: FeedChannel
  if (thread.channelKind === "whatsapp") channel = "whatsapp"
  else if (thread.channelKind === "email") channel = "email"
  else return null
  return {
    id: thread.threadKey,
    channel,
    kind: "chat",
    sortAt: thread.latestAt,
    // "Unread" here means "awaiting our reply" - client messages since our last
    // send (Roy 2026-07-15), not the raw unread-status count.
    unread: thread.pendingCount > 0,
    unreadCount: thread.pendingCount,
    // The row headlines the Trengo contact name (Roy's simplified row: icon +
    // name + date + preview, nothing else).
    title: thread.primaryName,
    preview: thread.latestPreview,
    clientName: thread.clientName,
    thread,
  }
}

/**
 * Build the merged, channel-filtered, newest-first feed from the three data
 * sources. Pure - no fetching. ISO timestamps sort lexicographically, matching
 * the existing thread sort in chat-pane. `selected` is the set of currently
 * checked rail channels; a row survives only if its channel is checked.
 */
export function mergeFeed(
  items: InboxItem[],
  threads: ChatThreadSummary[],
  selected: ReadonlySet<FeedChannel>,
): FeedRow[] {
  const rows: FeedRow[] = []
  for (const it of items) {
    const row = itemToFeedRow(it)
    if (row && selected.has(row.channel)) rows.push(row)
  }
  for (const th of threads) {
    const row = threadToFeedRow(th)
    if (row && selected.has(row.channel)) rows.push(row)
  }
  rows.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
  return rows
}

/** Parse the `?channels=` URL param into a channel set. Absent / empty / all
 *  garbage falls back to all-on so a bad link never yields a blank feed. */
export function parseChannelsParam(raw: string | null): Set<FeedChannel> {
  if (!raw) return new Set(ALL_CHANNELS)
  const parts = raw.split(",").map((s) => s.trim())
  const valid = parts.filter((p): p is FeedChannel =>
    (ALL_CHANNELS as readonly string[]).includes(p),
  )
  return valid.length > 0 ? new Set(valid) : new Set(ALL_CHANNELS)
}

/** Serialize a channel set back to the stable `tasks,updates,whatsapp,email`
 *  order for the URL. Returns null when all four are on (the default) so the
 *  param drops off the URL entirely in the common case. */
export function serializeChannelsParam(selected: ReadonlySet<FeedChannel>): string | null {
  const on = ALL_CHANNELS.filter((c) => selected.has(c))
  if (on.length === ALL_CHANNELS.length) return null
  return on.join(",")
}
