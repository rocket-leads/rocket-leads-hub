"use client"

import { Calendar, MessageCircle, AlertCircle, Check, X, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { InboxItem, TaskStatus } from "@/types/inbox"

const TASK_STATUS_LABELS: Record<TaskStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-blue-500/10 text-blue-400" },
  in_progress: { label: "In progress", cls: "bg-amber-500/10 text-amber-400" },
  done: { label: "Done", cls: "bg-emerald-500/10 text-emerald-400" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

function fmtDueDate(iso: string): { text: string; overdue: boolean } {
  const due = new Date(iso + "T00:00:00")
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const ms = due.getTime() - today.getTime()
  const days = Math.round(ms / (1000 * 60 * 60 * 24))
  if (days === 0) return { text: "Today", overdue: false }
  if (days === 1) return { text: "Tomorrow", overdue: false }
  if (days === -1) return { text: "Yesterday", overdue: true }
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true }
  if (days < 7) return { text: `In ${days}d`, overdue: false }
  return { text: fmtDate(iso), overdue: false }
}

export type RowAction = "done" | "cancel" | "reopen" | "read" | "unread"

export function InboxListRow({
  item,
  showClient,
  onClick,
  onAction,
}: {
  item: InboxItem
  showClient: boolean
  onClick: () => void
  onAction?: (action: RowAction) => void
}) {
  const isUpdate = item.kind === "update"
  const isUnread = isUpdate && item.status === "unread"
  const taskStatus = !isUpdate ? TASK_STATUS_LABELS[item.status as TaskStatus] : null
  const isHighPriority = item.priority === "high"
  const isCompleted = ["done", "cancelled", "read"].includes(item.status)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        "group w-full text-left rounded-lg border border-border/40 bg-card hover:border-border hover:bg-muted/30 transition-all px-4 py-3 cursor-pointer",
        isUnread && "ring-1 ring-primary/30 bg-primary/[0.02]",
        isCompleted && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isUnread && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
            {isHighPriority && (
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            )}
            <span
              className={cn(
                "text-sm truncate",
                isUnread ? "font-semibold" : "font-medium",
                item.status === "done" || item.status === "cancelled" ? "line-through text-muted-foreground" : "",
              )}
            >
              {item.title}
            </span>
            {taskStatus && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${taskStatus.cls}`}>
                {taskStatus.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/70 flex-wrap">
            {showClient && (
              <>
                <span className="font-medium">{item.clientName}</span>
                <span>·</span>
              </>
            )}
            <span>{item.authorName}</span>
            <span>→</span>
            <span>{item.assigneeName}</span>
            <span>·</span>
            <span>{fmtDate(item.createdAt)}</span>
            {item.dueDate && (
              <>
                <span>·</span>
                <span
                  className={`inline-flex items-center gap-1 ${
                    fmtDueDate(item.dueDate).overdue ? "text-red-400" : ""
                  }`}
                >
                  <Calendar className="h-3 w-3" />
                  {fmtDueDate(item.dueDate).text}
                </span>
              </>
            )}
            {item.commentCount > 0 && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {item.commentCount}
                </span>
              </>
            )}
          </div>
        </div>

        {onAction && <RowActions item={item} onAction={onAction} />}
      </div>
    </div>
  )
}

function RowActions({
  item,
  onAction,
}: {
  item: InboxItem
  onAction: (action: RowAction) => void
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  if (item.kind === "update") {
    return (
      <div className="flex items-center gap-1 shrink-0" onClick={stop}>
        {item.status === "unread" ? (
          <ActionButton
            tone="success"
            label="Mark as read"
            onClick={() => onAction("read")}
            icon={<Check className="h-3.5 w-3.5" />}
          />
        ) : (
          <ActionButton
            tone="muted"
            label="Mark as unread"
            onClick={() => onAction("unread")}
            icon={<RotateCcw className="h-3.5 w-3.5" />}
          />
        )}
      </div>
    )
  }

  // task
  return (
    <div className="flex items-center gap-1 shrink-0" onClick={stop}>
      {item.status === "open" || item.status === "in_progress" ? (
        <>
          <ActionButton
            tone="success"
            label="Mark done"
            onClick={() => onAction("done")}
            icon={<Check className="h-3.5 w-3.5" />}
          />
          <ActionButton
            tone="danger"
            label="Cancel"
            onClick={() => onAction("cancel")}
            icon={<X className="h-3.5 w-3.5" />}
          />
        </>
      ) : (
        <ActionButton
          tone="muted"
          label="Reopen"
          onClick={() => onAction("reopen")}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
        />
      )}
    </div>
  )
}

function ActionButton({
  tone,
  label,
  onClick,
  icon,
}: {
  tone: "success" | "danger" | "muted"
  label: string
  onClick: () => void
  icon: React.ReactNode
}) {
  const cls = {
    success:
      "text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300 border-transparent hover:border-emerald-500/30",
    danger:
      "text-muted-foreground/60 hover:bg-red-500/15 hover:text-red-300 border-transparent hover:border-red-500/30",
    muted:
      "text-muted-foreground/60 hover:bg-muted hover:text-foreground border-transparent hover:border-border",
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-7 w-7 inline-flex items-center justify-center rounded-md border transition-colors",
        cls,
      )}
    >
      {icon}
    </button>
  )
}
