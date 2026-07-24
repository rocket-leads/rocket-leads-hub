"use client"

import { Check, AtSign } from "lucide-react"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
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
  /** Channel-ticket multi-select. When provided, the LEFT channel icon doubles
   *  as a select checkbox (hover reveals it; click toggles) and the right close
   *  bolletje is dropped — closing happens in bulk from the selection bar.
   *  Roy 2026-07-21. `onToggleSelect` gets the click event so the shell can do
   *  Shift-range selection. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (e: React.MouseEvent) => void
  users?: InboxUser[]
}

export function FeedRow({ row, active, showClient, onOpen, onAction, onClose, closed, checkboxKind = "ticket", selectable, selected, onToggleSelect, users }: Props) {
  const locale = useLocale()
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
          date top-right, pending count on the right. Channel view: the left
          icon doubles as a multi-select checkbox (Roy 2026-07-21). No channel
          badge, no linked/unlinked, no duplicate name line. */}
      <div className="flex items-start gap-3">
        {selectable ? (
          // Left control: vertically centred, shows the channel icon by default
          // and morphs into a checkbox on hover / when selected. Click selects
          // (Shift-click range-selects via the shell) instead of opening.
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(e)
            }}
            aria-pressed={selected}
            aria-label="Select ticket"
            className="relative flex h-6 w-6 shrink-0 items-center justify-center self-center"
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all",
                selected
                  ? "border-primary bg-primary text-primary-foreground opacity-100"
                  : "border-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:border-foreground",
              )}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/80 transition-opacity",
                selected ? "opacity-0" : "opacity-100 group-hover:opacity-0",
              )}
            >
              <SourceIcon thread={thread} />
            </span>
          </button>
        ) : (
          <span className="mt-0.5 shrink-0 text-muted-foreground/80">
            <SourceIcon thread={thread} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm", row.unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
            {row.title}
          </p>
          {row.preview && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{row.preview}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-[11px] text-muted-foreground/60 tabular-nums">{fmtRelative(row.sortAt)}</span>
          <div className="flex items-center gap-1.5">
            {row.unreadCount > 0 && (
              <span className="nav-badge">
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </span>
            )}
            {/* Mentioned view keeps its per-user "mention done" checkbox on the
                right (square + primary + @). Channel tickets no longer have a
                right close bolletje — they close in bulk via the selection bar. */}
            {!selectable && onClose && checkboxKind === "mention" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                aria-pressed={isClosed}
                title={isClosed ? t("inbox.shell.checkbox.mention_todo", locale) : t("inbox.shell.checkbox.mention_done", locale)}
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
          </div>
        </div>
      </div>
    </div>
  )
}
