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
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"
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
  const locale = useLocale()
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
        throw new Error(body?.error ?? t("calendar.task.load_failed", locale))
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
        throw new Error(body?.error ?? t("calendar.task.update_failed", locale))
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
        <DialogTitle>{t("calendar.task.couldnt_load", locale)}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {(detailQuery.error as Error)?.message ?? t("calendar.task.unknown_error", locale)}
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.close", locale)}
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
          aria-label={t("common.close", locale)}
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
        <Field label={t("calendar.task.field.client", locale)} value={item.clientName || "—"} />
        <Field label={t("calendar.task.field.assignee", locale)} value={item.assigneeName || "—"} />
        <Field label={t("calendar.task.field.author", locale)} value={item.authorName || "—"} />
        <Field label={t("calendar.task.field.source", locale)} value={item.source} />
      </div>

      {confirmReopen && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium text-foreground">{t("calendar.task.reopen_confirm_title", locale)}</p>
          <p className="mt-1 text-muted-foreground">
            {t("calendar.task.reopen_confirm_body", locale)}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReopen(false)}
              disabled={statusMut.isPending}
            >
              {t("common.cancel", locale)}
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
              {t("calendar.task.reopen", locale)}
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
          {t("calendar.task.open_in_inbox", locale)}
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
          {isDone ? t("calendar.task.reopen", locale) : t("calendar.task.mark_done", locale)}
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
  const locale = useLocale()
  const map: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
    open: { label: t("calendar.task.status.open", locale), className: "bg-muted text-muted-foreground" },
    in_progress: {
      label: t("calendar.task.status.in_progress", locale),
      className: "bg-blue-500/15 text-blue-700",
      icon: <Clock className="size-3" />,
    },
    done: {
      label: t("calendar.task.status.done", locale),
      className: "bg-emerald-500/15 text-emerald-700",
      icon: <CircleCheck className="size-3" />,
    },
    cancelled: { label: t("calendar.task.status.cancelled", locale), className: "bg-muted text-muted-foreground" },
    unread: { label: t("calendar.task.status.unread", locale), className: "bg-blue-500/15 text-blue-700" },
    read: { label: t("calendar.task.status.read", locale), className: "bg-muted text-muted-foreground" },
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
  const locale = useLocale()
  const map: Record<string, { label: string; className: string }> = {
    high: {
      label: t("calendar.task.priority.high", locale),
      className: "bg-red-500/15 text-red-700",
    },
    normal: { label: t("calendar.task.priority.normal", locale), className: "bg-muted text-muted-foreground" },
    low: { label: t("calendar.task.priority.low", locale), className: "bg-muted text-muted-foreground" },
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

