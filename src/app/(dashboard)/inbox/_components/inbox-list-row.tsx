"use client"

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Calendar, AlertCircle, Check, RotateCcw, Link2Off, Clock, UserCog, ListTodo, MessageSquare, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { fmtRelative } from "./chat-pane"
import type { InboxItem, TaskStatus } from "@/types/inbox"

export type RowUser = { id: string; name: string | null; email: string }

// 187N status tone per task status → rendered as a bare `.st-label` (dot + mono
// uppercase, no fill) instead of a filled pill.
const TASK_STATUS_LABELS: Record<TaskStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "idle" },
  in_progress: { label: "In progress", tone: "warn" },
  done: { label: "Done", tone: "live" },
  cancelled: { label: "Cancelled", tone: "idle" },
}

/**
 * Per-kind visual treatment: a coloured rail on the left edge of the row +
 * a matching type chip next to the title. Roy: "ik wil veel beter kunnen
 * zien of het gaat om een taak, een update, of client inbox." The rail is
 * the at-a-glance signal (peripheral vision across a long list); the chip
 * confirms the type in plain English right next to the title.
 *
 * Colours are deliberately distinct from the SourcePill brand colours on
 * the right edge: rail says *what kind of work this is*, the SourcePill
 * still says *where it came from* (WhatsApp emerald / Email blue / Slack
 * purple etc.). Reading left-to-right: type → title → meta → channel.
 *
 * - Task → violet (the colour we already use for the keyboard-focus ring
 *   and `Make task` button, so it reads as "this is an action item")
 * - Update → sky/blue (informational tone - matches the "Open" task status
 *   shade but in a separate column, so no visual collision)
 */
const KIND_TREATMENT: Record<"task" | "update", {
  rail: string
  dot: string
  label: string
  /** Faint full-row wash for the unread state, matched to the rail hue so an
   *  unread row reads as one coherent colour (rail + wash agree). Roy 2026-07-20. */
  tint: string
}> = {
  task: {
    rail: "bg-violet-500",
    dot: "bg-violet-500",
    label: "Task",
    tint: "bg-violet-500/[0.05]",
  },
  update: {
    rail: "bg-sky-500",
    dot: "bg-sky-500",
    label: "Update",
    tint: "bg-sky-500/[0.05]",
  },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  })
}

/** Compact delivery stamp: time-of-day when it happened today, otherwise a
 *  short date. Keeps the "Seen 14:20" / "Delivered 9 Jul" meta terse. */
function fmtDeliveryStamp(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay
    ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : fmtDate(iso)
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
  currentUserId,
}: {
  item: InboxItem
  showClient: boolean
  onClick: () => void
  onAction?: (action: RowAction) => void
  /** When defined, renders a leading checkbox for bulk-select on tasks.
   *  Updates use their existing read/unread checkbox path. */
  selected?: boolean
  onToggleSelect?: () => void
  /** Team members for the inline Reassign popover. Optional - when omitted,
   *  the Reassign button is hidden and reassignment falls back to the detail
   *  dialog. Always available in the global inbox; locked-client inbox
   *  passes them through too. */
  users?: RowUser[]
  /** True when this row is the current keyboard-navigation target. Renders
   *  a subtle ring + auto-scrolls into view (handled by the parent). */
  keyboardFocused?: boolean
  /** Signed-in user id. When this item was authored by me FOR SOMEONE ELSE
   *  (a delegated item), the meta row gains a delivery signal
   *  (Sending… → Delivered → Seen) so I can confirm it went out and was
   *  picked up. Self-describing: works in the Delegated and All views. */
  currentUserId?: string
}) {
  const isUpdate = item.kind === "update"
  // Delegated = I sent this to someone else. Drives the delivery chip below.
  const isDelegated =
    !!currentUserId &&
    item.authorId === currentUserId &&
    item.assigneeId !== currentUserId
  const isUnread = isUpdate && item.status === "unread"
  const taskStatus = !isUpdate ? TASK_STATUS_LABELS[item.status as TaskStatus] : null
  const isHighPriority = item.priority === "high"
  const isCompleted = ["done", "cancelled", "read"].includes(item.status)
  // Type rail + meta-row dot. The rail is the at-a-glance kind signal in
  // peripheral vision; the dot+label inside the meta row re-states it in
  // text form so the kind is still legible if you're scanning straight
  // down the title column. We stripped the bordered "chip" treatment -
  // it was visually competing with the title without adding info.
  const kindTreatment = isUpdate ? KIND_TREATMENT.update : KIND_TREATMENT.task
  // Bulk-select checkbox shown on tasks AND updates when the parent
  // hooks it up. Updates also keep their leading read/unread bubble
  // (which has a different role: per-row read toggle, not bulk select);
  // the two coexist visually because the bulk one is hover-revealed and
  // sits before the read bubble.
  const showSelectCheckbox = onToggleSelect !== undefined

  // 187N calm-row (Roy 2026-07-30): bring the internal task/update rows to the
  // exact same shape as the external chat rows (feed-row.tsx) so the internal
  // inbox reads as calm and fluent, not a dense Monday grid. Structure now
  // mirrors the external row 1:1:
  //   [ kind-tile ] [ subject + relative-time | detail-line | tiny meta ] [ hover actions ]
  // The loud left rail, source pill, author→assignee trail and always-on big
  // action buttons are gone; kind is carried by a soft tinted icon tile, and
  // the Done/Delete actions are hover-revealed like the external row's affordances.
  const KindIcon = isUpdate ? MessageSquare : ListTodo
  const iconTint = isUpdate ? "text-sky-500" : "text-violet-500"
  // Unread/active drives the bold treatment (mirrors external: unread = bold).
  const needsAttention = isUpdate
    ? isUnread
    : item.status === "open" || item.status === "in_progress"
  const struck = item.status === "done" || item.status === "cancelled"

  // Subject = the row's headline. With a client we lead on the client name
  // (like the external row leads on the contact); otherwise the title itself.
  const hasClientName =
    showClient && !item.isUnlinked && !!item.clientName && item.clientName !== "(unknown)"
  const isUnlinkedRow = showClient && item.isUnlinked
  const clientLeads = hasClientName || isUnlinkedRow
  const subjectClass = cn(
    "min-w-0 truncate text-[13.5px]",
    isUnlinkedRow
      ? "font-semibold text-amber-500/90 dark:text-amber-400"
      : needsAttention
        ? "font-semibold text-foreground"
        : "font-medium text-foreground/85",
    struck && "text-muted-foreground/70 line-through",
  )
  const detailClass = cn(
    "min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground/75",
    struck && "line-through",
  )

  // Delivery signal for delegated items ("things I sent to others"): the
  // internal equivalent of the external "sent" mirror. Seen > Delivered > not.
  const deliveryNode = isDelegated ? (
    item.seenAt ? (
      <span className="st-label live" title={`Seen ${new Date(item.seenAt).toLocaleString("en-GB")}`}>
        Seen {fmtDeliveryStamp(item.seenAt)}
      </span>
    ) : item.notifiedAt ? (
      <span className="st-label idle" title={`Delivered ${new Date(item.notifiedAt).toLocaleString("en-GB")}`}>
        Delivered {fmtDeliveryStamp(item.notifiedAt)}
      </span>
    ) : (
      <span className="st-label warn" title="Not delivered to the assignee yet">
        Not delivered
      </span>
    )
  ) : null

  // Tiny meta line — only what earns its place: task status, delivery signal,
  // the assignee (delegated only; in "my items" it's always me = noise), and
  // the due date. Rendered only when there's something to show.
  const dueNode = item.dueDate ? (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono tabular-nums",
        fmtDueDate(item.dueDate).overdue && "text-red-400",
      )}
    >
      <Calendar className="h-3 w-3" />
      {fmtDueDate(item.dueDate).text}
    </span>
  ) : null
  // Exactly ONE status chip per row (Roy 2026-07-30): in the Delegated view the
  // delivery signal is the point, so it wins; in My items it's the task status.
  // Completion still reads from the row's strikethrough + dimming, so dropping
  // the task-status chip in Delegated loses nothing.
  const statusNode = isDelegated
    ? deliveryNode
    : taskStatus
      ? <span className={`st-label ${taskStatus.tone}`}>{taskStatus.label}</span>
      : null
  const metaNodes: ReactNode[] = [
    statusNode,
    isDelegated ? <span className="truncate">→ {item.assigneeName}</span> : null,
    dueNode,
  ].filter(Boolean)

  const titleEditable = onAction != null
  const renderTitle = (className: string) =>
    titleEditable ? (
      <RowTitle title={item.title} statusClass={className} onSave={(title) => onAction!({ type: "rename", title })} />
    ) : (
      <span className={className}>{item.title}</span>
    )

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
        // Same chrome as the external chat row: compact padding, soft wash on
        // hover, purple wash when active/selected. No rail, no border.
        "group relative w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors",
        selected || keyboardFocused ? "bg-primary/[0.07]" : "hover:bg-muted/50",
        isCompleted && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        {/* Kind tile — a soft square carrying the task/update icon (tinted so
            kind still reads at a glance). Morphs into a bulk-select checkbox on
            hover / when selected, exactly like the external row's avatar. */}
        {showSelectCheckbox ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!selected}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.()
            }}
            title={selected ? "Deselecteer" : "Selecteer voor bulk-actie"}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center self-start"
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all",
                selected
                  ? "border-primary bg-primary text-primary-foreground opacity-100"
                  : "border-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:border-foreground",
              )}
            >
              {selected && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-muted/70 transition-opacity",
                selected ? "opacity-0" : "opacity-100 group-hover:opacity-0",
              )}
            >
              <KindIcon className={cn("h-4 w-4", iconTint)} />
            </span>
          </button>
        ) : (
          <span
            aria-label={kindTreatment.label}
            title={kindTreatment.label}
            className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-lg bg-muted/70"
          >
            <KindIcon className={cn("h-4 w-4", iconTint, isCompleted && "opacity-50")} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          {/* Line 1 — subject (client name, or the title when there's no
              client) + relative time on the right. */}
          <div className="flex items-baseline gap-2">
            {isUnlinkedRow && <Link2Off className="h-3.5 w-3.5 shrink-0 self-center text-amber-500/90 dark:text-amber-400" />}
            {clientLeads ? (
              <p className={subjectClass}>{isUnlinkedRow ? "Unlinked contact" : item.clientName}</p>
            ) : (
              renderTitle(subjectClass)
            )}
            {isHighPriority && <AlertCircle className="h-3.5 w-3.5 shrink-0 self-center text-red-400" />}
            <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground/45">
              {fmtRelative(item.createdAt)}
            </span>
          </div>

          {/* Line 2 — detail. The title (when a client leads above), or the
              body preview (when the title is already the subject). */}
          {clientLeads ? (
            <div className="mt-0.5 flex items-center gap-2">{renderTitle(detailClass)}</div>
          ) : item.body ? (
            <div className="mt-0.5 flex items-center gap-2">
              <p className={detailClass}>{item.body}</p>
            </div>
          ) : null}

          {/* Line 3 — tiny meta (status / delivery / assignee / due). */}
          {metaNodes.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/70">
              {metaNodes.map((node, i) => (
                <Fragment key={i}>
                  {i > 0 && <span className="text-muted-foreground/25">·</span>}
                  {node}
                </Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Actions — hover-revealed (calm at rest, like the external row).
            Done / Reopen + Delete; snooze/reassign live in the detail pane. */}
        {onAction && (
          <div className="shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <RowActions item={item} onAction={onAction} users={users} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Double-click-to-edit task title in the row. Single click does NOT enter
 *  edit mode - the row container handles that as "open detail dialog" - so
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
  const isUpdate = item.kind === "update"
  // "Active" = the row still needs the user's attention. Tasks use
  // open/in_progress; updates use unread. Both render the same green
  // check button on the right (Roy 2026-06-09 - the inbox affordance
  // should be identical across kinds, only the DB enum differs).
  const isActive = isUpdate
    ? item.status === "unread"
    : item.status === "open" || item.status === "in_progress"
  const isSnoozed = !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()
  // Kind-specific status verbs - same UI, different underlying value.
  // Done flips status to "read" for updates, "done" for tasks. Reopen
  // does the inverse. The status check above already routes to the
  // right branch; this just picks the value to PATCH.
  const doneAction: RowAction = isUpdate ? "read" : "done"
  const reopenAction: RowAction = isUpdate ? "unread" : "reopen"

  return (
    <div className="flex items-center gap-1 shrink-0" onClick={stop}>
      {/* Roy 2026-07-27: rows carry ONLY the done/reopen checkbox + delete.
          Snooze / make-task / reassign moved off the row - everything else
          happens in the detail pane on click. */}
      {isActive ? (
        <ActionIconButton
          tone="success"
          label={isUpdate ? "Markeer als gelezen" : "Markeer als klaar"}
          onClick={() => onAction(doneAction)}
          icon={<Check className="h-5 w-5" strokeWidth={2.5} />}
          className="bg-emerald-500 hover:bg-emerald-600 text-white dark:text-white border-emerald-600 hover:border-emerald-700"
        />
      ) : (
        <ActionIconButton
          tone="muted"
          label="Reopen"
          onClick={() => onAction(reopenAction)}
          icon={<RotateCcw className="h-4 w-4" />}
        />
      )}
      <ActionIconButton
        tone="danger"
        label="Delete"
        onClick={() => {
          if (window.confirm(`Permanently delete this ${isUpdate ? "update" : "task"}?`)) {
            onAction("delete")
          }
        }}
        icon={<Trash2 className="h-4 w-4" />}
      />
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
      <ActionIconButton
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
 *  primitive) to keep the row compact - a tiny relative-positioned panel
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
      <ActionIconButton
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
      // Don't roll over to tomorrow - if "later today" would land past 22:00,
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

// ActionButton moved to src/components/ui/action-icon-button.tsx so the
// co-pilot bell + future row surfaces share one source of chrome.
