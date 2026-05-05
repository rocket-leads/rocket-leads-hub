"use client"

import { useMemo, useState } from "react"
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
  Users,
  MessageCircle,
  Video,
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
export type InboxClientOption = { id: string; name: string }
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

type MainTab = "tasks" | "updates" | "team-inbox" | "client-inbox" | "meetings"
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

  const updates = updatesQuery.data?.items ?? []
  const tasks = tasksQuery.data?.items ?? []

  // Per-client view (locked-client tab on client detail page) surfaces
  // tasks/updates linked to that client plus a Client Inbox (Trengo
  // conversations) and Meetings sub-tab — keeping all per-client activity
  // under one tab. Global mode keeps the team/all-clients chat tabs.
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
        { id: "team-inbox", label: "Team Inbox", icon: Users },
        { id: "client-inbox", label: "Client Inbox", icon: MessageCircle },
      ]

  const isChatTab = activeTab === "team-inbox" || activeTab === "client-inbox"
  const isClientOnlyTab = activeTab === "meetings" || (!!lockedClient && activeTab === "client-inbox")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Inbox</h1>
        </div>
        <div className="flex items-center gap-2">
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
                onItemClick={(item) => setDetailItem(item)}
                onAction={(item, action) => {
                  if (action === "done") patchItem(item.id, { status: "done" })
                  else if (action === "cancel") patchItem(item.id, { status: "cancelled" })
                  else if (action === "reopen") patchItem(item.id, { status: "open" })
                  else if (action === "unsnooze") patchItem(item.id, { snoozedUntil: null })
                  else if (typeof action === "object" && action.type === "snooze") {
                    patchItem(item.id, { snoozedUntil: action.until })
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

        {activeTab === "team-inbox" && <ChatPane scope="internal" />}

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
  noDueDate: InboxItem[]
}

function groupTasksByDeadline(tasks: InboxItem[]): TaskGroups {
  const today = startOfDay(new Date())
  const groups: TaskGroups = { overdue: [], today: [], upcoming: [], noDueDate: [] }
  for (const t of tasks) {
    if (!t.dueDate) {
      groups.noDueDate.push(t)
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
  groups.noDueDate.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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
  red: { dot: "bg-red-500", text: "text-red-500 dark:text-red-400" },
  amber: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  emerald: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  muted: { dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
} as const

type SectionTone = keyof typeof SECTION_TONES

function SectionHeader({
  icon: Icon,
  label,
  count,
  tone,
}: {
  icon: typeof AlertOctagon
  label: string
  count: number
  tone: SectionTone
}) {
  const t = SECTION_TONES[tone]
  return (
    <div className="flex items-center gap-2 px-1 mb-2">
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      <Icon className={`h-3.5 w-3.5 ${t.text}`} />
      <span className={`text-[11px] uppercase tracking-wider font-semibold ${t.text}`}>{label}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground/50">{count}</span>
    </div>
  )
}

type TaskAction = Extract<RowAction, "done" | "cancel" | "reopen" | "unsnooze"> | { type: "snooze"; until: string }

function TaskGroupSection({
  icon,
  label,
  tone,
  items,
  showClient,
  onItemClick,
  onAction,
}: {
  icon: typeof AlertOctagon
  label: string
  tone: SectionTone
  items: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: TaskAction) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader icon={icon} label={label} count={items.length} tone={tone} />
      <div className="space-y-2">
        {items.map((item) => (
          <InboxListRow
            key={item.id}
            item={item}
            showClient={showClient}
            onClick={() => onItemClick(item)}
            onAction={(action) => {
              if (
                action === "done" ||
                action === "cancel" ||
                action === "reopen" ||
                action === "unsnooze" ||
                (typeof action === "object" && action.type === "snooze")
              ) {
                onAction(item, action as TaskAction)
              }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function GroupedTasks({
  tasks,
  showClient,
  onItemClick,
  onAction,
}: {
  tasks: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: TaskAction) => void
}) {
  const groups = useMemo(() => groupTasksByDeadline(tasks), [tasks])
  return (
    <div className="space-y-5">
      <TaskGroupSection
        icon={AlertOctagon}
        label="Overdue"
        tone="red"
        items={groups.overdue}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <TaskGroupSection
        icon={CalendarDays}
        label="Today"
        tone="amber"
        items={groups.today}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <TaskGroupSection
        icon={CalendarClock}
        label="Upcoming"
        tone="muted"
        items={groups.upcoming}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <TaskGroupSection
        icon={CalendarX}
        label="No due date"
        tone="muted"
        items={groups.noDueDate}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
    </div>
  )
}

function UpdateGroupSection({
  icon,
  label,
  tone,
  items,
  showClient,
  onItemClick,
  onAction,
}: {
  icon: typeof CalendarDays
  label: string
  tone: SectionTone
  items: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: "read" | "unread") => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader icon={icon} label={label} count={items.length} tone={tone} />
      <div className="space-y-2">
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
    </div>
  )
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
  return (
    <div className="space-y-5">
      <UpdateGroupSection
        icon={CalendarDays}
        label="Today"
        tone="emerald"
        items={groups.today}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarDays}
        label="Yesterday"
        tone="amber"
        items={groups.yesterday}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarClock}
        label="This week"
        tone="muted"
        items={groups.thisWeek}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
      <UpdateGroupSection
        icon={CalendarX}
        label="Older"
        tone="muted"
        items={groups.older}
        showClient={showClient}
        onItemClick={onItemClick}
        onAction={onAction}
      />
    </div>
  )
}
