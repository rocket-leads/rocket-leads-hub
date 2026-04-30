"use client"

import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Inbox as InboxIcon, ListTodo } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { InboxListRow } from "./inbox-list-row"
import { ComposerDialog } from "./composer-dialog"
import { ItemDetailDialog } from "./item-detail-dialog"
import type { InboxItem, TaskStatus, UpdateStatus } from "@/types/inbox"

export type InboxUser = { id: string; name: string | null; email: string; role: string }
export type InboxClientOption = { id: string; name: string }
export type CurrentUser = { id: string; name: string; role: string }

type Props = {
  currentUser: CurrentUser
  initialUpdates: InboxItem[]
  initialTasks: InboxItem[]
  users: InboxUser[]
  clients: InboxClientOption[]
  /** When set, the view is scoped to a single client (per-client tab). */
  lockedClient?: InboxClientOption
}

const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
]

const UPDATE_STATUSES: { value: UpdateStatus; label: string }[] = [
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
]

const DEFAULT_TASK_STATUSES: TaskStatus[] = ["open", "in_progress"]
const DEFAULT_UPDATE_STATUSES: UpdateStatus[] = ["unread"]

export function InboxView({
  currentUser,
  initialUpdates,
  initialTasks,
  users,
  clients,
  lockedClient,
}: Props) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"updates" | "tasks">("updates")
  const [assignedToMe, setAssignedToMe] = useState(true)
  const [taskFilter, setTaskFilter] = useState<Set<TaskStatus>>(
    () => new Set(DEFAULT_TASK_STATUSES),
  )
  const [updateFilter, setUpdateFilter] = useState<Set<UpdateStatus>>(
    () => new Set(DEFAULT_UPDATE_STATUSES),
  )
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKind, setComposerKind] = useState<"update" | "task">("update")
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null)

  const taskStatuses = useMemo(() => Array.from(taskFilter).sort(), [taskFilter])
  const updateStatuses = useMemo(() => Array.from(updateFilter).sort(), [updateFilter])

  const buildUrl = (kind: "update" | "task", statuses: string[]) => {
    const params = new URLSearchParams({ kind })
    if (assignedToMe && !lockedClient) params.set("assignedToMe", "true")
    if (lockedClient) params.set("clientId", lockedClient.id)
    params.set("statuses", statuses.join(","))
    return `/api/inbox?${params.toString()}`
  }

  // Default initial data only matches the API call when filters are at their
  // defaults — otherwise we let the query fetch.
  const updatesUsesDefaults =
    !lockedClient &&
    assignedToMe &&
    updateStatuses.length === DEFAULT_UPDATE_STATUSES.length &&
    DEFAULT_UPDATE_STATUSES.every((s) => updateFilter.has(s))
  const tasksUsesDefaults =
    !lockedClient &&
    assignedToMe &&
    taskStatuses.length === DEFAULT_TASK_STATUSES.length &&
    DEFAULT_TASK_STATUSES.every((s) => taskFilter.has(s))

  const updatesQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "update", { assignedToMe, clientId: lockedClient?.id, statuses: updateStatuses }],
    queryFn: () => fetch(buildUrl("update", updateStatuses)).then((r) => r.json()),
    initialData: updatesUsesDefaults ? { items: initialUpdates } : undefined,
    enabled: updateStatuses.length > 0,
    staleTime: 30 * 1000,
  })

  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "task", { assignedToMe, clientId: lockedClient?.id, statuses: taskStatuses }],
    queryFn: () => fetch(buildUrl("task", taskStatuses)).then((r) => r.json()),
    initialData: tasksUsesDefaults ? { items: initialTasks } : undefined,
    enabled: taskStatuses.length > 0,
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

  function toggleTaskStatus(s: TaskStatus) {
    setTaskFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  function toggleUpdateStatus(s: UpdateStatus) {
    setUpdateFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {lockedClient ? (
              <>Updates and tasks for {lockedClient.name}</>
            ) : (
              <>Internal updates and tasks{assignedToMe ? " assigned to you" : ""}</>
            )}
          </p>
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
          <Button size="sm" onClick={() => openComposer(activeTab === "tasks" ? "task" : "update")}>
            <Plus className="h-4 w-4" />
            New {activeTab === "tasks" ? "task" : "update"}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "updates" | "tasks")}>
        <TabsList variant="line">
          <TabsTrigger value="updates">
            <InboxIcon className="h-4 w-4" />
            Updates
            {updates.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {updates.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks">
            <ListTodo className="h-4 w-4" />
            Tasks
            {tasks.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {tasks.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="updates" className="mt-4 space-y-3">
          <FilterChips
            options={UPDATE_STATUSES}
            selected={updateFilter as Set<string>}
            onToggle={(v) => toggleUpdateStatus(v as UpdateStatus)}
          />
          {updatesQuery.isLoading ? (
            <EmptyState text="Loading updates…" />
          ) : updates.length === 0 ? (
            <EmptyState
              text={
                updateStatuses.length === 0
                  ? "Select a status to show."
                  : assignedToMe
                  ? "No updates match these filters."
                  : "No updates yet."
              }
              onCreate={updateStatuses.length > 0 ? () => openComposer("update") : undefined}
            />
          ) : (
            <div className="space-y-2">
              {updates.map((item) => (
                <InboxListRow
                  key={item.id}
                  item={item}
                  showClient={!lockedClient}
                  onClick={() => setDetailItem(item)}
                  onAction={(action) => {
                    if (action === "read") patchItem(item.id, { status: "read" })
                    else if (action === "unread") patchItem(item.id, { status: "unread" })
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4 space-y-3">
          <FilterChips
            options={TASK_STATUSES}
            selected={taskFilter as Set<string>}
            onToggle={(v) => toggleTaskStatus(v as TaskStatus)}
          />
          {tasksQuery.isLoading ? (
            <EmptyState text="Loading tasks…" />
          ) : tasks.length === 0 ? (
            <EmptyState
              text={
                taskStatuses.length === 0
                  ? "Select a status to show."
                  : assignedToMe
                  ? "No tasks match these filters."
                  : "No tasks yet."
              }
              onCreate={taskStatuses.length > 0 ? () => openComposer("task") : undefined}
            />
          ) : (
            <div className="space-y-2">
              {tasks.map((item) => (
                <InboxListRow
                  key={item.id}
                  item={item}
                  showClient={!lockedClient}
                  onClick={() => setDetailItem(item)}
                  onAction={(action) => {
                    if (action === "done") patchItem(item.id, { status: "done" })
                    else if (action === "cancel") patchItem(item.id, { status: "cancelled" })
                    else if (action === "reopen") patchItem(item.id, { status: "open" })
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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

function FilterChips({
  options,
  selected,
  onToggle,
}: {
  options: { value: string; label: string }[]
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {options.map((opt) => {
        const active = selected.has(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onToggle(opt.value)}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
              active
                ? "bg-primary/15 text-primary border-primary/30"
                : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function EmptyState({ text, onCreate }: { text: string; onCreate?: () => void }) {
  return (
    <div className="border border-dashed border-border/40 rounded-lg p-8 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {onCreate && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Create one
        </Button>
      )}
    </div>
  )
}
