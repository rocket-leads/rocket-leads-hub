"use client"

import { Check, AtSign } from "lucide-react"
import { cn } from "@/lib/utils"
import { InboxListRow, type RowAction } from "../inbox-list-row"
import { SourceIcon, fmtRelative } from "../chat-pane"
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
  /** Chat rows only: close/reopen the ticket. When set, a checkbox renders on
   *  the row. */
  onClose?: () => void
  /** Checkbox checked-state override. Channel tickets use archive (default);
   *  the Mentioned view passes its own per-user "mention done" state here. */
  closed?: boolean
  /** What the checkbox means — "ticket" close/reopen (round emerald) or
   *  "mention" done (square primary to-do). Defaults to "ticket". */
  checkboxKind?: "ticket" | "mention"
  users?: InboxUser[]
}

export function FeedRow({ row, active, showClient, onOpen, onAction, onClose, closed, checkboxKind = "ticket", users }: Props) {
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
  // One accent hue per row = its channel. The rail AND the unread wash use the
  // same hue so an unread row reads as a single coherent colour statement
  // (email rows no longer get a violet rail under an emerald wash). Roy 2026-07-20.
  const isWhatsApp = row.channel === "whatsapp"
  const railColor = isWhatsApp ? "bg-emerald-500" : "bg-violet-500"
  const unreadTint = isWhatsApp ? "bg-emerald-500/[0.05]" : "bg-violet-500/[0.05]"
  const isClosed = closed ?? thread.isArchived

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
      {row.unread && <span aria-hidden className={cn("absolute inset-0 pointer-events-none", unreadTint)} />}

      {/* Simplified row (Roy 2026-07-15): channel icon + contact name + message,
          date top-right, pending count + close checkbox on the right. No channel
          badge, no linked/unlinked, no duplicate name line. */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-muted-foreground/80">
          <SourceIcon thread={thread} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", row.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
            {row.title}
          </p>
          {row.preview && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{row.preview}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-xs text-muted-foreground/70 tabular-nums">{fmtRelative(row.sortAt)}</span>
          <div className="flex items-center gap-1.5">
            {row.unreadCount > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-500/15 px-1.5 text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </span>
            )}
            {onClose && checkboxKind === "mention" && (
              // Personal "mention done" to-do: SQUARE + primary hue + @ icon, so
              // it never reads as "close the ticket" (which is round + emerald).
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-pressed={isClosed}
                title={isClosed ? "Mark mention as to-do" : "Mark mention done"}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md border transition-colors",
                  isClosed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40 text-transparent hover:border-primary/60 hover:text-primary/50",
                )}
              >
                {isClosed ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <AtSign className="h-3.5 w-3.5" strokeWidth={2.5} />}
              </button>
            )}
            {onClose && checkboxKind === "ticket" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-pressed={isClosed}
                title={isClosed ? "Reopen ticket" : "Close ticket"}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
                  isClosed
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-muted-foreground/40 text-transparent hover:border-emerald-500/60 hover:text-emerald-500/40",
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
