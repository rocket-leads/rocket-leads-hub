"use client"

import { useMemo } from "react"
import { Circle, LayoutList, Inbox as InboxIcon, Loader2 } from "lucide-react"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import { FeedRow } from "./feed-row"
import type { RowAction } from "../inbox-list-row"
import type { InboxUser, FeedRow as FeedRowType } from "./types"

/** Global secondary filter over the merged feed. v1 keeps it to All / Unread -
 *  snooze/archive semantics differ across kinds (chat-only today) so they're
 *  deferred rather than shown as no-ops on tasks/updates. */
export type FeedFilter = "all" | "unread"

type Props = {
  rows: FeedRowType[]
  loading: boolean
  activeId: string | null
  showClient: boolean
  filter: FeedFilter
  onFilterChange: (f: FeedFilter) => void
  onOpen: (row: FeedRowType) => void
  onAction: (row: FeedRowType, action: RowAction) => void
  users?: InboxUser[]
  /** Rendered under the empty state when the feed is empty (e.g. a hint that
   *  no channels are selected, or a link to channel settings). */
  emptyHint?: React.ReactNode
}

export function UnifiedFeed({
  rows,
  loading,
  activeId,
  showClient,
  filter,
  onFilterChange,
  onOpen,
  onAction,
  users,
  emptyHint,
}: Props) {
  const visible = useMemo(
    () => (filter === "unread" ? rows.filter((r) => r.unread) : rows),
    [rows, filter],
  )
  const unreadCount = useMemo(() => rows.filter((r) => r.unread).length, [rows])

  const filterTabs: TopTab<FeedFilter>[] = [
    { id: "unread", label: "Unread", icon: Circle, count: unreadCount, accent: "primary" },
    { id: "all", label: "All", icon: LayoutList },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TopTabs tabs={filterTabs} value={filter} onChange={onFilterChange} />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground/70">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
              <InboxIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {filter === "unread" ? "Nothing unread" : "Nothing here"}
            </p>
            {emptyHint && <div className="text-xs text-muted-foreground/70">{emptyHint}</div>}
          </div>
        ) : (
          visible.map((row) => (
            <FeedRow
              key={`${row.kind}:${row.id}`}
              row={row}
              active={row.id === activeId}
              showClient={showClient}
              onOpen={() => onOpen(row)}
              onAction={(action) => onAction(row, action)}
              users={users}
            />
          ))
        )}
      </div>

      <p className={cn("shrink-0 text-center text-xs text-muted-foreground/50", visible.length === 0 && "hidden")}>
        {visible.length} {visible.length === 1 ? "item" : "items"}
      </p>
    </div>
  )
}
