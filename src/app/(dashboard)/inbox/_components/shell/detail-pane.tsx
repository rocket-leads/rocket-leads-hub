"use client"

import { useEffect, useState } from "react"
import { Inbox as InboxIcon, Circle, User, Check } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import { cn } from "@/lib/utils"
import { ItemDetailDialog } from "../item-detail-dialog"
import { ThreadView } from "../chat-pane"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import type { CurrentUser, InboxUser, FeedRow } from "./types"

type TicketState = "open" | "assigned" | "closed"
type NoteMentions = { done: Record<string, boolean>; toggle: (noteMsgId: string) => void }

/** Ticket-state segmented control. Unlike the old two-button "move to" pattern,
 *  this shows ALL three states so the CURRENT one is always visible (filled),
 *  and the other two are one click away. Active fills read as a progression:
 *  neutral (Open) → amber (Assigned/working) → emerald (Closed/done).
 *  Roy 2026-07-20. */
const STATE_META: Record<TicketState, {
  icon: typeof Circle
  labelKey: DictionaryKey
  titleKey: DictionaryKey
  /** Fill when this is the current state. */
  activeClass: string
}> = {
  open: {
    icon: Circle,
    labelKey: "inbox.shell.state.open",
    titleKey: "inbox.shell.state.open",
    activeClass: "bg-muted text-foreground",
  },
  assigned: {
    icon: User,
    labelKey: "inbox.shell.state.assigned",
    titleKey: "inbox.shell.state.assigned_title",
    activeClass: "bg-amber-500 text-white",
  },
  closed: {
    icon: Check,
    labelKey: "inbox.shell.state.closed",
    titleKey: "inbox.shell.state.closed_title",
    activeClass: "bg-emerald-500 text-white",
  },
}

const STATE_ORDER: readonly TicketState[] = ["open", "assigned", "closed"] as const

function StateSwitch({ current, onSetState }: { current: TicketState; onSetState?: (t: TicketState) => void }) {
  const locale = useLocale()
  return (
    <div
      role="group"
      aria-label={t("inbox.shell.state.group", locale)}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 shadow-sm"
    >
      {STATE_ORDER.map((s) => {
        const meta = STATE_META[s]
        const Icon = meta.icon
        const isCurrent = s === current
        const label = t(meta.labelKey, locale)
        const controlLabel = isCurrent
          ? t("inbox.shell.state.current", locale, { label })
          : t(meta.titleKey, locale)
        return (
          <button
            key={s}
            type="button"
            onClick={() => !isCurrent && onSetState?.(s)}
            disabled={isCurrent}
            title={controlLabel}
            aria-label={controlLabel}
            aria-pressed={isCurrent}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              isCurrent
                ? meta.activeClass
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={s === "closed" ? 3 : 2} />
            {/* Only the active segment shows its label - keeps the control compact
                while making the current state unmistakable. */}
            {isCurrent && <span>{label}</span>}
          </button>
        )
      })}
    </div>
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
  const locale = useLocale()
  if (!row) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card text-center shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground/50">
          <InboxIcon className="h-5 w-5" />
        </div>
        <p className="text-sm text-muted-foreground/60">{t("inbox.shell.detail.empty", locale)}</p>
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
  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl")}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <StateSwitch current={current} onSetState={onSetState} />
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
