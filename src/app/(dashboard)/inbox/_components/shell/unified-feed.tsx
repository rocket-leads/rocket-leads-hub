"use client"

import { Inbox as InboxIcon } from "lucide-react"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import { FeedRow } from "./feed-row"
import { InboxRowSkeletonList } from "./row-skeleton"
import type { RowAction } from "../inbox-list-row"
import type { InboxUser, FeedRow as FeedRowType } from "./types"

/** Kept for the internal update feed's All/Unread switch. */
export type FeedFilter = "all" | "unread"

/**
 * The external ticket feed: a controlled tab bar (Open / Assigned / Closed) +
 * the list of rows for the active tab. Filtering is done by the parent (which
 * owns the ticket-state derivation), so this component just renders the rows it
 * is given plus the provided tabs.
 */
type Props<T extends string> = {
  rows: FeedRowType[]
  loading: boolean
  activeId: string | null
  showClient: boolean
  filterTabs: TopTab<T>[]
  filterValue: T
  onFilterChange: (v: T) => void
  onOpen: (row: FeedRowType) => void
  onAction: (row: FeedRowType, action: RowAction) => void
  /** Close/reopen a chat ticket (renders the checkbox on chat rows). */
  onCloseRow?: (row: FeedRowType) => void
  /** Per-row checkbox checked-state (defaults to the thread's archived flag).
   *  The Mentioned view supplies "mention done" here instead. */
  closedOf?: (row: FeedRowType) => boolean
  users?: InboxUser[]
  emptyHint?: React.ReactNode
}

export function UnifiedFeed<T extends string>({
  rows,
  loading,
  activeId,
  showClient,
  filterTabs,
  filterValue,
  onFilterChange,
  onOpen,
  onAction,
  onCloseRow,
  closedOf,
  users,
  emptyHint,
}: Props<T>) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <TopTabs tabs={filterTabs} value={filterValue} onChange={onFilterChange} />

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {loading && rows.length === 0 ? (
          <InboxRowSkeletonList />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
              <InboxIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">Nothing here</p>
            {emptyHint && <div className="text-xs text-muted-foreground/70">{emptyHint}</div>}
          </div>
        ) : (
          rows.map((row) => (
            <FeedRow
              key={`${row.kind}:${row.id}`}
              row={row}
              active={row.id === activeId}
              showClient={showClient}
              onOpen={() => onOpen(row)}
              onAction={(action) => onAction(row, action)}
              onClose={onCloseRow && row.kind === "chat" ? () => onCloseRow(row) : undefined}
              closed={closedOf ? closedOf(row) : undefined}
              users={users}
            />
          ))
        )}
      </div>

      <p className={cn("shrink-0 text-center text-xs text-muted-foreground/50", rows.length === 0 && "hidden")}>
        {rows.length} {rows.length === 1 ? "item" : "items"}
      </p>
    </div>
  )
}
