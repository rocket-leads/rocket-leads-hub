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
  CircleX,
  BellOff,
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { InboxListRow, type RowAction } from "./inbox-list-row"
import { ComposerDialog } from "./composer-dialog"
import { ItemDetailDialog } from "./item-detail-dialog"
import { ChatPane } from "./chat-pane"
import { CommunicationTab } from "@/app/(dashboard)/clients/[id]/_components/communication-tab"
import { MeetingsTab } from "@/app/(dashboard)/clients/[id]/_components/meetings-tab"
import type { InboxItem, TaskStatus, UpdateStatus } from "@/types/inbox"

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
 * Snoozed is treated as a top-level task filter alongside open/in_progress/etc.
 * so users have a single mental model: "what kind of tasks am I looking at?"
 * Picking it forces snoozed=only on the API and shows tasks that are actively
 * hidden from the default list — letting users wake them up early.
 */
type TaskFilter = "all" | TaskStatus | "snoozed"

const UPDATE_FILTERS: TopTab<UpdateFilter>[] = [
  { id: "all", label: "All updates", icon: LayoutList },
  { id: "unread", label: "Unread", icon: Mail },
  { id: "read", label: "Read", icon: MailOpen },
]

const TASK_FILTERS: TopTab<TaskFilter>[] = [
  { id: "all", label: "All tasks", icon: LayoutList },
  { id: "open", label: "Open", icon: Circle },
  { id: "in_progress", label: "In progress", icon: Clock },
  { id: "snoozed", label: "Snoozed", icon: BellOff },
  { id: "done", label: "Done", icon: CircleCheck },
  { id: "cancelled", label: "Cancelled", icon: CircleX },
]

const ALL_UPDATE_STATUSES: UpdateStatus[] = ["unread", "read"]
const ALL_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done", "cancelled"]

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
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKind, setComposerKind] = useState<"update" | "task">("update")
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null)

  const updateStatuses = useMemo(
    () => (updateFilter === "all" ? ALL_UPDATE_STATUSES : [updateFilter]),
    [updateFilter],
  )
  const taskStatuses = useMemo(() => {
    if (taskFilter === "all") return ALL_TASK_STATUSES
    // The Snoozed filter shows snoozed tasks regardless of their inner state
    // (they're still status='open' or 'in_progress' under the hood — snooze is
    // orthogonal). Pass both so the user sees everything they snoozed.
    if (taskFilter === "snoozed") return ["open", "in_progress"]
    return [taskFilter]
  }, [taskFilter])

  // Default behaviour: hide snoozed tasks from active filters; the dedicated
  // Snoozed filter explicitly opts in. 'done' / 'cancelled' / 'all' include
  // them too (a task can be snoozed when it's closed — though uncommon).
  const taskSnoozeMode: "active" | "snoozed" | "all" =
    taskFilter === "snoozed" ? "snoozed"
    : taskFilter === "open" || taskFilter === "in_progress" ? "active"
    : "all"

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

  async function patchItem(itemId: string, patch: Record<string, unknown>) {
    await fetch(`/api/inbox/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    refreshAll()
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
  const filteredTasks = useMemo(
    () => filterByQuery(allTasks, searchQuery),
    [allTasks, searchQuery],
  )
  const updates = filteredUpdates
  const tasks = filteredTasks

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
                onItemClick={(item) => setDetailItem(item)}
                onAction={(item, action) => {
                  if (action === "done") patchItem(item.id, { status: "done" })
                  else if (action === "cancel") patchItem(item.id, { status: "cancelled" })
                  else if (action === "reopen") patchItem(item.id, { status: "open" })
                  else if (action === "unsnooze") patchItem(item.id, { snoozedUntil: null })
                  else if (typeof action === "object" && action.type === "snooze") {
                    patchItem(item.id, { snoozedUntil: action.until })
                  } else if (typeof action === "object" && action.type === "reassign") {
                    patchItem(item.id, { assigneeId: action.assigneeId })
                  } else if (typeof action === "object" && action.type === "reschedule") {
                    patchItem(item.id, { dueDate: action.dueDate })
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
                  if (action === "read") patchItem(item.id, { status: "read" })
                  else if (action === "unread") patchItem(item.id, { status: "unread" })
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
            <ChatPane scope="external" />
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
                      action.type === "reschedule"))
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
  users,
}: {
  tasks: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: TaskAction) => void
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
        />
      )}
    </div>
  )
}

/**
 * Floating bottom bar that appears when 1+ tasks are selected. Lets the AM
 * batch through the inbox: mark a stack of items done, snooze them all to
 * tomorrow, or cancel a row of duplicates without opening each detail.
 */
function BulkActionBar({
  count,
  onClear,
  onBulk,
}: {
  count: number
  onClear: () => void
  onBulk: (action: TaskAction) => void
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
      <button
        type="button"
        onClick={() => onBulk("cancel")}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-red-500/10 hover:text-red-500 transition-colors"
        title="Annuleer geselecteerde taken"
      >
        <X className="h-3.5 w-3.5" />
        Cancel
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
  onAction: (item: InboxItem, action: "read" | "unread") => void
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
                if (action === "read" || action === "unread") onAction(item, action)
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
  onAction: (item: InboxItem, action: "read" | "unread") => void
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
