"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Calendar, MessageCircle, AlertCircle, Check, RotateCcw, Link2Off, Clock, BellOff, UserCog, ListTodo, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { SourcePill } from "./source-pill"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import type { InboxItem, TaskStatus } from "@/types/inbox"

export type RowUser = { id: string; name: string | null; email: string }

const TASK_STATUS_LABELS: Record<TaskStatus, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-blue-500/10 text-blue-400" },
  in_progress: { label: "In progress", cls: "bg-amber-500/10 text-amber-400" },
  done: { label: "Done", cls: "bg-emerald-500/10 text-emerald-400" },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
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
 * - Update → sky/blue (informational tone — matches the "Open" task status
 *   shade but in a separate column, so no visual collision)
 */
const KIND_TREATMENT: Record<"task" | "update", {
  rail: string
  dot: string
  label: string
}> = {
  task: {
    rail: "bg-violet-500",
    dot: "bg-violet-500",
    label: "Task",
  },
  update: {
    rail: "bg-sky-500",
    dot: "bg-sky-500",
    label: "Update",
  },
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
  // Type rail + meta-row dot. The rail is the at-a-glance kind signal in
  // peripheral vision; the dot+label inside the meta row re-states it in
  // text form so the kind is still legible if you're scanning straight
  // down the title column. We stripped the bordered "chip" treatment —
  // it was visually competing with the title without adding info.
  const kindTreatment = isUpdate ? KIND_TREATMENT.update : KIND_TREATMENT.task
  // Bulk-select checkbox shown on tasks AND updates when the parent
  // hooks it up. Updates also keep their leading read/unread bubble
  // (which has a different role: per-row read toggle, not bulk select);
  // the two coexist visually because the bulk one is hover-revealed and
  // sits before the read bubble.
  const showSelectCheckbox = onToggleSelect !== undefined

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
        "group relative w-full text-left rounded-xl border border-border/60 bg-card transition-all px-5 py-3.5 cursor-pointer overflow-hidden",
        // Subtle lift on hover — slightly darker border + soft shadow so
        // the row feels interactive without a heavy state flip. Faster
        // duration than the default so the response feels snappy.
        "hover:border-border hover:bg-muted/30 hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.04)] duration-150",
        // Slight inset on the left so the rail (w-1) doesn't collide with
        // the title/checkbox at small viewport widths. The rail itself is
        // absolute-positioned so this padding sits above it.
        "pl-6",
        selected && "ring-2 ring-primary/60 bg-primary/[0.06] border-primary/40",
        // Keyboard focus ring also denotes "this row's detail is open" in
        // docked mode — see inbox-view.tsx where setFocusedItemId follows
        // setDetailItem on every click. Distinct violet ring so it doesn't
        // collide with the type rail colour.
        keyboardFocused && "ring-2 ring-violet-500/60 bg-violet-500/[0.04]",
        isCompleted && "opacity-60",
      )}
    >
      {/* Type rail on the left edge — always rendered (so type is visible
          at a glance on every row), but dimmed to ~45% when the item is
          done/cancelled/read so completed rows visually recede. Unread
          updates get the rail at full saturation: the rail does double
          duty as the unread signal, which keeps a single column of meaning
          on the left edge instead of two competing stripes. */}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          kindTreatment.rail,
          isCompleted && "opacity-40",
        )}
      />
      {/* Subtle background tint for unread updates — kept from the old
          treatment because the rail alone isn't quite strong enough on a
          dense list. The colour is sky-tinted to match the Update rail
          (was primary/violet before, which clashed with the new Task rail). */}
      {isUnread && (
        <span
          aria-hidden
          className="absolute inset-0 bg-sky-500/[0.04] pointer-events-none"
        />
      )}
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
                // Always visible but muted by default so the affordance is
                // discoverable without hover. Sharpens on hover/focus.
                : "border-muted-foreground/40 opacity-40 group-hover:opacity-100 hover:border-foreground hover:bg-muted/40",
            )}
            title={selected ? "Deselecteer" : "Selecteer voor bulk-actie"}
          >
            {selected && <Check className="h-3 w-3" strokeWidth={3} />}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {/* Visual hierarchy (Roy 2026-06-10):
                1. Client — small bold, 14px. Scannable as the row's
                   subject, but doesn't outrank the headline.
                2. Title — 15px bold, the main signal. "What happened."
                   When there's no client (orphan / locked view) the
                   title is promoted to 16px to stay the row's anchor.
                3. Meta — 11px muted. Kind dot, source, status, people,
                   date, due, comments — all visually recessed.
              The left rail still carries kind colour for peripheral
              scanning; the bordered TYPE chip is gone (dot+label only)
              so it stops competing with the headline. */}

          {/* Row 1 — client. Compact, bold; reads as the row's subject. */}
          {showClient && item.isUnlinked && (
            <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
              <Link2Off className="h-3.5 w-3.5 text-amber-500/90 dark:text-amber-400 shrink-0" />
              <span
                className="text-sm font-semibold text-amber-500/90 dark:text-amber-400 truncate"
                title="This Trengo contact isn't linked to a client yet"
              >
                Unlinked contact
              </span>
              {isHighPriority && (
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              )}
            </div>
          )}
          {showClient && !item.isUnlinked && item.clientName && item.clientName !== "(unknown)" && (
            <div className="flex items-center gap-2 min-w-0 mb-0.5">
              <span className="text-sm font-semibold text-foreground/90 truncate">
                {item.clientName}
              </span>
              {isHighPriority && (
                <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              )}
            </div>
          )}

          {/* Row 2 — title. The primary headline of the row. Bold by
              default; line-through + muted when completed; promotes to
              16px when no client header is rendered above. */}
          {(() => {
            const hasClientHeader =
              showClient &&
              (item.isUnlinked ||
                (!!item.clientName && item.clientName !== "(unknown)"))
            const titleClass = cn(
              "truncate font-semibold",
              hasClientHeader ? "text-[15px]" : "text-base",
              isCompleted ? "text-muted-foreground" : "text-foreground",
              (item.status === "done" || item.status === "cancelled") &&
                "line-through",
            )
            return onAction ? (
              <RowTitle
                title={item.title}
                statusClass={titleClass}
                onSave={(title) => onAction({ type: "rename", title })}
              />
            ) : (
              <span className={titleClass}>{item.title}</span>
            )
          })()}

          {/* Row 3 — meta. Tiny, muted. Kind dot replaces the bordered
              chip; source + task-status pills still appear but stripped
              of background fills where possible. People-and-time trail
              uses very-faint separators so the comma-rhythm doesn't
              compete visually. */}
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground/75 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 font-medium uppercase tracking-wide text-[10px] text-muted-foreground/80 shrink-0"
              title={kindTreatment.label}
            >
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", kindTreatment.dot)}
              />
              {kindTreatment.label}
            </span>
            <SourcePill
              source={item.source}
              channelKind={item.channelKind}
            />
            {taskStatus && (
              <span
                className={`text-[10px] px-1.5 py-px rounded-full font-medium ${taskStatus.cls}`}
              >
                {taskStatus.label}
              </span>
            )}
            {!showClient && isHighPriority && (
              <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
            )}
            <span className="text-muted-foreground/30">·</span>
            <span>{item.authorName}</span>
            <span className="text-muted-foreground/30">→</span>
            <span>{item.assigneeName}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{fmtDate(item.createdAt)}</span>
            {item.dueDate && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1",
                    fmtDueDate(item.dueDate).overdue && "text-red-400",
                  )}
                >
                  <Calendar className="h-3 w-3" />
                  {fmtDueDate(item.dueDate).text}
                </span>
              </>
            )}
            {item.commentCount > 0 && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  {item.commentCount}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Unified right-side action set — renders the same Done / Reopen
            chrome for both Tasks and Updates. Kind-specific extras (Snooze
            for tasks, Make-task for updates) are wired inside RowActions. */}
        {onAction && <RowActions item={item} onAction={onAction} users={users} />}
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
  // check button on the right (Roy 2026-06-09 — the inbox affordance
  // should be identical across kinds, only the DB enum differs).
  const isActive = isUpdate
    ? item.status === "unread"
    : item.status === "open" || item.status === "in_progress"
  const isSnoozed = !!item.snoozedUntil && new Date(item.snoozedUntil).getTime() > Date.now()
  // Kind-specific status verbs — same UI, different underlying value.
  // Done flips status to "read" for updates, "done" for tasks. Reopen
  // does the inverse. The status check above already routes to the
  // right branch; this just picks the value to PATCH.
  const doneAction: RowAction = isUpdate ? "read" : "done"
  const reopenAction: RowAction = isUpdate ? "unread" : "reopen"

  return (
    <div className="flex items-center gap-1 shrink-0" onClick={stop}>
      {isActive ? (
        <>
          <ActionIconButton
            tone="success"
            label="Mark done"
            onClick={() => onAction(doneAction)}
            icon={<Check className="h-4 w-4" />}
          />
          {/* Tasks-only: snooze. The API rejects snoozedUntil for non-task
              kinds, so we never offer the affordance on updates. */}
          {!isUpdate && (
            isSnoozed ? (
              <ActionIconButton
                tone="muted"
                label={`Snoozed until ${formatSnoozeLabel(item.snoozedUntil!)} — click to wake`}
                onClick={() => onAction("unsnooze")}
                icon={<BellOff className="h-4 w-4" />}
              />
            ) : (
              <SnoozeButton onPick={(until) => onAction({ type: "snooze", until })} />
            )
          )}
          {/* Updates-only: convert to a task. Same affordance the standalone
              hover button used to be — now lives inline with the rest of
              the action set so the right-side cluster is consistent. */}
          {isUpdate && (
            <ActionIconButton
              tone="muted"
              label="Make task"
              onClick={() => onAction("make_task")}
              icon={<ListTodo className="h-4 w-4" />}
            />
          )}
          {users && users.length > 0 && (
            <ReassignButton
              users={users}
              currentAssigneeId={item.assigneeId}
              onPick={(assigneeId) => onAction({ type: "reassign", assigneeId })}
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
        </>
      ) : (
        <ActionIconButton
          tone="muted"
          label="Reopen"
          onClick={() => onAction(reopenAction)}
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

// ActionButton moved to src/components/ui/action-icon-button.tsx so the
// co-pilot bell + future row surfaces share one source of chrome.
