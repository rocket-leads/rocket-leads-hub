"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Plus,
  Inbox as InboxIcon,
  ListTodo,
  LayoutList,
  Mail,
  MailOpen,
  Circle,
  Clock,
  CircleCheck,
  AlertOctagon,
  CalendarDays,
  CalendarClock,
  CalendarX,
  ChevronDown,
  MessageCircle,
  Video,
  Check,
  X,
  Search,
  Trash2,
  UserCog,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { InboxListRow, type RowAction } from "./inbox-list-row"
import { ComposerDialog } from "./composer-dialog"
import { ItemDetailDialog } from "./item-detail-dialog"
import { ChatPane } from "./chat-pane"
import { CommunicationTab } from "@/app/(dashboard)/clients/[id]/_components/communication-tab"
import { MeetingsTab } from "@/app/(dashboard)/clients/[id]/_components/meetings-tab"
import type { InboxItem, InboxSource, TaskStatus, UpdateStatus } from "@/types/inbox"

export type InboxUser = { id: string; name: string | null; email: string; role: string }
export type InboxClientOption = {
  id: string
  name: string
  /** Whether the client is currently live (Hub-canonical status). The composer
   *  client picker pins live ones to the top so AMs see their active book
   *  first instead of having to type to find them. */
  isLive?: boolean
}
export type CurrentUser = { id: string; name: string; role: string }

type LockedClient = InboxClientOption & {
  /** Trengo contact ID — if present, the Client Inbox sub-tab renders the
   * Trengo conversation history for this client. Otherwise the tab is hidden. */
  trengoContactId?: string | null
  /** Role-based gate on the Client Inbox sub-tab. */
  canViewCommunication?: boolean
}

type Props = {
  currentUser: CurrentUser
  initialUpdates: InboxItem[]
  initialTasks: InboxItem[]
  users: InboxUser[]
  clients: InboxClientOption[]
  /** When set, the view is scoped to a single client (per-client tab). */
  lockedClient?: LockedClient
}

type MainTab = "tasks" | "updates" | "client-inbox" | "meetings"
type UpdateFilter = "all" | UpdateStatus
/**
 * Task filters intentionally cover only the active lifecycle: All / Open /
 * In progress / Done. Snoozed and Cancelled are treated as ARCHIVED state —
 * they don't get their own tab. Snoozed tasks come back automatically when
 * their snooze expires; Cancelled tasks are out for good (Cancel is the
 * "soft delete with audit trail" path; Bulk Delete is the hard remove).
 * Per Roy's call: "snooze items hoeven geen tab te zijn — die komen vanzelf
 * weer terug. Cancelled is gearchiveerd."
 */
type TaskFilter = "all" | "open" | "in_progress" | "done"

/** Secondary filter strip on Tasks: narrow by source. "all" shows everything;
 *  the chip strip below TASK_FILTERS only renders chips for sources that
 *  actually have tasks in the current status filter, so the row stays
 *  uncluttered when (e.g.) the user hasn't connected Slack yet. */
type TaskSourceFilter = "all" | InboxSource

const TASK_SOURCE_LABELS: Record<InboxSource, string> = {
  manual: "Manual",
  watchlist: "Watchlist",
  meeting: "Meetings",
  monday: "Monday",
  trengo: "Trengo",
  slack: "Slack",
  automation: "Automation",
}

const UPDATE_FILTERS: TopTab<UpdateFilter>[] = [
  { id: "all", label: "All updates", icon: LayoutList },
  { id: "unread", label: "Unread", icon: Mail },
  { id: "read", label: "Read", icon: MailOpen },
]

const TASK_FILTERS: TopTab<TaskFilter>[] = [
  { id: "open", label: "Open", icon: Circle },
  { id: "in_progress", label: "In progress", icon: Clock },
  { id: "done", label: "Done", icon: CircleCheck },
  { id: "all", label: "All", icon: LayoutList },
]

const ALL_UPDATE_STATUSES: UpdateStatus[] = ["unread", "read"]
// "All" excludes cancelled tasks — they're archived state and shouldn't
// clutter the active list. If a user explicitly needs to find a cancelled
// task, the row still exists in the DB; we'd add a dedicated Archive view
// when the need actually shows up.
const VISIBLE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done"]

const DEFAULT_UPDATE_FILTER: UpdateFilter = "unread"
const DEFAULT_TASK_FILTER: TaskFilter = "open"

export function InboxView({
  currentUser,
  initialUpdates,
  initialTasks,
  users,
  clients,
  lockedClient,
}: Props) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<MainTab>("tasks")
  const [assignedToMe, setAssignedToMe] = useState(true)
  const [updateFilter, setUpdateFilter] = useState<UpdateFilter>(DEFAULT_UPDATE_FILTER)
  const [taskFilter, setTaskFilter] = useState<TaskFilter>(DEFAULT_TASK_FILTER)
  const [taskSourceFilter, setTaskSourceFilter] = useState<TaskSourceFilter>("all")
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKind, setComposerKind] = useState<"update" | "task">("update")
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null)

  const updateStatuses = useMemo(
    () => (updateFilter === "all" ? ALL_UPDATE_STATUSES : [updateFilter]),
    [updateFilter],
  )
  const taskStatuses = useMemo(() => {
    if (taskFilter === "all") return VISIBLE_TASK_STATUSES
    return [taskFilter]
  }, [taskFilter])

  // Snoozed tasks are archived from every visible filter — they wake up
  // automatically when their snooze expires and pop back into Open. There's
  // no tab to surface them while they're parked, by design.
  const taskSnoozeMode: "active" = "active"

  const buildUrl = (kind: "update" | "task", statuses: string[]) => {
    const params = new URLSearchParams({ kind })
    if (assignedToMe && !lockedClient) params.set("assignedToMe", "true")
    if (lockedClient) params.set("clientId", lockedClient.id)
    params.set("statuses", statuses.join(","))
    if (kind === "task") params.set("snoozed", taskSnoozeMode)
    return `/api/inbox?${params.toString()}`
  }

  const updatesUsesDefaults =
    !lockedClient && assignedToMe && updateFilter === DEFAULT_UPDATE_FILTER
  const tasksUsesDefaults =
    !lockedClient && assignedToMe && taskFilter === DEFAULT_TASK_FILTER

  const updatesQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "update", { assignedToMe, clientId: lockedClient?.id, filter: updateFilter }],
    queryFn: () => fetch(buildUrl("update", updateStatuses)).then((r) => r.json()),
    initialData: updatesUsesDefaults ? { items: initialUpdates } : undefined,
    staleTime: 30 * 1000,
  })

  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "task", { assignedToMe, clientId: lockedClient?.id, filter: taskFilter, snooze: taskSnoozeMode }],
    queryFn: () => fetch(buildUrl("task", taskStatuses)).then((r) => r.json()),
    initialData: tasksUsesDefaults ? { items: initialTasks } : undefined,
    staleTime: 30 * 1000,
  })

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["inbox"] })
    queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
  }

  function openComposer(kind: "update" | "task") {
    setComposerKind(kind)
    setComposerOpen(true)
  }

  /**
   * PATCH a row optimistically.
   *
   * Two modes for how we touch the local cache before the server replies:
   *
   *   - "remove": the row disappears from every matching list query. Used
   *     for actions that take the row out of the current view by definition
   *     — Done, Cancel, Snooze (default filters hide snoozed), Reassign-away
   *     (when "Assigned to me" is on and the new assignee isn't the actor).
   *
   *   - "mutate": the row stays visible but its fields update. The optional
   *     `optimisticPatch` mirrors what the server is about to write so the
   *     UI reflects it immediately (e.g. due date moves Today → Friday and
   *     the row jumps between groups; assignee name updates in place).
   *
   * On error we roll back from a snapshot. On success we invalidate so the
   * next render reconciles with the server (cheap — the result is identical
   * to our optimistic guess in 99% of cases).
   */
  async function patchItem(
    itemId: string,
    patch: Record<string, unknown>,
    options: {
      mode: "remove" | "mutate"
      optimisticPatch?: Partial<InboxItem>
    } = { mode: "mutate" },
  ) {
    const snapshots = queryClient.getQueriesData<{ items: InboxItem[] }>({
      queryKey: ["inbox"],
    })

    queryClient.setQueriesData<{ items: InboxItem[] }>(
      { queryKey: ["inbox"] },
      (data) => {
        if (!data?.items) return data
        if (options.mode === "remove") {
          return { ...data, items: data.items.filter((it) => it.id !== itemId) }
        }
        const merge = options.optimisticPatch ?? {}
        return {
          ...data,
          items: data.items.map((it) =>
            it.id === itemId ? { ...it, ...merge } : it,
          ),
        }
      },
    )

    try {
      const res = await fetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`)
    } catch (err) {
      // Roll back every snapshot we touched. Cheap — these are tiny lists.
      for (const [key, data] of snapshots) {
        queryClient.setQueryData(key, data)
      }
      console.error("patchItem failed, rolled back", err)
    } finally {
      // Reconcile with server regardless of success/failure. On success this
      // is a no-op visually; on failure it pulls the server's authoritative
      // state in case our snapshot drifted.
      refreshAll()
    }
  }

  /**
   * Permanently delete a row. Same optimistic-then-rollback pattern as
   * patchItem with mode=remove, but hits DELETE /api/inbox/:id instead of
   * PATCH. Used by the bulk-delete button. The server gates DELETE to
   * author/admin — auto-ingested rows (Trengo/Monday/Fathom/automation,
   * authored by the system HQ user) are admin-only delete, which is the
   * intended behaviour: an AM can Cancel a task they don't want, but only
   * an admin can wipe the audit trail entirely.
   */
  async function deleteItem(itemId: string) {
    const snapshots = queryClient.getQueriesData<{ items: InboxItem[] }>({
      queryKey: ["inbox"],
    })
    queryClient.setQueriesData<{ items: InboxItem[] }>(
      { queryKey: ["inbox"] },
      (data) => {
        if (!data?.items) return data
        return { ...data, items: data.items.filter((it) => it.id !== itemId) }
      },
    )
    try {
      const res = await fetch(`/api/inbox/${itemId}`, { method: "DELETE" })
      if (!res.ok) throw new Error(`DELETE failed (${res.status})`)
    } catch (err) {
      for (const [key, data] of snapshots) queryClient.setQueryData(key, data)
      console.error("deleteItem failed, rolled back", err)
    } finally {
      refreshAll()
    }
  }

  const allUpdates = updatesQuery.data?.items ?? []
  const allTasks = tasksQuery.data?.items ?? []

  // Free-text search over the loaded items. Cheap client-side filter — no
  // round-trip needed since the lists are already capped by the server-side
  // `assignedToMe`/status filters. Searches title, body, client name and
  // author, so an AM can find "that thing about Vlex" via either the client
  // or a quoted phrase from the body.
  const [searchQuery, setSearchQuery] = useState("")
  const filteredUpdates = useMemo(
    () => filterByQuery(allUpdates, searchQuery),
    [allUpdates, searchQuery],
  )
  const queryFilteredTasks = useMemo(
    () => filterByQuery(allTasks, searchQuery),
    [allTasks, searchQuery],
  )
  // Per-source counts feed both the chip strip ("Monday 4") and the auto-
  // hide rule (sources with 0 items don't render a chip). Counts respect
  // the current status filter + search query but ignore the source filter
  // itself, so picking a source doesn't make the other chips disappear.
  const taskSourceCounts = useMemo(() => {
    const counts: Partial<Record<InboxSource, number>> = {}
    for (const t of queryFilteredTasks) {
      counts[t.source] = (counts[t.source] ?? 0) + 1
    }
    return counts
  }, [queryFilteredTasks])
  const tasks = useMemo(
    () =>
      taskSourceFilter === "all"
        ? queryFilteredTasks
        : queryFilteredTasks.filter((t) => t.source === taskSourceFilter),
    [queryFilteredTasks, taskSourceFilter],
  )
  const updates = filteredUpdates

  // Per-client view (locked-client tab on client detail page) surfaces
  // tasks/updates linked to that client plus a Client Inbox (Trengo
  // conversations) and Meetings sub-tab — keeping all per-client activity
  // under one tab. Global mode shows the cross-client Client Inbox.
  // Team Inbox (Slack DMs) is intentionally not shown — Slack's API can't
  // expose human-to-human DMs, so we replace that workflow in Phase E
  // (Hub-native team chat) instead of half-syncing it.
  const mainTabs: TopTab<MainTab>[] = lockedClient
    ? [
        { id: "tasks", label: "Tasks", icon: ListTodo, count: tasks.length },
        { id: "updates", label: "Updates", icon: InboxIcon, count: updates.length },
        ...(lockedClient.canViewCommunication
          ? [{ id: "client-inbox" as const, label: "Client Inbox", icon: MessageCircle }]
          : []),
        { id: "meetings", label: "Meetings", icon: Video },
      ]
    : [
        { id: "tasks", label: "Tasks", icon: ListTodo, count: tasks.length },
        { id: "updates", label: "Updates", icon: InboxIcon, count: updates.length },
        { id: "client-inbox", label: "Client Inbox", icon: MessageCircle },
      ]

  const isChatTab = activeTab === "client-inbox"
  const isClientOnlyTab = activeTab === "meetings" || (!!lockedClient && activeTab === "client-inbox")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Inbox</h1>
        </div>
        <div className="flex items-center gap-2">
          {!isChatTab && !isClientOnlyTab && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setSearchQuery("")
                }}
                placeholder="Search inbox…"
                className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-7 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 inline-flex items-center justify-center"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {!lockedClient && (
            <Button
              variant={assignedToMe ? "default" : "outline"}
              size="sm"
              onClick={() => setAssignedToMe((v) => !v)}
            >
              {assignedToMe ? "Assigned to me" : "All"}
            </Button>
          )}
          {!isChatTab && !isClientOnlyTab && (
            <Button size="sm" onClick={() => openComposer(activeTab === "tasks" ? "task" : "update")}>
              <Plus className="h-4 w-4" />
              New {activeTab === "tasks" ? "task" : "update"}
            </Button>
          )}
        </div>
      </div>

      <TopTabs<MainTab> tabs={mainTabs} value={activeTab} onChange={setActiveTab} />

      <div className="space-y-4">
        {activeTab === "tasks" && (
          <>
            <TopTabs<TaskFilter>
              tabs={TASK_FILTERS}
              value={taskFilter}
              onChange={setTaskFilter}
            />
            <TaskSourceChips
              value={taskSourceFilter}
              onChange={setTaskSourceFilter}
              counts={taskSourceCounts}
              totalCount={queryFilteredTasks.length}
            />
            <QuickAddTaskBar
              clients={clients}
              lockedClient={lockedClient}
              currentUserId={currentUser.id}
              onCreated={refreshAll}
            />
            {tasksQuery.isLoading ? (
              <EmptyState text="Loading tasks…" />
            ) : tasks.length === 0 ? (
              <EmptyState
                text={
                  taskFilter === "all"
                    ? "No tasks yet."
                    : `No ${TASK_FILTERS.find((f) => f.id === taskFilter)?.label.toLowerCase()} tasks${assignedToMe ? " assigned to you" : ""}.`
                }
                onCreate={() => openComposer("task")}
              />
            ) : (
              <GroupedTasks
                tasks={tasks}
                showClient={!lockedClient}
                users={users}
                onBulkDelete={(ids) => {
                  // Fan out DELETEs through the optimistic-remove path. The
                  // server gates DELETE to author/admin, so non-admin AMs
                  // attempting to delete auto-ingested rows will see them
                  // re-appear after the rollback — which is the correct
                  // signal that they should Cancel instead of Delete.
                  for (const id of ids) deleteItem(id)
                }}
                onItemClick={(item) => setDetailItem(item)}
                onAction={(item, action) => {
                  // Optimistic strategy:
                  //   - Terminal status changes (done/cancel) and snooze leave
                  //     the active list under default filters — REMOVE so the
                  //     row disappears immediately.
                  //   - Reopen and unsnooze keep the row in the list — MUTATE.
                  //   - Reschedule keeps the row but the date changes (it may
                  //     jump between Overdue/Today/Upcoming) — MUTATE.
                  //   - Reassign: when filter is "Assigned to me" and the new
                  //     assignee isn't me, the row should leave — REMOVE.
                  //     Otherwise MUTATE in place with the new name resolved
                  //     from the users list.
                  if (action === "done") {
                    patchItem(item.id, { status: "done" }, { mode: "remove" })
                  } else if (action === "cancel") {
                    patchItem(item.id, { status: "cancelled" }, { mode: "remove" })
                  } else if (action === "reopen") {
                    patchItem(
                      item.id,
                      { status: "open" },
                      { mode: "mutate", optimisticPatch: { status: "open" } },
                    )
                  } else if (action === "unsnooze") {
                    patchItem(
                      item.id,
                      { snoozedUntil: null },
                      { mode: "mutate", optimisticPatch: { snoozedUntil: null } },
                    )
                  } else if (typeof action === "object" && action.type === "snooze") {
                    patchItem(
                      item.id,
                      { snoozedUntil: action.until },
                      { mode: "remove" },
                    )
                  } else if (typeof action === "object" && action.type === "reassign") {
                    const leavingMyView =
                      assignedToMe && action.assigneeId !== currentUser.id
                    if (leavingMyView) {
                      patchItem(
                        item.id,
                        { assigneeId: action.assigneeId },
                        { mode: "remove" },
                      )
                    } else {
                      const u = users.find((x) => x.id === action.assigneeId)
                      patchItem(
                        item.id,
                        { assigneeId: action.assigneeId },
                        {
                          mode: "mutate",
                          optimisticPatch: {
                            assigneeId: action.assigneeId,
                            assigneeName: u?.name ?? u?.email ?? item.assigneeName,
                          },
                        },
                      )
                    }
                  } else if (typeof action === "object" && action.type === "reschedule") {
                    patchItem(
                      item.id,
                      { dueDate: action.dueDate },
                      { mode: "mutate", optimisticPatch: { dueDate: action.dueDate } },
                    )
                  } else if (typeof action === "object" && action.type === "rename") {
                    patchItem(
                      item.id,
                      { title: action.title },
                      { mode: "mutate", optimisticPatch: { title: action.title } },
                    )
                  }
                }}
              />
            )}
          </>
        )}

        {activeTab === "updates" && (
          <>
            <TopTabs<UpdateFilter>
              tabs={UPDATE_FILTERS}
              value={updateFilter}
              onChange={setUpdateFilter}
            />
            {updatesQuery.isLoading ? (
              <EmptyState text="Loading updates…" />
            ) : updates.length === 0 ? (
              <EmptyState
                text={
                  updateFilter === "all"
                    ? "No updates yet."
                    : `No ${updateFilter} updates${assignedToMe ? " assigned to you" : ""}.`
                }
                onCreate={() => openComposer("update")}
              />
            ) : (
              <GroupedUpdates
                updates={updates}
                showClient={!lockedClient}
                onItemClick={(item) => setDetailItem(item)}
                onAction={(item, action) => {
                  // Updates: Read/Unread is a per-row toggle that should leave
                  // the row visible regardless of filter — even when the
                  // current filter is e.g. "Unread", flipping a row is
                  // already a UX feedback signal. We mutate in place; the
                  // background invalidate will quietly drop it from the list
                  // on the next refetch if the filter no longer matches.
                  if (action === "read") {
                    patchItem(
                      item.id,
                      { status: "read" },
                      { mode: "mutate", optimisticPatch: { status: "read" } },
                    )
                  } else if (action === "unread") {
                    patchItem(
                      item.id,
                      { status: "unread" },
                      { mode: "mutate", optimisticPatch: { status: "unread" } },
                    )
                  } else if (action === "make_task") {
                    // Convert to task: server resets status='open' +
                    // priority='normal' on kind change; we also default the
                    // due date to today so the converted task lands in the
                    // Today section ready to act on. Optimistic remove from
                    // the Updates list — the row migrates to Tasks.
                    const today = new Date().toISOString().slice(0, 10)
                    patchItem(
                      item.id,
                      { kind: "task", dueDate: today },
                      { mode: "remove" },
                    )
                  }
                }}
              />
            )}
          </>
        )}

        {activeTab === "client-inbox" && (
          lockedClient ? (
            <CommunicationTab
              mondayItemId={lockedClient.id}
              trengoContactId={lockedClient.trengoContactId ?? null}
            />
          ) : (
            <ChatPane scope="external" users={users} />
          )
        )}

        {activeTab === "meetings" && lockedClient && (
          <MeetingsTab mondayItemId={lockedClient.id} />
        )}
      </div>

      <ComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        defaultKind={composerKind}
        users={users}
        clients={clients}
        lockedClient={lockedClient}
        currentUserId={currentUser.id}
        onCreated={() => {
          setComposerOpen(false)
          refreshAll()
        }}
      />

      {detailItem && (
        <ItemDetailDialog
          itemId={detailItem.id}
          currentUser={currentUser}
          users={users}
          onClose={() => setDetailItem(null)}
          onChanged={refreshAll}
        />
      )}
    </div>
  )
}

function EmptyState({ text, onCreate }: { text: string; onCreate?: () => void }) {
  return (
    <div className="border border-dashed border-border/40 rounded-lg p-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {onCreate && (
        <Button size="sm" className="mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Create one
        </Button>
      )}
    </div>
  )
}

/**
 * Inline quick-add bar for tasks. Sits at the top of the Tasks tab; type a
 * title, pick a client (or skip if locked-client), Enter creates the task on
 * the current user with due=today. Aimed at the mid-triage moment when the
 * AM thinks "I need to do X for klant Y" — full composer dialog is overkill
 * and breaks flow.
 *
 * Behaviour:
 *  - Title input is the focused affordance — wide and always-visible.
 *  - Client picker collapses to nothing when lockedClient is set (we already
 *    know who it's for).
 *  - Date defaults to today; user can override before submit.
 *  - Enter on title submits when both title and client are filled. If client
 *    is missing, focus jumps to the picker instead so the user knows what's
 *    blocking.
 *  - After successful submit, the title clears but the client selection
 *    sticks — so quick-adding multiple tasks for the same client is fast.
 *  - On error, message shows under the bar; nothing else changes.
 */
function QuickAddTaskBar({
  clients,
  lockedClient,
  currentUserId,
  onCreated,
}: {
  clients: InboxClientOption[]
  lockedClient?: InboxClientOption
  currentUserId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState("")
  const [clientId, setClientId] = useState<string>(lockedClient?.id ?? "")
  const [dueDate, setDueDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)
  const clientWrapRef = useRef<HTMLDivElement>(null)

  // If the locked client changes (per-client tab navigation), reseed.
  useEffect(() => {
    if (lockedClient?.id) setClientId(lockedClient.id)
  }, [lockedClient?.id])

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed) {
      titleRef.current?.focus()
      return
    }
    if (!clientId) {
      setError("Pick a client first.")
      // Move focus to the client picker so the user can fill it in.
      const input = clientWrapRef.current?.querySelector<HTMLInputElement>("input")
      input?.focus()
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "task",
          clientId,
          assigneeId: currentUserId,
          title: trimmed,
          dueDate,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Create failed (${res.status})`)
      }
      // Keep the client selection so multi-add for the same klant stays fast.
      setTitle("")
      titleRef.current?.focus()
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task")
    } finally {
      setSubmitting(false)
    }
  }

  const showClient = !lockedClient

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-muted-foreground/70 shrink-0" />
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              submit()
            } else if (e.key === "Escape") {
              setTitle("")
            }
          }}
          placeholder="Add a task — type and Enter"
          disabled={submitting}
          className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:opacity-50"
        />
        {showClient && (
          <div ref={clientWrapRef} className="w-48 shrink-0">
            <QuickClientPicker
              clients={clients}
              value={clientId}
              onChange={(id) => {
                setClientId(id)
                if (error) setError(null)
              }}
            />
          </div>
        )}
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          title="Due date"
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="shrink-0"
        >
          Add
        </Button>
      </div>
      {error && (
        <p className="text-[11px] text-red-400 mt-1.5 ml-6">{error}</p>
      )}
    </div>
  )
}

/** Compact searchable client picker for the quick-add bar. Same pattern as
 *  the composer's ClientCombobox but visually denser and live-first sorted.
 *  Kept private to this file because the composer's picker is shaped for the
 *  taller dialog layout. */
function QuickClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: InboxClientOption[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => clients.find((c) => c.id === value) ?? null, [clients, value])

  useEffect(() => {
    if (!value) setQuery("")
    else if (selected) setQuery(selected.name)
  }, [value, selected])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const filtered = useMemo(() => {
    const sorted = [...clients].sort((a, b) => {
      if (!!a.isLive !== !!b.isLive) return a.isLive ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const q = query.trim().toLowerCase()
    if (!q) return sorted.slice(0, 50)
    return sorted.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50)
  }, [clients, query])

  function pick(c: InboxClientOption) {
    onChange(c.id)
    setQuery(c.name)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        placeholder="Pick client…"
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (selected && e.target.value !== selected.name) onChange("")
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && filtered[0]) {
            e.preventDefault()
            pick(filtered[0])
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-md border border-border bg-popover shadow-lg py-1">
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => {
                // mousedown so the click fires before the input's onBlur closes
                // the popover — otherwise the click would be swallowed.
                e.preventDefault()
                pick(c)
              }}
              className={cn(
                "w-full text-left px-2.5 py-1 text-xs hover:bg-muted/60 flex items-center justify-between gap-2",
                c.id === value && "bg-muted/60",
              )}
            >
              <span className="truncate">{c.name}</span>
              {c.isLive && (
                <span className="text-[9px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 shrink-0">
                  Live
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Grouping helpers ----------------------------------------------------

function startOfDay(d: Date | string): Date {
  const x = typeof d === "string" ? new Date(d) : new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

type TaskGroups = {
  overdue: InboxItem[]
  today: InboxItem[]
  upcoming: InboxItem[]
}

function groupTasksByDeadline(tasks: InboxItem[]): TaskGroups {
  const today = startOfDay(new Date())
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [] }
  for (const t of tasks) {
    // No due date = treat as Today. Roy's directive: composer enforces a
    // due date on every new task, but historical rows or auto-ingested ones
    // may still be null — surface them in the most actionable bucket rather
    // than hiding them in a "No due date" section that requires extra
    // clicks to find.
    if (!t.dueDate) {
      groups.today.push(t)
      continue
    }
    const due = startOfDay(t.dueDate).getTime()
    const todayMs = today.getTime()
    if (due < todayMs) groups.overdue.push(t)
    else if (due === todayMs) groups.today.push(t)
    else groups.upcoming.push(t)
  }
  // Sort: overdue most-overdue first, today/upcoming earliest-due first.
  groups.overdue.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
  groups.today.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  groups.upcoming.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
  return groups
}

type UpdateGroups = {
  today: InboxItem[]
  yesterday: InboxItem[]
  thisWeek: InboxItem[]
  older: InboxItem[]
}

function groupUpdatesByDate(updates: InboxItem[]): UpdateGroups {
  const todayMs = startOfDay(new Date()).getTime()
  const yesterdayMs = todayMs - 24 * 60 * 60 * 1000
  const sevenDaysMs = todayMs - 7 * 24 * 60 * 60 * 1000
  const groups: UpdateGroups = { today: [], yesterday: [], thisWeek: [], older: [] }
  for (const u of updates) {
    const created = startOfDay(u.createdAt).getTime()
    if (created === todayMs) groups.today.push(u)
    else if (created === yesterdayMs) groups.yesterday.push(u)
    else if (created >= sevenDaysMs) groups.thisWeek.push(u)
    else groups.older.push(u)
  }
  // Newest first within each group.
  for (const arr of Object.values(groups) as InboxItem[][]) {
    arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return groups
}

const SECTION_TONES = {
  red: {
    bar: "bg-red-500",
    bg: "bg-red-500/10 hover:bg-red-500/15",
    text: "text-red-700 dark:text-red-400",
    iconBg: "bg-red-500/20 text-red-600 dark:text-red-400",
  },
  amber: {
    bar: "bg-amber-500",
    bg: "bg-amber-500/10 hover:bg-amber-500/15",
    text: "text-amber-800 dark:text-amber-400",
    iconBg: "bg-amber-500/20 text-amber-700 dark:text-amber-400",
  },
  emerald: {
    bar: "bg-emerald-500",
    bg: "bg-emerald-500/10 hover:bg-emerald-500/15",
    text: "text-emerald-700 dark:text-emerald-400",
    iconBg: "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  },
  muted: {
    bar: "bg-muted-foreground/30",
    bg: "bg-muted/40 hover:bg-muted/60",
    text: "text-foreground/80",
    iconBg: "bg-muted-foreground/15 text-muted-foreground",
  },
} as const

type SectionTone = keyof typeof SECTION_TONES

function SectionHeader({
  icon: Icon,
  label,
  count,
  tone,
  collapsed,
  onToggle,
}: {
  icon: typeof AlertOctagon
  label: string
  count: number
  tone: SectionTone
  collapsed: boolean
  onToggle: () => void
}) {
  const t = SECTION_TONES[tone]
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`group w-full flex items-stretch gap-3 rounded-lg overflow-hidden transition-colors ${t.bg} mb-2`}
    >
      <span className={`w-1 shrink-0 ${t.bar}`} aria-hidden />
      <div className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5">
        <span className={`h-7 w-7 rounded-md flex items-center justify-center shrink-0 ${t.iconBg}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className={`text-sm font-semibold ${t.text}`}>{label}</span>
        <span className={`text-xs tabular-nums ${t.text} opacity-70`}>{count}</span>
        <ChevronDown
          className={`h-4 w-4 ml-auto transition-transform ${t.text} opacity-50 group-hover:opacity-100 ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      </div>
    </button>
  )
}

type TaskAction =
  | Extract<RowAction, "done" | "cancel" | "reopen" | "unsnooze">
  | { type: "snooze"; until: string }
  | { type: "reassign"; assigneeId: string }
  | { type: "reschedule"; dueDate: string }
  | { type: "rename"; title: string }

function TaskGroupSection({
  icon,
  label,
  tone,
  items,
  showClient,
  collapsed,
  onToggle,
  onItemClick,
  onAction,
  selectedIds,
  onToggleSelect,
  users,
}: {
  icon: typeof AlertOctagon
  label: string
  tone: SectionTone
  items: InboxItem[]
  showClient: boolean
  collapsed: boolean
  onToggle: () => void
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: TaskAction) => void
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  users?: InboxUser[]
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader
        icon={icon}
        label={label}
        count={items.length}
        tone={tone}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="space-y-2 mb-1">
          {items.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient={showClient}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              onClick={() => onItemClick(item)}
              users={users}
              onAction={(action) => {
                if (
                  action === "done" ||
                  action === "cancel" ||
                  action === "reopen" ||
                  action === "unsnooze" ||
                  (typeof action === "object" &&
                    (action.type === "snooze" ||
                      action.type === "reassign" ||
                      action.type === "reschedule" ||
                      action.type === "rename"))
                ) {
                  onAction(item, action as TaskAction)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Collapse state per task section, persisted in localStorage so closing
 *  Overdue (after working through it) stays closed across reloads. */
type TaskSectionKey = "overdue" | "today" | "upcoming"

function useTaskCollapse() {
  const [collapsed, setCollapsed] = useState<Record<TaskSectionKey, boolean>>({
    overdue: false,
    today: false,
    upcoming: false,
  })

  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("inbox.taskCollapse")
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<Record<TaskSectionKey, boolean>>
      setCollapsed((s) => ({ ...s, ...parsed }))
    } catch {
      // ignore — bad localStorage shouldn't break the page
    }
  }, [])

  function toggle(key: TaskSectionKey) {
    setCollapsed((s) => {
      const next = { ...s, [key]: !s[key] }
      try {
        localStorage.setItem("inbox.taskCollapse", JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  return { collapsed, toggle }
}

function GroupedTasks({
  tasks,
  showClient,
  onItemClick,
  onAction,
  onBulkDelete,
  users,
}: {
  tasks: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: TaskAction) => void
  /** Bulk delete handler — gets the selected ids and is responsible for
   *  fanning out DELETE requests with optimistic cache removal. Optional
   *  because the per-row UI never deletes (Cancel is the row-level
   *  equivalent); only the bulk bar offers permanent delete. */
  onBulkDelete: (ids: string[]) => void
  users?: InboxUser[]
}) {
  const groups = useMemo(() => groupTasksByDeadline(tasks), [tasks])
  const { collapsed, toggle } = useTaskCollapse()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Auto-prune selection when items leave the visible set (filter switch,
  // task closed via single-row action, etc.). Without this, ghost ids stay
  // selected and the bulk bar lies about the count.
  useEffect(() => {
    const visible = new Set(tasks.map((t) => t.id))
    setSelectedIds((prev) => {
      let dirty = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
        else dirty = true
      }
      return dirty ? next : prev
    })
  }, [tasks])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function handleBulk(action: TaskAction) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    // Optimistic clear — fan out the per-item PATCHes through the existing
    // single-item action handler so each fires through patchItem + cache
    // invalidation in the parent.
    const items = tasks.filter((t) => selectedIds.has(t.id))
    clearSelection()
    for (const item of items) onAction(item, action)
  }

  function handleBulkDeleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    // Confirm explicitly — delete is destructive and there's no undo path.
    // Cancel is the soft alternative; if the user wanted that they'd have
    // hit the X button instead.
    const ok = window.confirm(
      `Permanently delete ${ids.length} task${ids.length === 1 ? "" : "s"}? This can't be undone.`,
    )
    if (!ok) return
    clearSelection()
    onBulkDelete(ids)
  }

  return (
    <div className="space-y-3 pb-20">
      <TaskGroupSection
        icon={AlertOctagon}
        label="Overdue"
        tone="red"
        items={groups.overdue}
        showClient={showClient}
        collapsed={collapsed.overdue}
        onToggle={() => toggle("overdue")}
        onItemClick={onItemClick}
        onAction={onAction}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        users={users}
      />
      <TaskGroupSection
        icon={CalendarDays}
        label="Today"
        tone="amber"
        items={groups.today}
        showClient={showClient}
        collapsed={collapsed.today}
        onToggle={() => toggle("today")}
        onItemClick={onItemClick}
        onAction={onAction}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        users={users}
      />
      <TaskGroupSection
        icon={CalendarClock}
        label="Upcoming"
        tone="muted"
        items={groups.upcoming}
        showClient={showClient}
        collapsed={collapsed.upcoming}
        onToggle={() => toggle("upcoming")}
        onItemClick={onItemClick}
        onAction={onAction}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        users={users}
      />

      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onClear={clearSelection}
          onBulk={handleBulk}
          onDelete={handleBulkDeleteSelected}
          users={users}
        />
      )}
    </div>
  )
}

/**
 * Floating bottom bar that appears when 1+ tasks are selected. Lets the AM
 * batch through the inbox: mark Done, Snooze, Reschedule, Reassign, Cancel,
 * or permanently Delete a stack of tasks without opening each detail.
 *
 * Reassign uses a searchable user popover (same pattern as the per-row one,
 * just anchored above the bar instead of below). Delete confirms first
 * because it can't be undone — Cancel is the soft alternative for
 * "this isn't relevant" without losing the audit trail.
 */
function BulkActionBar({
  count,
  onClear,
  onBulk,
  onDelete,
  users,
}: {
  count: number
  onClear: () => void
  onBulk: (action: TaskAction) => void
  onDelete: () => void
  users?: InboxUser[]
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-full border border-border bg-popover shadow-lg px-2 py-1.5">
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} {count === 1 ? "geselecteerd" : "geselecteerd"}
      </span>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={() => onBulk("done")}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        title="Markeer geselecteerde taken als done"
      >
        <Check className="h-3.5 w-3.5" />
        Done
      </button>
      <BulkSnoozeButton
        onPick={(until) => onBulk({ type: "snooze", until })}
      />
      <BulkRescheduleButton
        onPick={(dueDate) => onBulk({ type: "reschedule", dueDate })}
      />
      {users && users.length > 0 && (
        <BulkReassignButton
          users={users}
          onPick={(assigneeId) => onBulk({ type: "reassign", assigneeId })}
        />
      )}
      <button
        type="button"
        onClick={() => onBulk("cancel")}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
        title="Annuleer geselecteerde taken"
      >
        <X className="h-3.5 w-3.5" />
        Cancel
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-red-500/15 hover:text-red-500 transition-colors"
        title="Verwijder geselecteerde taken — dit kan niet ongedaan worden"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="text-[11px] text-muted-foreground hover:text-foreground px-2"
        title="Selectie wissen"
      >
        Clear
      </button>
    </div>
  )
}

/** Bulk reschedule popover — same Today/Tomorrow/Next-Monday/+1-week chips
 *  as the per-row date picker, plus a custom date input. Anchored ABOVE
 *  the bar instead of below since the bar lives at the bottom of the
 *  viewport. */
function BulkRescheduleButton({ onPick }: { onPick: (dueDate: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  function pickPreset(option: "today" | "tomorrow" | "next_monday" | "in_1_week") {
    setOpen(false)
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    if (option === "tomorrow") d.setDate(d.getDate() + 1)
    else if (option === "next_monday") {
      const daysUntilMon = (1 - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + daysUntilMon)
    } else if (option === "in_1_week") d.setDate(d.getDate() + 7)
    onPick(d.toISOString().slice(0, 10))
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
        title="Reschedule geselecteerde taken"
      >
        <CalendarDays className="h-3.5 w-3.5" />
        Reschedule
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-48 rounded-md border border-border bg-popover shadow-lg py-1 text-xs">
          <button
            type="button"
            onClick={() => pickPreset("today")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => pickPreset("tomorrow")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Tomorrow
          </button>
          <button
            type="button"
            onClick={() => pickPreset("next_monday")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Next Monday
          </button>
          <button
            type="button"
            onClick={() => pickPreset("in_1_week")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            In 1 week
          </button>
          <div className="border-t border-border/60 mt-1 pt-1.5 px-2 pb-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
              Custom date
            </label>
            <input
              type="date"
              onChange={(e) => {
                if (e.target.value) {
                  setOpen(false)
                  onPick(e.target.value)
                }
              }}
              className="w-full rounded-sm bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            />
          </div>
        </div>
      )}
    </div>
  )
}

/** Bulk reassign popover. Searchable user list, anchored above the bar.
 *  Matches the per-row ReassignButton styling but lives in the bulk bar. */
function BulkReassignButton({
  users,
  onPick,
}: {
  users: InboxUser[]
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

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => `${u.name ?? ""} ${u.email}`.toLowerCase().includes(q))
  }, [users, query])

  function pick(userId: string) {
    setOpen(false)
    onPick(userId)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
        title="Reassign geselecteerde taken"
      >
        <UserCog className="h-3.5 w-3.5" />
        Reassign
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 left-0 w-60 rounded-md border border-border bg-popover shadow-lg text-xs">
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
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u.id)}
                  className="w-full text-left px-3 py-1.5 hover:bg-muted/60 flex items-center gap-2"
                >
                  <span className="truncate">
                    <span className="font-medium">{u.name ?? u.email}</span>
                    {u.name && (
                      <span className="text-muted-foreground/60 ml-1 text-[10px]">{u.email}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BulkSnoozeButton({ onPick }: { onPick: (until: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  function pick(option: "tomorrow_morning" | "next_week" | "in_2_weeks") {
    setOpen(false)
    const now = new Date()
    let d: Date
    if (option === "tomorrow_morning") {
      d = new Date(now)
      d.setDate(d.getDate() + 1)
      d.setHours(9, 0, 0, 0)
    } else if (option === "next_week") {
      d = new Date(now)
      const daysUntilMon = (1 - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + daysUntilMon)
      d.setHours(9, 0, 0, 0)
    } else {
      d = new Date(now)
      d.setDate(d.getDate() + 14)
      d.setHours(9, 0, 0, 0)
    }
    onPick(d.toISOString())
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
        title="Snooze geselecteerde taken"
      >
        <Clock className="h-3.5 w-3.5" />
        Snooze
      </button>
      {open && (
        <div className="absolute bottom-full mb-2 right-0 w-44 rounded-md border border-border bg-popover shadow-lg py-1 text-xs">
          <button
            type="button"
            onClick={() => pick("tomorrow_morning")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Morgen ochtend
          </button>
          <button
            type="button"
            onClick={() => pick("next_week")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Volgende week
          </button>
          <button
            type="button"
            onClick={() => pick("in_2_weeks")}
            className="w-full text-left px-3 py-1.5 hover:bg-muted/60"
          >
            Over 2 weken
          </button>
        </div>
      )}
    </div>
  )
}

type UpdateAction = "read" | "unread" | "make_task"

function UpdateGroupSection({
  icon,
  label,
  tone,
  items,
  showClient,
  collapsed,
  onToggle,
  onItemClick,
  onAction,
}: {
  icon: typeof CalendarDays
  label: string
  tone: SectionTone
  items: InboxItem[]
  showClient: boolean
  collapsed: boolean
  onToggle: () => void
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: UpdateAction) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader
        icon={icon}
        label={label}
        count={items.length}
        tone={tone}
        collapsed={collapsed}
        onToggle={onToggle}
      />
      {!collapsed && (
        <div className="space-y-2 mb-1">
          {items.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient={showClient}
              onClick={() => onItemClick(item)}
              onAction={(action) => {
                if (action === "read" || action === "unread" || action === "make_task") {
                  onAction(item, action)
                }
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type UpdateSectionKey = "today" | "yesterday" | "thisWeek" | "older"

function useUpdateCollapse() {
  const [collapsed, setCollapsed] = useState<Record<UpdateSectionKey, boolean>>({
    today: false,
    yesterday: false,
    thisWeek: true, // default-collapsed — older context, less actionable
    older: true,
  })
  useEffect(() => {
    try {
      const raw = localStorage.getItem("inbox.updateCollapse")
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<Record<UpdateSectionKey, boolean>>
      setCollapsed((s) => ({ ...s, ...parsed }))
    } catch {
      // ignore
    }
  }, [])
  function toggle(key: UpdateSectionKey) {
    setCollapsed((s) => {
      const next = { ...s, [key]: !s[key] }
      try {
        localStorage.setItem("inbox.updateCollapse", JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }
  return { collapsed, toggle }
}

function GroupedUpdates({
  updates,
  showClient,
  onItemClick,
  onAction,
}: {
  updates: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: UpdateAction) => void
}) {
  const groups = useMemo(() => groupUpdatesByDate(updates), [updates])
  const { collapsed, toggle } = useUpdateCollapse()
  return (
    <div className="space-y-3">
      <UpdateGroupSection
        icon={CalendarDays}
        label="Today"
        tone="emerald"
        items={groups.today}
        showClient={showClient}
        collapsed={collapsed.today}
        onToggle={() => toggle("today")}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarDays}
        label="Yesterday"
        tone="amber"
        items={groups.yesterday}
        showClient={showClient}
        collapsed={collapsed.yesterday}
        onToggle={() => toggle("yesterday")}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarClock}
        label="This week"
        tone="muted"
        items={groups.thisWeek}
        showClient={showClient}
        collapsed={collapsed.thisWeek}
        onToggle={() => toggle("thisWeek")}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarX}
        label="Older"
        tone="muted"
        items={groups.older}
        showClient={showClient}
        collapsed={collapsed.older}
        onToggle={() => toggle("older")}
        onItemClick={onItemClick}
        onAction={onAction}
      />
    </div>
  )
}

/** Free-text search across loaded inbox items. Matches title, body excerpt,
 *  client name, author and assignee. Whitespace-tolerant; multiple words act
 *  as AND filters (each word must hit somewhere on the row). */
function filterByQuery(items: InboxItem[], query: string): InboxItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const words = q.split(/\s+/).filter(Boolean)
  return items.filter((it) => {
    const haystack = [
      it.title,
      it.body ?? "",
      it.clientName,
      it.authorName,
      it.assigneeName,
    ]
      .join(" ")
      .toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}

/**
 * Compact chip strip below the Tasks status filter — narrow tasks to a
 * single source (Trengo / Monday / Automation / Watchlist / etc). Helps
 * Roy's "tasjes is super onoverzichtelijk" pain when a stack of automation
 * tasks drowns out a single Monday request he actually needs to action.
 *
 * Auto-hides chips for sources with 0 matching items so the strip stays
 * tight on small workspaces. Always shows the "All" chip with the total
 * so the user has a fast reset path.
 */
function TaskSourceChips({
  value,
  onChange,
  counts,
  totalCount,
}: {
  value: TaskSourceFilter
  onChange: (v: TaskSourceFilter) => void
  counts: Partial<Record<InboxSource, number>>
  totalCount: number
}) {
  // Only render the strip if there's more than one source with content —
  // a single-source workspace doesn't need the affordance.
  const populatedSources = (Object.keys(counts) as InboxSource[]).filter(
    (s) => (counts[s] ?? 0) > 0,
  )
  if (populatedSources.length < 2) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <SourceChip
        active={value === "all"}
        onClick={() => onChange("all")}
        label="All sources"
        count={totalCount}
      />
      {populatedSources.map((source) => (
        <SourceChip
          key={source}
          active={value === source}
          onClick={() => onChange(source)}
          label={TASK_SOURCE_LABELS[source]}
          count={counts[source] ?? 0}
        />
      ))}
    </div>
  )
}

function SourceChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium bg-primary/15 text-primary border border-primary/30"
          : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground border border-border/60 hover:bg-muted/40 hover:text-foreground transition-colors"
      }
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  )
}
