"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Calendar, MessageCircle, AlertCircle, Check, X, RotateCcw, Link2Off, Clock, BellOff, UserCog, ListTodo, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SourcePill } from "./source-pill"
import type { InboxItem, TaskStatus } from "@/types/inbox"

export type RowUser = { id: string; name: string | null; email: string }

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

export type RowAction =
  | "done"
  | "delete"
  | "reopen"
  | "read"
  | "unread"
  | "make_task"
  | { type: "snooze"; until: string }
  | "unsnooze"
  | { type: "reassign"; assigneeId: string }
  | { type: "rename"; title: string }

export function InboxListRow({
  item,
  showClient,
  onClick,
  onAction,
  selected,
  onToggleSelect,
  users,
  keyboardFocused,
}: {
  item: InboxItem
  showClient: boolean
  onClick: () => void
  onAction?: (action: RowAction) => void
  /** When defined, renders a leading checkbox for bulk-select on tasks.
   *  Updates use their existing read/unread checkbox path. */
  selected?: boolean
  onToggleSelect?: () => void
  /** Team members for the inline Reassign popover. Optional — when omitted,
   *  the Reassign button is hidden and reassignment falls back to the detail
   *  dialog. Always available in the global inbox; locked-client inbox
   *  passes them through too. */
  users?: RowUser[]
  /** True when this row is the current keyboard-navigation target. Renders
   *  a subtle ring + auto-scrolls into view (handled by the parent). */
  keyboardFocused?: boolean
}) {
  const isUpdate = item.kind === "update"
  const isUnread = isUpdate && item.status === "unread"
  const taskStatus = !isUpdate ? TASK_STATUS_LABELS[item.status as TaskStatus] : null
  const isHighPriority = item.priority === "high"
  const isCompleted = ["done", "cancelled", "read"].includes(item.status)
  const showSelectCheckbox = !isUpdate && onToggleSelect !== undefined

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
      data-inbox-row-id={item.id}
      className={cn(
        "group w-full text-left rounded-lg border border-border/40 bg-card hover:border-border hover:bg-muted/30 transition-all px-4 py-3 cursor-pointer",
        isUnread && "ring-1 ring-primary/30 bg-primary/[0.02]",
        selected && "ring-2 ring-primary/60 bg-primary/[0.05] border-primary/40",
        // Keyboard focus ring sits ABOVE the unread/selected rings visually
        // (last in the cn order). Distinct violet ring so it doesn't collide
        // with the cyan unread tint.
        keyboardFocused && "ring-2 ring-violet-500/60 bg-violet-500/[0.04]",
        isCompleted && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Bulk-select checkbox for tasks. Hover-revealed by default, pinned
            visible when this row is selected so the AM can see what's in their
            current batch without hovering. Clicking it doesn't open the row. */}
        {showSelectCheckbox && (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!selected}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.()
            }}
            className={cn(
              "h-5 w-5 shrink-0 rounded border-2 inline-flex items-center justify-center mt-0.5 transition-all",
              selected
                ? "bg-primary border-primary text-primary-foreground"
                : "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-foreground hover:bg-muted/40",
            )}
            title={selected ? "Deselecteer" : "Selecteer voor bulk-actie"}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
          </button>
        )}

        {/* Updates get a leading checkbox so the read/unread toggle is the
            primary affordance — click it to mark read, click again to unmark.
            Tasks keep their right-side Done/Cancel/Reopen actions instead. */}
        {isUpdate && onAction && (
          <UpdateCheckbox
            checked={!isUnread}
            onToggle={() => onAction(isUnread ? "read" : "unread")}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isHighPriority && (
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
            )}
            {!isUpdate && onAction ? (
              // Tasks: title is double-click-to-edit. Single click still
              // opens the detail dialog (default row behaviour); double
              // click switches to an inline input. Slack-style — keeps the
              // row dense without adding a separate edit button. Updates
              // stay read-only since they're signals from elsewhere.
              <RowTitle
                title={item.title}
                statusClass={cn(
                  "text-sm truncate",
                  isUnread ? "font-semibold" : "font-medium",
                  item.status === "done" || item.status === "cancelled"
                    ? "line-through text-muted-foreground"
                    : "",
                  item.status === "read" && "text-muted-foreground",
                )}
                onSave={(title) => onAction({ type: "rename", title })}
              />
            ) : (
              <span
                className={cn(
                  "text-sm truncate",
                  isUnread ? "font-semibold" : "font-medium",
                  item.status === "done" || item.status === "cancelled" ? "line-through text-muted-foreground" : "",
                  item.status === "read" && "text-muted-foreground",
                )}
              >
                {item.title}
              </span>
            )}
            {taskStatus && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${taskStatus.cls}`}>
                {taskStatus.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/70 flex-wrap">
            {showClient && (
              <>
                {item.isUnlinked ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 font-medium"
                    title="This Trengo contact isn't linked to a client yet"
                  >
                    <Link2Off className="h-3 w-3" />
                    Unlinked
                  </span>
                ) : (
                  <span className="font-medium">{item.clientName}</span>
                )}
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
            {/* Source pill — pushed to the right edge of the metadata row.
                Per the Phase C design: brand-coloured chip so AMs can tell at
                a glance whether a task came from a client message, a Monday
                update, an automation, etc. */}
            <SourcePill
              source={item.source}
              channelKind={item.channelKind}
              className="ml-auto"
            />
          </div>
        </div>

        {/* Tasks keep right-side actions; update toggles live in the leading checkbox. */}
        {!isUpdate && onAction && <RowActions item={item} onAction={onAction} users={users} />}

        {/* Updates get a single hover-revealed "Make task" button — closes the
            loop on the Phase D vision: any inbox item can become an actionable
            task in one click. Hover-only so the row stays uncluttered for the
            (most common) read-and-move-on flow. */}
        {isUpdate && onAction && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onAction("make_task")
            }}
            title="Convert to task"
            aria-label="Convert to task"
            className="opacity-0 group-hover:opacity-100 transition-opacity h-9 px-2.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 text-xs font-medium text-muted-foreground hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-500/30 shrink-0"
          >
            <ListTodo className="h-3.5 w-3.5" />
            Make task
          </button>
        )}
      </div>
    </div>
  )
}

/** Double-click-to-edit task title in the row. Single click does NOT enter
 *  edit mode — the row container handles that as "open detail dialog" — so
 *  there's no ambiguity. Hovering hints at the edit affordance with a
 *  subtle dotted underline; double-click anywhere on the title text
 *  switches to an inline input. Enter or blur saves; Esc reverts; empty
 *  title is rejected (revert). Stops propagation everywhere inside the
 *  input so a stray click doesn't open the dialog mid-edit. */
function RowTitle({
  title,
  statusClass,
  onSave,
}: {
  title: string
  statusClass: string
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync external changes (optimistic patches landing the new title) when
  // we're not actively editing.
  useEffect(() => {
    if (!editing) setDraft(title)
  }, [title, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const next = draft.trim()
    if (!next) {
      setDraft(title)
      setEditing(false)
      return
    }
    setEditing(false)
    if (next !== title) onSave(next)
  }

  function cancel() {
    setDraft(title)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        className={cn(
          statusClass,
          "flex-1 min-w-0 bg-background border border-primary/40 rounded-sm px-1.5 py-0.5 -my-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        )}
      />
    )
  }

  return (
    <span
      onDoubleClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
      title="Double-click to rename"
      className={cn(
        statusClass,
        "cursor-text hover:decoration-dotted hover:decoration-muted-foreground/40 hover:underline underline-offset-4",
      )}
    >
      {title}
    </span>
  )
}

function UpdateCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      title={checked ? "Mark as unread" : "Mark as read"}
      aria-label={checked ? "Mark as unread" : "Mark as read"}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        "h-5 w-5 shrink-0 rounded-full border-2 inline-flex items-center justify-center mt-0.5 transition-all",
        checked
          ? "bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600"
          : "border-muted-foreground/40 hover:border-foreground hover:bg-muted/40",
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
}

function RowActions({
  item,
  onAction,
  users,
}: {
  item: InboxItem
  onAction: (action: RowAction) => void
  users?: RowUser[]
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  const isActive = item.status === "open" || item.status === "in_progress"
  const isSnoozed = !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()

  // Updates handle their read/unread toggle via the leading checkbox in the
  // row itself, so this component only ever renders the task action buttons.
  return (
    <div className="flex items-center gap-1 shrink-0" onClick={stop}>
      {isActive ? (
        <>
          <ActionButton
            tone="success"
            label="Mark done"
            onClick={() => onAction("done")}
            icon={<Check className="h-4 w-4" />}
          />
          {isSnoozed ? (
            <ActionButton
              tone="muted"
              label={`Snoozed until ${formatSnoozeLabel(item.snoozedUntil!)} — click to wake`}
              onClick={() => onAction("unsnooze")}
              icon={<BellOff className="h-4 w-4" />}
            />
          ) : (
            <SnoozeButton onPick={(until) => onAction({ type: "snooze", until })} />
          )}
          {users && users.length > 0 && (
            <ReassignButton
              users={users}
              currentAssigneeId={item.assigneeId}
              onPick={(assigneeId) => onAction({ type: "reassign", assigneeId })}
            />
          )}
          <ActionButton
            tone="danger"
            label="Delete"
            onClick={() => {
              if (window.confirm("Permanently delete this task?")) {
                onAction("delete")
              }
            }}
            icon={<Trash2 className="h-4 w-4" />}
          />
        </>
      ) : (
        <ActionButton
          tone="muted"
          label="Reopen"
          onClick={() => onAction("reopen")}
          icon={<RotateCcw className="h-4 w-4" />}
        />
      )}
    </div>
  )
}

/** Inline reassign popover. Same construction pattern as SnoozeButton (custom
 *  outside-click + Esc closer) so the row stays compact. Search filter on top
 *  for the few cases where the team grows beyond what fits at a glance, plus
 *  a checkmark next to the current assignee so re-clicking the same person
 *  is an obvious no-op. Backend already accepts assigneeId on PATCH /api/inbox/:id
 *  and fires the assignment push, so the button is purely UI plumbing. */
function ReassignButton({
  users,
  currentAssigneeId,
  onPick,
}: {
  users: RowUser[]
  currentAssigneeId: string | null
  onPick: (assigneeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  // Reset the search box every time the popover opens so a stale query from
  // a prior row doesn't bleed across reassigns.
  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const haystack = `${u.name ?? ""} ${u.email}`.toLowerCase()
      return haystack.includes(q)
    })
  }, [users, query])

  function pick(userId: string) {
    setOpen(false)
    onPick(userId)
  }

  return (
    <div className="relative" ref={ref}>
      <ActionButton
        tone="muted"
        label="Reassign"
        onClick={() => setOpen((s) => !s)}
        icon={<UserCog className="h-4 w-4" />}
      />
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-60 rounded-md border border-border bg-popover shadow-lg text-xs">
          <div className="p-1.5 border-b border-border/60">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search team…"
              autoFocus
              className="w-full rounded-sm bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-muted-foreground/70 italic">No matches</div>
            ) : (
              filtered.map((u) => {
                const isCurrent = u.id === currentAssigneeId
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pick(u.id)}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted/60 flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      <span className="font-medium">{u.name ?? u.email}</span>
                      {u.name && (
                        <span className="text-muted-foreground/60 ml-1 text-[10px]">
                          {u.email}
                        </span>
                      )}
                    </span>
                    {isCurrent && <Check className="h-3 w-3 text-primary shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function formatSnoozeLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000
  const dueDay = new Date(d)
  dueDay.setHours(0, 0, 0, 0)
  const diffDays = Math.round((dueDay.getTime() - today.getTime()) / dayMs)
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  if (diffDays === 0) return `today ${time}`
  if (diffDays === 1) return `tomorrow ${time}`
  if (diffDays < 7) return d.toLocaleDateString("en-GB", { weekday: "short" }) + ` ${time}`
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

/** Snooze quick-pick menu. Built from scratch (instead of pulling in a popover
 *  primitive) to keep the row compact — a tiny relative-positioned panel
 *  closes on outside-click and on Esc. */
function SnoozeButton({ onPick }: { onPick: (untilIso: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDoc)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  function pick(option: SnoozeOption) {
    setOpen(false)
    if (option === "custom") {
      const input = window.prompt(
        "Snooze until (YYYY-MM-DD or YYYY-MM-DD HH:MM)",
        defaultCustomValue(),
      )
      if (!input) return
      const iso = parseCustomSnooze(input)
      if (!iso) return
      onPick(iso)
      return
    }
    const iso = computeSnoozeIso(option)
    if (iso) onPick(iso)
  }

  return (
    <div className="relative" ref={ref}>
      <ActionButton
        tone="muted"
        label="Snooze"
        onClick={() => setOpen((s) => !s)}
        icon={<Clock className="h-4 w-4" />}
      />
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-md border border-border bg-popover shadow-lg py-1 text-xs">
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => pick(opt.id)}
              className="w-full text-left px-3 py-1.5 hover:bg-muted/60 flex items-center justify-between gap-3"
            >
              <span>{opt.label}</span>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">{opt.preview()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type SnoozeOption =
  | "later_today"
  | "tomorrow_morning"
  | "weekend"
  | "next_week"
  | "in_2_weeks"
  | "custom"

const SNOOZE_OPTIONS: Array<{ id: SnoozeOption; label: string; preview: () => string }> = [
  { id: "later_today", label: "Later today", preview: () => previewIso(computeSnoozeIso("later_today")) },
  { id: "tomorrow_morning", label: "Tomorrow morning", preview: () => previewIso(computeSnoozeIso("tomorrow_morning")) },
  { id: "weekend", label: "This weekend", preview: () => previewIso(computeSnoozeIso("weekend")) },
  { id: "next_week", label: "Next week", preview: () => previewIso(computeSnoozeIso("next_week")) },
  { id: "in_2_weeks", label: "In 2 weeks", preview: () => previewIso(computeSnoozeIso("in_2_weeks")) },
  { id: "custom", label: "Custom…", preview: () => "" },
]

function computeSnoozeIso(option: SnoozeOption): string | null {
  const now = new Date()
  switch (option) {
    case "later_today": {
      const d = new Date(now)
      d.setHours(Math.max(now.getHours() + 3, 17), 0, 0, 0)
      // Don't roll over to tomorrow — if "later today" would land past 22:00,
      // snap to 22:00 today instead.
      if (d.getDate() !== now.getDate()) {
        d.setDate(now.getDate())
        d.setHours(22, 0, 0, 0)
      }
      return d.toISOString()
    }
    case "tomorrow_morning": {
      const d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    case "weekend": {
      // Next Saturday at 09:00 (or this Saturday if we're earlier in the week)
      const d = new Date(now)
      const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + daysUntilSat)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    case "next_week": {
      const d = new Date(now)
      const daysUntilMon = (1 - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + daysUntilMon)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    case "in_2_weeks": {
      const d = new Date(now)
      d.setDate(d.getDate() + 14)
      d.setHours(9, 0, 0, 0)
      return d.toISOString()
    }
    default:
      return null
  }
}

function previewIso(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return formatSnoozeLabel(iso === d.toISOString() ? iso : d.toISOString())
}

function defaultCustomValue(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().slice(0, 10)
}

function parseCustomSnooze(input: string): string | null {
  const trimmed = input.trim()
  // Accept YYYY-MM-DD (defaults to 09:00) or YYYY-MM-DD HH:MM
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/
  const dateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}$/
  if (dateOnly.test(trimmed)) {
    const d = new Date(trimmed + "T09:00:00")
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  if (dateTime.test(trimmed)) {
    const d = new Date(trimmed.replace(" ", "T"))
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
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
  // Roy's feedback: "icons wil ik groter en meer opvallend, moet gewoon
  // duidelijker." Always-on background tint so the buttons aren't
  // ghost-actions on hover, plus a step up in icon + button size.
  const cls = {
    success:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40",
    danger:
      "bg-muted/50 text-muted-foreground hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 border-border hover:border-red-500/40",
    muted:
      "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-border",
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-9 w-9 inline-flex items-center justify-center rounded-md border transition-colors",
        cls,
      )}
    >
      {icon}
    </button>
  )
}
