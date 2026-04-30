export type InboxKind = "update" | "task"

export type UpdateStatus = "unread" | "read"
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled"

export type InboxPriority = "low" | "normal" | "high"

export type InboxSource = "manual" | "watchlist" | "meeting" | "monday" | "trengo"

export type InboxItem = {
  id: string
  kind: InboxKind
  clientId: string
  clientName: string
  authorId: string
  authorName: string
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
}
