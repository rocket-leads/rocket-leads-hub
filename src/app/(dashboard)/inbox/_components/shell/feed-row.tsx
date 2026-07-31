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
  /** Event is optional: chat rows pass it for Shift-range selection; internal
   *  task/update rows toggle without one. */
  onToggleSelect?: (e?: React.MouseEvent) => void
  users?: InboxUser[]
  /** Signed-in user id. Lets task/update rows detect delegated items
   *  (author = me, assignee ≠ me) and show the delivery signal. */
  currentUserId?: string
}

/** Drop leading forwarded/quote boilerplate so a no-subject email's fallback
 *  preview shows real content, not "Begin forwarded message:" etc. Only used
 *  for the rare subject-less email row. Roy 2026-07-29. */
function cleanEmailPreview(text: string | null): string | null {
  if (!text) return text
  const cleaned = text
    .replace(
      /^\s*(begin forwarded message:|-{2,}\s*forwarded message\s*-{2,}|on\s.+?\swrote:)\s*/i,
      "",
    )
    .trim()
  return cleaned || text.trim()
}

export function FeedRow({ row, active, showClient, onOpen, onAction, onClose, closed, checkboxKind = "ticket", selectable, selected, onToggleSelect, users, currentUserId }: Props) {
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
        currentUserId={currentUserId}
        selected={selected}
        onToggleSelect={selectable && onToggleSelect ? () => onToggleSelect() : undefined}
      />
    )
  }

  const thread = row.thread
  if (!thread) return null
  const isClosed = closed ?? thread.isArchived

  // 187N Chats-style row: compact, hairline-separated, no per-row card/rail. The
  // channel avatar carries the medium; unread = bold name + a small filled
  // badge; active = a soft purple wash (no heavy ring). Roy 2026-07-24.
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
        "group relative w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors",
        active ? "bg-primary/[0.07]" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2.5">
        {selectable ? (
          // Channel avatar that morphs into a select checkbox on hover / when
          // selected. Click selects (Shift-click range-selects via the shell).
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(e)
            }}
            aria-pressed={selected}
            aria-label="Select ticket"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center self-start"
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
                "pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-muted/70 text-muted-foreground/80 transition-opacity",
                selected ? "opacity-0" : "opacity-100 group-hover:opacity-0",
              )}
            >
              <SourceIcon thread={thread} />
            </span>
          </button>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg bg-muted/70 text-muted-foreground/80">
            <SourceIcon thread={thread} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className={cn("min-w-0 truncate text-[13.5px]", row.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85")}>
              {row.title}
            </p>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/45">
              {fmtRelative(row.sortAt)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2">
            {(() => {
              // Email rows headline the SUBJECT (the "what is this" signal),
              // falling back to a boilerplate-cleaned body preview when a mail
              // carries no subject. WhatsApp/other keep the body preview.
              // Roy 2026-07-29.
              const secondLine =
                row.channel === "email"
                  ? row.subject || cleanEmailPreview(row.preview)
                  : row.preview
              return secondLine ? (
                <p
                  className={cn(
                    "min-w-0 flex-1 truncate text-[12.5px]",
                    row.channel === "email"
                      ? "text-foreground/70"
                      : "text-muted-foreground/70",
                  )}
                >
                  {secondLine}
                </p>
              ) : (
                <span className="flex-1" />
              )
            })()}
            {row.unreadCount > 0 && (
              <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground">
                {row.unreadCount > 99 ? "99+" : row.unreadCount}
              </span>
            )}
            {/* Mentioned view keeps its per-user "mention done" checkbox on the
                right. Channel tickets close in bulk via the selection bar. */}
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
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isClosed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40 text-transparent hover:border-primary/60 hover:text-primary/50",
                )}
              >
                {isClosed ? <Check className="h-3 w-3" strokeWidth={3} /> : <AtSign className="h-3 w-3" strokeWidth={2.5} />}
              </button>
            )}
          </div>
          {/* Channel name (e.g. "Danny WhatsApp") in a very small muted line so
              you can tell at a glance which inbox a ticket came from — for both
              WhatsApp and email rows. Roy 2026-07-30. */}
          {thread.channelName && (
            <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground/40">
              {thread.channelName}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
