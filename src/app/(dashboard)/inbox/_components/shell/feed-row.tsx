"use client"

import { cn } from "@/lib/utils"
import { InboxListRow, type RowAction } from "../inbox-list-row"
import { SourceIcon, ChannelBadge, fmtRelative } from "../chat-pane"
import type { InboxUser, FeedRow } from "./types"

/**
 * One row in the unified feed. Task/Update rows reuse the existing
 * `InboxListRow` verbatim (same rail, actions, unread treatment as the rest of
 * the Hub). Chat rows render a compact card built from the already-exported
 * chat primitives (`SourceIcon` / `ChannelBadge` / `fmtRelative`) so a
 * WhatsApp/email thread reads as a peer of a task without dragging the whole
 * ChatPane in.
 */
type Props = {
  row: FeedRow
  active: boolean
  showClient: boolean
  onOpen: () => void
  onAction?: (action: RowAction) => void
  users?: InboxUser[]
}

export function FeedRow({ row, active, showClient, onOpen, onAction, users }: Props) {
  if (row.kind !== "chat" && row.item) {
    return (
      <InboxListRow
        item={row.item}
        showClient={showClient}
        onClick={onOpen}
        onAction={onAction}
        users={users}
        keyboardFocused={active}
      />
    )
  }

  const thread = row.thread
  if (!thread) return null
  const railColor = row.channel === "whatsapp" ? "bg-emerald-500" : "bg-violet-500"

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      data-inbox-row-id={row.id}
      className={cn(
        "group relative w-full text-left rounded-xl border border-border/60 bg-card transition-all pl-6 pr-5 py-3.5 cursor-pointer overflow-hidden",
        "hover:border-border hover:bg-muted/30 hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.04)] duration-150",
        active && "ring-2 ring-violet-500/60 bg-violet-500/[0.04]",
      )}
    >
      <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-1", railColor, !row.unread && "opacity-40")} />
      {row.unread && <span aria-hidden className="absolute inset-0 bg-emerald-500/[0.04] pointer-events-none" />}

      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground/80">
          <SourceIcon thread={thread} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("truncate text-sm", row.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
              {row.title}
            </p>
            <ChannelBadge thread={thread} />
            <span className="ml-auto shrink-0 text-xs text-muted-foreground/70 tabular-nums">
              {fmtRelative(row.sortAt)}
            </span>
          </div>
          {row.preview && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{row.preview}</p>
          )}
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/60">
            <span className="truncate">{thread.primaryName}</span>
            {showClient && thread.clientName && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{thread.clientName}</span>
              </>
            )}
            {showClient && !thread.clientName && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                Unlinked
              </span>
            )}
          </div>
        </div>
        {row.unreadCount > 0 && (
          <span className="mt-0.5 inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 px-1.5 text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {row.unreadCount > 99 ? "99+" : row.unreadCount}
          </span>
        )}
      </div>
    </div>
  )
}
