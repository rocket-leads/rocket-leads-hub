"use client"

import { Inbox as InboxIcon, Check } from "lucide-react"
import type { TopTab } from "@/components/ui/top-tabs"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { cn } from "@/lib/utils"
import { ChipTabs } from "./chip-tabs"
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
  /** What the per-row checkbox MEANS: "ticket" (close/reopen the conversation,
   *  round emerald check) or "mention" (a personal mark-mention-done to-do,
   *  square primary check). Disambiguates the two axes that used to share one
   *  icon. Defaults to "ticket". */
  checkboxKind?: "ticket" | "mention"
  /** Channel-ticket multi-select: makes the left icon a select checkbox.
   *  `onToggleSelect` receives the click event (for Shift-range). */
  selectable?: boolean
  selectedOf?: (row: FeedRowType) => boolean
  onToggleSelect?: (row: FeedRowType, e: React.MouseEvent) => void
  /** Tri-state select-all header over the visible rows (Trengo-style). */
  selectAllState?: "none" | "some" | "all"
  onToggleSelectAll?: () => void
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
  checkboxKind,
  selectable,
  selectedOf,
  onToggleSelect,
  selectAllState = "none",
  onToggleSelectAll,
  users,
  emptyHint,
}: Props<T>) {
  const locale = useLocale()
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ChipTabs tabs={filterTabs} value={filterValue} onChange={onFilterChange} />

      {/* Select-all header: only appears once ≥1 ticket is selected (Roy
          2026-07-22: permanent = ruis). Then one click extends to every visible
          ticket in this tab; click again (state "all") clears + hides it. */}
      {selectable && onToggleSelectAll && selectAllState !== "none" && (
        <button
          type="button"
          onClick={onToggleSelectAll}
          role="checkbox"
          aria-checked={selectAllState === "all" ? true : selectAllState === "some" ? "mixed" : false}
          className="flex shrink-0 items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all",
              selectAllState === "all"
                ? "border-primary bg-primary text-primary-foreground"
                : selectAllState === "some"
                  ? "border-primary bg-primary/25"
                  : "border-muted-foreground/40",
            )}
          >
            {selectAllState === "all" && <Check className="h-3 w-3" strokeWidth={3} />}
            {selectAllState === "some" && <span className="block h-0.5 w-2.5 rounded-sm bg-primary" />}
          </span>
          {t(selectAllState === "all" ? "inbox.shell.bulk.deselect_all" : "inbox.shell.bulk.select_all", locale)}
        </button>
      )}

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {loading && rows.length === 0 ? (
          <InboxRowSkeletonList />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
              <InboxIcon className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium text-foreground">{t("inbox.shell.feed.empty", locale)}</p>
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
              checkboxKind={checkboxKind}
              selectable={selectable && row.kind === "chat"}
              selected={selectedOf ? selectedOf(row) : undefined}
              onToggleSelect={onToggleSelect ? (e) => onToggleSelect(row, e) : undefined}
              users={users}
            />
          ))
        )}
      </div>

      <p className={cn("shrink-0 text-center text-xs text-muted-foreground/50", rows.length === 0 && "hidden")}>
        {rows.length} {rows.length === 1 ? t("inbox.shell.feed.item", locale) : t("inbox.shell.feed.items", locale)}
      </p>
    </div>
  )
}
