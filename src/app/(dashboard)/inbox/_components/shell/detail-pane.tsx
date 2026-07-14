"use client"

import { Inbox as InboxIcon } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { cn } from "@/lib/utils"
import { ItemDetailDialog } from "../item-detail-dialog"
import { ThreadView } from "../chat-pane"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import type { CurrentUser, InboxUser, FeedRow } from "./types"

/** Thread triage actions forwarded to ThreadView's header toggle. Mirrors the
 *  MarkAction union in chat-pane; kept loose here to avoid re-exporting it. */
type MarkAction = "mark_read" | "mark_unread" | "star" | "unstar" | "archive" | "unarchive" | "snooze" | "unsnooze"

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
  onMarkThread?: (thread: ChatThreadSummary, action: MarkAction, payload?: { until?: string | null }) => void
}

export function DetailPane({
  row,
  currentUser,
  users,
  onClose,
  onChanged,
  onReplied,
  onMakeTaskFromMessage,
  onMarkThread,
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
      <div className={cn("relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl")}>
        <DismissButton onClick={onClose} className="absolute right-3 top-3 z-10" />
        <div className="min-h-0 flex-1 overflow-hidden">
          <ThreadView
            thread={row.thread}
            users={users}
            onMakeTaskFromMessage={onMakeTaskFromMessage}
            onMarkThread={onMarkThread}
            onReplied={onReplied}
          />
        </div>
      </div>
    )
  }

  return null
}
