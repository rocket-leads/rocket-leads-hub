export type InboxKind = "update" | "task"

export type UpdateStatus = "unread" | "read"
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled"

export type InboxPriority = "low" | "normal" | "high"

export type InboxSource = "manual" | "watchlist" | "meeting" | "monday" | "trengo" | "slack" | "automation"

export type InboxItem = {
  id: string
  kind: InboxKind
  clientId: string
  clientName: string
  authorId: string
  authorName: string
  /** External author identifier — for Trengo, this is the contact id, used by
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
  source: InboxSource
  sourceRef: Record<string, unknown> | null
  mondayUpdateId: string | null
  /** True when the event came from an external source (Trengo) but isn't tied
   *  to any Hub client yet — the contact id wasn't found in `clients.trengo_contact_ids`.
   *  Drives the "Unlinked" UI hint so AMs notice and link the contact. */
  isUnlinked: boolean
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
}

export type UpdateInboxItemInput = {
  title?: string
  body?: string
  status?: UpdateStatus | TaskStatus
  priority?: InboxPriority | null
  dueDate?: string | null
  assigneeId?: string
  /** Manual reclassification override — moves the item between Task / Update /
   *  Chat tabs when the AI classifier got it wrong. Server resets status +
   *  priority to sane defaults for the new kind. */
  kind?: InboxKind | "chat"
}
