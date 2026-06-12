/**
 * Inbox event kind. "chat" was added to the canonical union to match the
 * already-existing reclassify path (`UpdateInboxItemInput.kind`) and the
 * detail-dialog renderer that branches on `item.kind === "chat"`. The
 * three-way taxonomy is the direction the inbox is moving - Roy's
 * in-progress chat work flows through here.
 */
export type InboxKind = "update" | "task" | "chat"

export type UpdateStatus = "unread" | "read"
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled"

export type InboxPriority = "low" | "normal" | "high"

export type InboxSource = "manual" | "watchlist" | "meeting" | "monday" | "trengo" | "slack" | "automation"

/** Channel medium for Trengo events - drives the channel-specific icon
 *  (WhatsApp brand mark / email envelope) on inbox rows so AMs can tell at
 *  a glance which medium a task or update came in on. Resolved server-side
 *  from the row's `trengo_channel_id`. Null for non-Trengo sources. */
export type InboxChannelKind = "whatsapp" | "email" | "other" | null

export type InboxItem = {
  id: string
  kind: InboxKind
  clientId: string
  clientName: string
  authorId: string
  authorName: string
  /** External author identifier - for Trengo, this is the contact id, used by
   *  the "Link to client" affordance to know which contact to attach. Null for
   *  manual / automation / Monday sources where there's no external author. */
  authorExternal: string | null
  assigneeId: string
  assigneeName: string
  title: string
  body: string | null
  status: UpdateStatus | TaskStatus
  priority: InboxPriority | null
  dueDate: string | null
  /** ISO timestamp pinning the task to a specific time-of-day on the
   *  calendar grid. Null = no specific time (renders in the all-day
   *  strip on its due_date). Only meaningful for tasks. */
  scheduledAt: string | null
  source: InboxSource
  /** Trengo channel medium when source==='trengo'. Null otherwise. */
  channelKind: InboxChannelKind
  sourceRef: Record<string, unknown> | null
  mondayUpdateId: string | null
  /** True when the event came from an external source (Trengo) but isn't tied
   *  to any Hub client yet - the contact id wasn't found in `clients.trengo_contact_ids`.
   *  Drives the "Unlinked" UI hint so AMs notice and link the contact. */
  isUnlinked: boolean
  /** ISO timestamp until which the item is hidden from the default active
   *  list. Snoozed items remain status='open' (still on someone's plate);
   *  they just don't clutter today's view. Auto-reappears once passed. */
  snoozedUntil: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  commentCount: number
}

export type InboxComment = {
  id: string
  itemId: string
  authorId: string
  authorName: string
  body: string
  mondayUpdateId: string | null
  createdAt: string
}

export type CreateInboxItemInput = {
  kind: InboxKind
  clientId: string
  assigneeId: string
  title: string
  body?: string
  priority?: InboxPriority
  dueDate?: string
  source?: InboxSource
  sourceRef?: Record<string, unknown>
  /** Hide the item from the active list until this moment. Accepts a full ISO
   *  timestamp OR a plain YYYY-MM-DD (server expands the latter to 09:00
   *  Europe/Amsterdam). Used by Copilot-scheduled reminders so a self-task
   *  created today only surfaces on the target date. */
  snoozedUntil?: string
}

export type UpdateInboxItemInput = {
  title?: string
  body?: string
  status?: UpdateStatus | TaskStatus
  priority?: InboxPriority | null
  dueDate?: string | null
  assigneeId?: string
  /** ISO timestamp to snooze until, or null to wake the item up immediately. */
  snoozedUntil?: string | null
  /** Manual reclassification override - moves the item between Task / Update /
   *  Chat tabs when the AI classifier got it wrong. Server resets status +
   *  priority to sane defaults for the new kind. */
  kind?: InboxKind | "chat"
  /** ISO timestamp pinning a task to a specific time-of-day on the
   *  calendar grid. Null = no specific time, falls back to all-day strip
   *  on the due_date. Set by drag-and-drop in /calendar. */
  scheduledAt?: string | null
}
