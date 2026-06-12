"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import {
  CalendarClock,
  Check,
  CircleCheck,
  Clock,
  ExternalLink,
  Flag,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { InboxItem } from "@/types/inbox"

/**
 * Lightweight detail dialog for the calendar's task chips. Mirrors the
 * EventDialog interaction model so meetings and tasks both open the
 * same kind of popover when clicked.
 *
 * Reuses the existing /api/inbox/[id] endpoint — GET to fetch, PATCH
 * to toggle status. Full editing (reassign, change client, rich body
 * edit, threaded comments) lives on the Inbox page, linked at the
 * bottom of this dialog so the calendar stays a quick-glance surface.
 */
type Props = {
  taskId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskDialog({ taskId, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md md:max-w-lg"
        showCloseButton={false}
      >
        <Body taskId={taskId} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [confirmReopen, setConfirmReopen] = useState(false)

  const detailQuery = useQuery<{ item: InboxItem }>({
    queryKey: ["task-detail", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/inbox/${encodeURIComponent(taskId)}`, {
        credentials: "include",
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Failed to load task")
      }
      return res.json()
    },
  })

  const statusMut = useMutation({
    mutationFn: async (nextStatus: "open" | "done") => {
      const res = await fetch(`/api/inbox/${encodeURIComponent(taskId)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? "Failed to update task")
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] })
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
    },
  })

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="space-y-3">
        <DialogTitle>Couldn&apos;t load task</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {(detailQuery.error as Error)?.message ?? "Unknown error"}
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )
  }

  const item = detailQuery.data.item
  const isDone = item.status === "done" || item.status === "cancelled"

  const handleToggleDone = () => {
    if (isDone) {
      // Reopening a done task — quick confirm to avoid stray clicks.
      setConfirmReopen(true)
      return
    }
    statusMut.mutate("done")
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-2.5 rounded-sm bg-amber-500 mt-2 shrink-0" />
        <div className="flex-1 min-w-0">
          <DialogTitle className="text-base leading-tight">
            {item.title}
          </DialogTitle>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <StatusPill status={item.status} />
            {item.priority && <PriorityPill priority={item.priority} />}
            {item.dueDate && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="size-3.5" />
                <span className="tabular-nums">
                  {format(parseISO(item.dueDate), "EEE d MMM")}
                </span>
              </span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      {item.body && (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
          {item.body}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Client" value={item.clientName || "—"} />
        <Field label="Assignee" value={item.assigneeName || "—"} />
        <Field label="Author" value={item.authorName || "—"} />
        <Field label="Source" value={item.source} />
      </div>

      {confirmReopen && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-foreground">Reopen this task?</p>
          <p className="mt-1 text-muted-foreground">
            It will move back into your open tasks queue.
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReopen(false)}
              disabled={statusMut.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setConfirmReopen(false)
                statusMut.mutate("open")
              }}
              disabled={statusMut.isPending}
            >
              {statusMut.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              <RotateCcw className="size-3.5" />
              Reopen
            </Button>
          </div>
        </div>
      )}

      {statusMut.error && (
        <p className="text-xs text-destructive">
          {(statusMut.error as Error).message}
        </p>
      )}

      <div className="-mx-4 -mb-4 flex items-center justify-between gap-2 rounded-b-xl border-t border-border bg-muted/30 px-4 py-3">
        <Link
          href={`/inbox?item=${encodeURIComponent(item.id)}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open in Inbox
          <ExternalLink className="size-3" />
        </Link>
        <Button
          size="sm"
          variant={isDone ? "outline" : "default"}
          onClick={handleToggleDone}
          disabled={statusMut.isPending || confirmReopen}
        >
          {statusMut.isPending && (
            <Loader2 className="size-3.5 animate-spin" />
          )}
          {!statusMut.isPending &&
            (isDone ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            ))}
          {isDone ? "Reopen" : "Mark done"}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground truncate" title={value}>
        {value}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
    open: { label: "Open", className: "bg-muted text-muted-foreground" },
    in_progress: {
      label: "In progress",
      className: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
      icon: <Clock className="size-3" />,
    },
    done: {
      label: "Done",
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      icon: <CircleCheck className="size-3" />,
    },
    cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
    unread: { label: "Unread", className: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
    read: { label: "Read", className: "bg-muted text-muted-foreground" },
  }
  const m = map[status] ?? { label: status, className: "bg-muted text-muted-foreground" }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        m.className,
      )}
    >
      {m.icon}
      {m.label}
    </span>
  )
}

function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, { label: string; className: string }> = {
    high: {
      label: "High",
      className: "bg-red-500/15 text-red-700 dark:text-red-400",
    },
    normal: { label: "Normal", className: "bg-muted text-muted-foreground" },
    low: { label: "Low", className: "bg-muted text-muted-foreground" },
  }
  const m = map[priority] ?? { label: priority, className: "bg-muted text-muted-foreground" }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        m.className,
      )}
    >
      <Flag className="size-3" />
      {m.label}
    </span>
  )
}

