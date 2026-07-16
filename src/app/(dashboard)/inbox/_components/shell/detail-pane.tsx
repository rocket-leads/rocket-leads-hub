"use client"

import { useEffect, useState } from "react"
import { Inbox as InboxIcon, Circle, User, Check } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { cn } from "@/lib/utils"
import { ItemDetailDialog } from "../item-detail-dialog"
import { ThreadView } from "../chat-pane"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import type { CurrentUser, InboxUser, FeedRow } from "./types"

type TicketState = "open" | "assigned" | "closed"
type NoteMentions = { done: Record<string, boolean>; toggle: (noteMsgId: string) => void }

/** The header state buttons: each ticket shows the two states it's NOT in, so
 *  you can always move it either direction (Roy 2026-07-15). */
const STATE_META: Record<TicketState, { icon: typeof Circle; title: string; className: string }> = {
  open: {
    icon: Circle,
    title: "Move to Open",
    className: "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted",
  },
  assigned: {
    icon: User,
    title: "Pick up (Assigned)",
    className: "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted",
  },
  closed: {
    icon: Check,
    title: "Close ticket",
    className: "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600",
  },
}

function StateButton({ target, onClick }: { target: TicketState; onClick: () => void }) {
  const meta = STATE_META[target]
  const Icon = meta.icon
  return (
    <button
      type="button"
      onClick={onClick}
      title={meta.title}
      aria-label={meta.title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border shadow-sm transition-colors",
        meta.className,
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={target === "closed" ? 3 : 2} />
    </button>
  )
}

type Props = {
  row: FeedRow | null
  currentUser: CurrentUser
  users: InboxUser[]
  onClose: () => void
  /** Refetch the feed after an item mutation (status/assignee/rename/delete). */
  onChanged: () => void
  /** Invalidate the thread + feed after a reply lands. */
  onReplied: () => void
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  /** Current ticket state + setter for the 3-state header buttons. */
  ticketState?: TicketState
  onSetState?: (target: TicketState) => void
  /** Mentioned view: the header is a single Trengo-style To-do/Done toggle
   *  (Open ⇄ Gesloten) instead of the 3-state Open/Assigned/Closed buttons.
   *  Marking done flips only MY mention rows, never the shared thread. */
  mentioned?: boolean
  /** Per-note mention state: `done[noteMsgId]` tells the conversation which
   *  internal notes carry a mention for me (so it can draw a checkbox on the
   *  note itself) and whether it's ticked; `toggle` flips it. */
  noteMentions?: { done: Record<string, boolean>; toggle: (noteMsgId: string) => void }
  /** Show the dismiss (X) button - only on the mobile overlay, where it's the
   *  way back to the list. The docked pane omits it (auto-open reselects). */
  showDismiss?: boolean
}

export function DetailPane({
  row,
  currentUser,
  users,
  onClose,
  onChanged,
  onReplied,
  onMakeTaskFromMessage,
  ticketState,
  onSetState,
  mentioned,
  noteMentions,
  showDismiss,
}: Props) {
  if (!row) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground/50">
          <InboxIcon className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground/60">Select an item to open it here</p>
      </div>
    )
  }

  if (row.kind !== "chat" && row.item) {
    // ItemDetailDialog owns its own close chrome in docked mode. ErrorBoundary
    // scoped to the pane so a bad Monday update body can't tear down the page
    // (matches the legacy renderDockedContent behaviour).
    return (
      <ErrorBoundary label="this inbox item" resetKey={row.id}>
        <ItemDetailDialog
          itemId={row.id}
          currentUser={currentUser}
          users={users}
          onClose={onClose}
          onChanged={onChanged}
          mode="docked"
        />
      </ErrorBoundary>
    )
  }

  if (row.thread) {
    return (
      <ChatDetail
        thread={row.thread}
        users={users}
        onReplied={onReplied}
        onMakeTaskFromMessage={onMakeTaskFromMessage}
        ticketState={ticketState}
        onSetState={onSetState}
        mentioned={mentioned}
        noteMentions={noteMentions}
        showDismiss={showDismiss}
        onClose={onClose}
      />
    )
  }

  return null
}

/** The chat/conversation detail. Its own component so it can hold the freshly-
 *  loaded ticket state as hook state without violating rules-of-hooks (DetailPane
 *  has early returns above). The header shows the SAME Open/Assigned/Closed
 *  controls everywhere - the Mentioned view is the same ticket. */
function ChatDetail({
  thread,
  users,
  onReplied,
  onMakeTaskFromMessage,
  ticketState,
  onSetState,
  mentioned,
  noteMentions,
  showDismiss,
  onClose,
}: {
  thread: ChatThreadSummary
  users: InboxUser[]
  onReplied: () => void
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  ticketState?: TicketState
  onSetState?: (target: TicketState) => void
  mentioned?: boolean
  noteMentions?: NoteMentions
  showDismiss?: boolean
  onClose: () => void
}) {
  // The row's ticketState comes from the list, which is a stub for mentions on
  // channels we don't subscribe to. Once the thread loads it reports its real
  // triage state; prefer that so the header is accurate. Reset on thread switch.
  const [resolved, setResolved] = useState<{ isArchived: boolean; isAssigned: boolean } | null>(null)
  useEffect(() => setResolved(null), [thread.threadKey])
  const current: TicketState = resolved
    ? resolved.isArchived
      ? "closed"
      : resolved.isAssigned
        ? "assigned"
        : "open"
    : ticketState ?? "open"
  const targets: readonly TicketState[] = (["open", "assigned", "closed"] as const).filter(
    (s) => s !== current,
  )
  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl")}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {targets.map((t) => (
          <StateButton key={t} target={t} onClick={() => onSetState?.(t)} />
        ))}
        {showDismiss && <DismissButton onClick={onClose} />}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ThreadView
          thread={thread}
          users={users}
          onMakeTaskFromMessage={onMakeTaskFromMessage}
          onReplied={onReplied}
          mentioned={mentioned}
          noteMentions={noteMentions}
          onResolvedState={setResolved}
        />
      </div>
    </div>
  )
}
