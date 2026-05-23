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
  BellOff,
  Sparkles,
  Activity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DismissButton } from "@/components/ui/dismiss-button"
import { PageHeader } from "@/components/ui/page-header"
import { cn } from "@/lib/utils"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { InboxListRow, type RowAction } from "./inbox-list-row"
import { ComposerDialog } from "./composer-dialog"
import { ItemDetailDialog } from "./item-detail-dialog"
import { ChatPane, ThreadView, SourceIcon, fmtRelative } from "./chat-pane"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import { CommunicationTab } from "@/app/(dashboard)/clients/[id]/_components/communication-tab"
import { MeetingsTab } from "@/app/(dashboard)/clients/[id]/_components/meetings-tab"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
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

type MainTab = "now" | "tasks" | "updates" | "client-inbox" | "meetings"
type UpdateFilter = "all" | UpdateStatus
/**
 * Task filters cover the active lifecycle (All / Open / In progress / Done)
 * plus a dedicated Snoozed tab so parked items remain visible to the user.
 * Without it, snoozed tasks vanish from every view until the snooze clock
 * expires — which felt like things were silently dropped. Cancelled tasks
 * remain archived (no tab); Cancel is the "soft delete with audit trail"
 * path and Bulk Delete is the hard remove.
 */
type TaskFilter = "all" | "open" | "in_progress" | "done" | "snoozed"

/** Secondary filter strip on Tasks: narrow by source. "all" shows everything;
 *  the chip strip below TASK_FILTERS only renders chips for sources that
 *  actually have tasks in the current status filter, so the row stays
 *  uncluttered when (e.g.) the user hasn't connected Slack yet. */
type TaskSourceFilter = "all" | InboxSource

/** Dictionary keys for the source chip labels. Resolved via `t()` at render
 *  time so the strip flips locale together with the rest of the inbox. */
const TASK_SOURCE_LABEL_KEYS: Record<InboxSource, DictionaryKey> = {
  manual: "inbox.source.manual",
  watchlist: "inbox.source.watchlist",
  meeting: "inbox.source.meetings",
  monday: "inbox.source.monday",
  trengo: "inbox.source.trengo",
  slack: "inbox.source.slack",
  automation: "inbox.source.automation",
}

/** Tab/filter labels are dictionary-keyed; icons + ids stay static so a
 *  per-render useMemo can rebuild the array when the locale flips without
 *  re-allocating icons on every state change. */
const UPDATE_FILTER_SHAPE = [
  { id: "all" as const, labelKey: "inbox.update.filter.all" as const, icon: LayoutList },
  { id: "unread" as const, labelKey: "inbox.update.filter.unread" as const, icon: Mail },
  { id: "read" as const, labelKey: "inbox.update.filter.read" as const, icon: MailOpen },
]

const TASK_FILTER_SHAPE = [
  // "All" goes first to mirror the Updates strip (All / Unread / Read).
  // Roy: consistency across tabs — a user scanning the filter row should
  // find the same anchor option in the same position regardless of which
  // tab they're on.
  { id: "all" as const, labelKey: "inbox.task.filter.all" as const, icon: LayoutList },
  { id: "open" as const, labelKey: "inbox.task.filter.open" as const, icon: Circle },
  { id: "in_progress" as const, labelKey: "inbox.task.filter.in_progress" as const, icon: Clock },
  { id: "done" as const, labelKey: "inbox.task.filter.done" as const, icon: CircleCheck },
  { id: "snoozed" as const, labelKey: "inbox.task.filter.snoozed" as const, icon: BellOff },
]

const ALL_UPDATE_STATUSES: UpdateStatus[] = ["unread", "read"]
// "All" excludes cancelled tasks — they're archived state and shouldn't
// clutter the active list. If a user explicitly needs to find a cancelled
// task, the row still exists in the DB; we'd add a dedicated Archive view
// when the need actually shows up.
const VISIBLE_TASK_STATUSES: TaskStatus[] = ["open", "in_progress", "done"]

const DEFAULT_UPDATE_FILTER: UpdateFilter = "all"
const DEFAULT_TASK_FILTER: TaskFilter = "all"

export function InboxView({
  currentUser,
  initialUpdates,
  initialTasks,
  users,
  clients,
  lockedClient,
}: Props) {
  const queryClient = useQueryClient()
  const locale = useLocale()

  // Build locale-aware filter tab arrays per render — the underlying
  // shape is static; only labels flip with the language toggle.
  const TASK_FILTERS: TopTab<TaskFilter>[] = useMemo(
    () => TASK_FILTER_SHAPE.map((f) => ({ id: f.id, label: t(f.labelKey, locale), icon: f.icon })),
    [locale],
  )
  const UPDATE_FILTERS: TopTab<UpdateFilter>[] = useMemo(
    () => UPDATE_FILTER_SHAPE.map((f) => ({ id: f.id, label: t(f.labelKey, locale), icon: f.icon })),
    [locale],
  )

  // activeTab intentionally NOT persisted — opening the inbox should land
  // on Now ("what needs my attention right now") regardless of where the
  // user was last time. Per-client inbox skips the Now tab and goes
  // straight to Tasks (Now is global-only — see mainTabs below). Everything
  // else is sticky so a reload doesn't blow away the filter context the AM
  // was working from.
  const [activeTab, setActiveTab] = useState<MainTab>(lockedClient ? "tasks" : "now")
  const [assignedToMe, setAssignedToMe] = usePersistedState(
    "inbox.assignedToMe",
    true,
  )
  const [updateFilter, setUpdateFilter] = usePersistedState<UpdateFilter>(
    // v2 key — defaults shifted from "unread"/"open" to "all". Bumping the
    // key resets returning users so they land on the new default instead of
    // a stale persisted value from before the change.
    "inbox.updateFilter.v2",
    DEFAULT_UPDATE_FILTER,
  )
  const [taskFilter, setTaskFilter] = usePersistedState<TaskFilter>(
    "inbox.taskFilter.v2",
    DEFAULT_TASK_FILTER,
  )
  const [taskSourceFilter, setTaskSourceFilter] = usePersistedState<TaskSourceFilter>(
    "inbox.taskSourceFilter",
    "all",
  )
  const [updateSourceFilter, setUpdateSourceFilter] = usePersistedState<TaskSourceFilter>(
    "inbox.updateSourceFilter",
    "all",
  )
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerKind, setComposerKind] = useState<"update" | "task">("update")
  // Chat-derived prefill — set when the user clicks "Make task" on a chat
  // message bubble. Cleared whenever the composer is reopened from the
  // toolbar so a standard "New task" doesn't inherit stale chat context.
  const [composerPrefill, setComposerPrefill] = useState<{
    clientId?: string
    title?: string
    body?: string
  }>({})
  const [detailItem, setDetailItem] = useState<InboxItem | null>(null)
  // Selected chat thread — second tenant of the docked pane. Mutually
  // exclusive with `detailItem` (opening a task closes any open thread and
  // vice versa) so the user always sees exactly one detail surface.
  const [selectedThread, setSelectedThread] = useState<ChatThreadSummary | null>(null)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const updateStatuses = useMemo(
    () => (updateFilter === "all" ? ALL_UPDATE_STATUSES : [updateFilter]),
    [updateFilter],
  )
  const taskStatuses = useMemo(() => {
    if (taskFilter === "all") return VISIBLE_TASK_STATUSES
    // Snoozed view: tasks are still "open" or "in_progress" status-wise, the
    // snoozed_until clock is what hides them. Surface both so the user sees
    // everything they've parked, regardless of which workflow stage.
    if (taskFilter === "snoozed") return ["open", "in_progress"] as TaskStatus[]
    return [taskFilter]
  }, [taskFilter])

  // When the user opens the Snoozed filter we flip the API param from
  // "active" (default — hide snoozed) to "snoozed" (show only snoozed).
  const taskSnoozeMode: "active" | "snoozed" =
    taskFilter === "snoozed" ? "snoozed" : "active"

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

  // Polling cadence: the inbox is the AM's primary surface, so new items
  // (Trengo messages, Monday updates, automation tasks) should appear
  // without a manual refresh. 15s feels live enough that the AM can keep
  // the tab open while doing other work and trust that anything new
  // surfaces on its own — and it's cheap (one query per pane). Slack-y
  // realtime via Supabase channels would be cleaner but RLS blocks the
  // anon-key browser path; polling is the pragmatic choice until we
  // wire authenticated realtime.
  const LIST_REFETCH_MS = 15 * 1000

  const updatesQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "update", { assignedToMe, clientId: lockedClient?.id, filter: updateFilter }],
    queryFn: () => fetch(buildUrl("update", updateStatuses)).then((r) => r.json()),
    initialData: updatesUsesDefaults ? { items: initialUpdates } : undefined,
    staleTime: 10 * 1000,
    refetchInterval: LIST_REFETCH_MS,
    refetchIntervalInBackground: false,
  })

  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox", "task", { assignedToMe, clientId: lockedClient?.id, filter: taskFilter, snooze: taskSnoozeMode }],
    queryFn: () => fetch(buildUrl("task", taskStatuses)).then((r) => r.json()),
    initialData: tasksUsesDefaults ? { items: initialTasks } : undefined,
    staleTime: 10 * 1000,
    refetchInterval: LIST_REFETCH_MS,
    refetchIntervalInBackground: false,
  })

  // Tab-bar counts. The user's "what needs my attention" baseline number,
  // independent of the in-tab status/source filter — flipping to the Done
  // filter shouldn't make the Tasks tab badge claim "you have 240 things
  // to do!" The sidebar already polls /api/inbox/badge for its own count;
  // we share that cache here at the same 15s cadence as the lists so they
  // stay in sync. Only used in global mode; the locked-client view keeps
  // its existing local-derived counts because the badge endpoint isn't
  // client-scoped.
  const badgeQuery = useQuery<{ unreadUpdates: number; openTasks: number; unreadChats: number }>({
    queryKey: ["inbox-badge"],
    queryFn: () => fetch("/api/inbox/badge").then((r) => r.json()),
    refetchInterval: LIST_REFETCH_MS,
    staleTime: 10 * 1000,
    refetchIntervalInBackground: false,
    enabled: !lockedClient,
  })

  function refreshAll() {
    queryClient.invalidateQueries({ queryKey: ["inbox"] })
    queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
  }

  function openComposer(kind: "update" | "task") {
    setComposerKind(kind)
    setComposerPrefill({})
    setComposerOpen(true)
  }

  /** Open the composer pre-filled from a chat message bubble. The thread's
   *  linked client id becomes the locked client, and a truncated message
   *  body becomes the task title — AM only confirms + sets a due date. */
  function openComposerFromChat({
    clientId,
    title,
    body,
  }: {
    clientId: string
    title: string
    body?: string
  }) {
    setComposerKind("task")
    setComposerPrefill({ clientId, title, body })
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
  const queryFilteredUpdates = useMemo(
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
  const updateSourceCounts = useMemo(() => {
    const counts: Partial<Record<InboxSource, number>> = {}
    for (const u of queryFilteredUpdates) {
      counts[u.source] = (counts[u.source] ?? 0) + 1
    }
    return counts
  }, [queryFilteredUpdates])
  const tasks = useMemo(
    () =>
      taskSourceFilter === "all"
        ? queryFilteredTasks
        : queryFilteredTasks.filter((t) => t.source === taskSourceFilter),
    [queryFilteredTasks, taskSourceFilter],
  )
  const updates = useMemo(
    () =>
      updateSourceFilter === "all"
        ? queryFilteredUpdates
        : queryFilteredUpdates.filter((u) => u.source === updateSourceFilter),
    [queryFilteredUpdates, updateSourceFilter],
  )

  // Flat ordered list of items as they appear on screen — used by keyboard
  // navigation (j/k) so Down/Up moves through Overdue → Today → Upcoming
  // (or Today → Yesterday → This week → Older for updates) the same way the
  // user reads top-to-bottom. Recomputed on filter/sort/source changes so
  // the focus index stays in sync with what's actually rendered.
  const flatVisibleItems = useMemo<InboxItem[]>(() => {
    if (activeTab === "tasks") {
      const g = groupTasksByDeadline(tasks)
      return [...g.overdue, ...g.today, ...g.upcoming]
    }
    if (activeTab === "updates") {
      const g = groupUpdatesByDate(updates)
      return [...g.today, ...g.yesterday, ...g.thisWeek, ...g.older]
    }
    return []
  }, [activeTab, tasks, updates])

  // Auto-prune the focused id when the row leaves the visible set (filter
  // change, search refines past it, action removed it). Without this the
  // ring sticks on a phantom row.
  useEffect(() => {
    if (!focusedItemId) return
    if (!flatVisibleItems.some((it) => it.id === focusedItemId)) {
      setFocusedItemId(null)
    }
  }, [flatVisibleItems, focusedItemId])

  // Scroll the keyboard-focused row into view. Cheap — single querySelector
  // by data attribute, only fires when focus actually changes.
  useEffect(() => {
    if (!focusedItemId) return
    const el = document.querySelector<HTMLElement>(
      `[data-inbox-row-id="${CSS.escape(focusedItemId)}"]`,
    )
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [focusedItemId])

  // Global keyboard shortcuts. Slack/Linear-style — j/k navigate, Enter
  // opens detail, e completes (done for tasks / read for updates), x
  // cancels a task, / focuses search. Skipped when the user is typing in
  // an input/textarea/contenteditable so the shortcuts don't hijack normal
  // edit flows. Detail dialog handles its own Esc.
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"
    }

    function onKey(e: KeyboardEvent) {
      // / focuses search even from outside any input.
      if (e.key === "/" && !isTypingTarget(e.target) && !detailItem) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      // ? opens the shortcuts overlay (Slack/Linear default). Skip when
      // typing or when the detail dialog is open — those own keyboard.
      if (e.key === "?" && !isTypingTarget(e.target) && !detailItem) {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }

      if (isTypingTarget(e.target)) return

      // Escape closes the docked detail pane (either tenant: InboxItem or
      // chat thread). The overlay variant has its own Esc handler via
      // DialogPrimitive, but the docked pane lives inline and would
      // otherwise need an explicit close click. Mirroring Linear/Slack:
      // Esc dismisses the open ticket regardless of mode.
      if (e.key === "Escape" && (detailItem || selectedThread)) {
        e.preventDefault()
        closeDock()
        return
      }

      if (detailItem || selectedThread) return // detail surface owns the rest of the keyboard while open

      // c opens the composer for whichever pane the user is on. Tasks/
      // Updates → composer in matching kind. Skipped on chat/meetings
      // tabs (those have their own create flows). Same trigger Slack
      // and Linear use, fast path to "new task" without reaching for
      // the New button.
      if (e.key === "c" && (activeTab === "tasks" || activeTab === "updates")) {
        e.preventDefault()
        openComposer(activeTab === "tasks" ? "task" : "update")
        return
      }

      if (activeTab !== "tasks" && activeTab !== "updates") return
      if (flatVisibleItems.length === 0) return

      const currentIdx = focusedItemId
        ? flatVisibleItems.findIndex((it) => it.id === focusedItemId)
        : -1

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault()
        const next = currentIdx < 0 ? 0 : Math.min(flatVisibleItems.length - 1, currentIdx + 1)
        setFocusedItemId(flatVisibleItems[next].id)
        return
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault()
        const next = currentIdx < 0 ? 0 : Math.max(0, currentIdx - 1)
        setFocusedItemId(flatVisibleItems[next].id)
        return
      }

      // Actions below need a focused item.
      if (currentIdx < 0) return
      const focused = flatVisibleItems[currentIdx]

      if (e.key === "Enter" || e.key === "o") {
        e.preventDefault()
        openDetailItem(focused)
        return
      }

      if (e.key === "e") {
        e.preventDefault()
        if (focused.kind === "task") {
          patchItem(focused.id, { status: "done" }, { mode: "remove" })
        } else if (focused.kind === "update") {
          // Toggle: if already read, mark unread; otherwise mark read.
          const next = focused.status === "read" ? "unread" : "read"
          patchItem(focused.id, { status: next }, {
            mode: "mutate",
            optimisticPatch: { status: next },
          })
        }
        return
      }

      // No more cancel shortcut — Cancel was retired in favour of a single
      // Delete action. Hard delete needs an explicit confirm so we don't
      // bind it to a key (would be too easy to nuke the focused row).
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatVisibleItems, focusedItemId, activeTab, detailItem])

  // Per-client view (locked-client tab on client detail page) surfaces
  // tasks/updates linked to that client plus a Client Inbox (Trengo
  // conversations) and Meetings sub-tab — keeping all per-client activity
  // under one tab. Global mode shows the cross-client Client Inbox.
  // Team Inbox (Slack DMs) is intentionally not shown — Slack's API can't
  // expose human-to-human DMs, so we replace that workflow in Phase E
  // (Hub-native team chat) instead of half-syncing it.
  const tabBadge = badgeQuery.data
  // Now-tab count = the "what needs my attention right now" summary that
  // matches the feed's content: unread updates + open tasks + unread chats
  // (badge endpoint already aggregates these for the sidebar pill).
  const nowCount = tabBadge
    ? tabBadge.unreadUpdates + tabBadge.openTasks + tabBadge.unreadChats
    : undefined
  const mainTabs: TopTab<MainTab>[] = lockedClient
    ? [
        { id: "tasks", label: t("inbox.tab.tasks", locale), icon: ListTodo, count: tasks.length, accent: "violet" as const },
        { id: "updates", label: t("inbox.tab.updates", locale), icon: InboxIcon, count: updates.length, accent: "sky" as const },
        ...(lockedClient.canViewCommunication
          ? [{ id: "client-inbox" as const, label: t("inbox.tab.client_inbox", locale), icon: MessageCircle, accent: "emerald" as const }]
          : []),
        { id: "meetings", label: t("inbox.tab.meetings", locale), icon: Video },
      ]
    : [
        // Per-tab accents echo the row-rail palette (Tasks=violet,
        // Updates=sky, Client=emerald) so the active tab visually pulses
        // the same colour as the rows it contains. Now keeps the primary
        // brand purple since it spans all three queues.
        {
          id: "now",
          label: t("inbox.tab.now", locale),
          icon: Sparkles,
          count: nowCount,
        },
        {
          id: "tasks",
          label: t("inbox.tab.tasks", locale),
          icon: ListTodo,
          // Open + in_progress assigned to me, regardless of current
          // status/source filter. Falls back to the local filtered count
          // before the badge query resolves.
          count: tabBadge?.openTasks ?? tasks.length,
          accent: "violet" as const,
        },
        {
          id: "updates",
          label: t("inbox.tab.updates", locale),
          icon: InboxIcon,
          count: tabBadge?.unreadUpdates ?? updates.length,
          accent: "sky" as const,
        },
        {
          id: "client-inbox",
          label: t("inbox.tab.client_inbox", locale),
          icon: MessageCircle,
          count: tabBadge?.unreadChats ?? 0,
          accent: "emerald" as const,
        },
      ]

  const isChatTab = activeTab === "client-inbox"
  const isClientOnlyTab = activeTab === "meetings" || (!!lockedClient && activeTab === "client-inbox")
  // Now tab is read-only triage — it shows what needs attention but doesn't
  // own the composer/search affordances those belong to (those live in the
  // tabs that author their own items).
  const isNowTab = activeTab === "now"

  // Unified detail surface: every tab (Now / Tasks / Updates / Client Inbox)
  // opens its detail as a right-side slide-in panel on xl+ screens. The
  // list area compresses on the left so the AM can keep jumping from row
  // to row without closing the open ticket — no inline grid recompute =
  // no layout shake when switching tickets. Below xl, ItemDetailDialog
  // falls back to its modal slide-over with backdrop.
  const showDockedPane = detailItem !== null || selectedThread !== null

  // Close helpers. Opening a task closes any open thread and vice versa
  // (one detail surface at a time) so the user never has two open detail
  // contexts to mentally track.
  function openDetailItem(item: InboxItem) {
    setSelectedThread(null)
    setDetailItem(item)
    setFocusedItemId(item.id)
  }
  function openThread(thread: ChatThreadSummary) {
    setDetailItem(null)
    setSelectedThread(thread)
  }
  function closeDock() {
    setDetailItem(null)
    setSelectedThread(null)
  }

  /** Content of the docked slide-in panel. Picks the surface based on
   *  what's open: a Task/Update detail (ItemDetailDialog) or a chat thread
   *  (ThreadView). Mutually exclusive — see openDetailItem / openThread.
   *  The wrapping <aside> below provides positioning + slide-in animation. */
  function renderDockedContent(): React.ReactNode {
    if (detailItem) {
      return (
        <ItemDetailDialog
          itemId={detailItem.id}
          currentUser={currentUser}
          users={users}
          onClose={closeDock}
          onChanged={refreshAll}
          mode="docked"
        />
      )
    }
    if (selectedThread) {
      return (
        <div className="relative flex h-full flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
          <DismissButton
            onClick={closeDock}
            className="absolute top-3 right-3 z-10"
          />
          <div className="flex-1 min-h-0 overflow-hidden">
            <ThreadView
              thread={selectedThread}
              users={users}
              onMakeTaskFromMessage={openComposerFromChat}
              onReplied={() => {
                queryClient.invalidateQueries({ queryKey: ["inbox-threads", "external"] })
                queryClient.invalidateQueries({
                  queryKey: ["inbox-thread", selectedThread.threadKey],
                })
              }}
            />
          </div>
        </div>
      )
    }
    return null
  }

  // Roy 2026-05-22: Client Inbox tab needs a true 50/50 split (thread list |
  // chat conversation) instead of the default "main column 1fr + 540px dock"
  // ratio used by Tasks/Updates. On chat the conversation pane IS the work,
  // not a side-detail of the list. Other tabs keep the original layout where
  // the list dominates and the detail is a slide-in.
  const dockSplit5050 = isChatTab && showDockedPane

  return (
    <div className="flex gap-6 items-start">
      <div
        className={cn(
          "flex-1 min-w-0 space-y-6",
          showDockedPane && !dockSplit5050 && "xl:max-w-[calc(100%-560px)]",
          dockSplit5050 && "xl:max-w-[calc(50%-12px)]",
        )}
      >
      {/* Migrated to PageHeader 2026-05-23 — drops the bespoke 28px h1 so
          /inbox opens with the same visual rhythm as every other dashboard
          page (24px title, right-aligned actions row). Search input + Plus
          button + shortcut help live in the actions slot. */}
      <PageHeader
        title={t("inbox.title", locale)}
        actions={
          <>
            {!isChatTab && !isClientOnlyTab && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSearchQuery("")
                      e.currentTarget.blur()
                    }
                  }}
                  placeholder={t("inbox.search.placeholder", locale)}
                  className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-7 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                />
                {searchQuery && (
                  <DismissButton
                    size="xs"
                    onClick={() => setSearchQuery("")}
                    label={t("inbox.search.clear", locale)}
                    stopPropagation={false}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                  />
                )}
              </div>
            )}
            {!lockedClient && (
              // Filter toggle styled as a secondary affordance (outline) so it
              // never collides visually with the primary action button (purple
              // "New update" / "New task") sitting right next to it. Active
              // state is signalled by a subtle primary-tinted background +
              // border, not by switching to the full primary fill — Roy: two
              // identical purple buttons next to each other made it unclear
              // which one was the action vs. the filter.
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAssignedToMe(!assignedToMe)}
                className={cn(
                  assignedToMe &&
                    "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15 hover:text-primary",
                )}
              >
                {assignedToMe ? t("inbox.filter.assigned_to_me", locale) : t("inbox.filter.all", locale)}
              </Button>
            )}
            {!isChatTab && !isClientOnlyTab && !isNowTab && (
              <Button size="sm" onClick={() => openComposer(activeTab === "tasks" ? "task" : "update")}>
                <Plus className="h-4 w-4" />
                {activeTab === "tasks" ? t("inbox.action.new_task", locale) : t("inbox.action.new_update", locale)}
              </Button>
            )}
            {!isChatTab && !isClientOnlyTab && (
              <button
                type="button"
                onClick={() => setShortcutsOpen(true)}
                title={t("inbox.action.shortcuts", locale)}
                aria-label={t("inbox.action.shortcuts", locale)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-input text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                ?
              </button>
            )}
          </>
        }
      />

      <TopTabs<MainTab> tabs={mainTabs} value={activeTab} onChange={setActiveTab} />

      <div className="space-y-4">
        {activeTab === "now" && !lockedClient && (
          <NowFeed
            currentUserId={currentUser.id}
            users={users}
            summary={{
              tasks: tabBadge?.openTasks ?? 0,
              updates: tabBadge?.unreadUpdates ?? 0,
              chats: tabBadge?.unreadChats ?? 0,
            }}
            onJumpToTab={(tab) => setActiveTab(tab)}
            onOpenItem={openDetailItem}
            // Chat click opens the thread in the page-level slide-in aside
            // — same UX as Tasks/Updates. No tab switch, no layout shake.
            onOpenThread={openThread}
          />
        )}

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
              users={users}
              lockedClient={lockedClient}
              currentUserId={currentUser.id}
              onCreated={refreshAll}
            />
            {tasksQuery.isLoading ? (
              <EmptyState text={t("inbox.empty.tasks_loading", locale)} />
            ) : tasks.length === 0 ? (
              <EmptyState
                text={
                  taskFilter === "all"
                    ? t("inbox.empty.tasks_none", locale)
                    : t("inbox.empty.tasks_filtered", locale, {
                        filter: (TASK_FILTERS.find((f) => f.id === taskFilter)?.label ?? "").toLowerCase(),
                        assigned: assignedToMe ? t("inbox.empty.tasks_assigned_suffix", locale) : "",
                      })
                }
                onCreate={() => openComposer("task")}
              />
            ) : (
              <GroupedTasks
                tasks={tasks}
                showClient={!lockedClient}
                users={users}
                focusedItemId={focusedItemId}
                onBulkDelete={(ids) => {
                  // Fan out DELETEs through the optimistic-remove path. The
                  // server gates DELETE to author/admin, so non-admin AMs
                  // attempting to delete auto-ingested rows will see them
                  // re-appear after the rollback — which is the correct
                  // signal that they should Cancel instead of Delete.
                  for (const id of ids) deleteItem(id)
                }}
                onItemClick={openDetailItem}
                onAction={(item, action) => {
                  // Optimistic strategy:
                  //   - Done, Snooze, Delete, and Reassign-away leave the
                  //     active list under default filters — REMOVE so the
                  //     row disappears immediately.
                  //   - Reopen, Unsnooze, Reassign-staying, Rename keep the
                  //     row in the list — MUTATE.
                  if (action === "done") {
                    patchItem(item.id, { status: "done" }, { mode: "remove" })
                  } else if (action === "delete") {
                    deleteItem(item.id)
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
            <TaskSourceChips
              value={updateSourceFilter}
              onChange={setUpdateSourceFilter}
              counts={updateSourceCounts}
              totalCount={queryFilteredUpdates.length}
            />
            <MarkAllReadBanner
              updates={updates}
              onMarkAll={(ids) => {
                for (const id of ids) {
                  patchItem(
                    id,
                    { status: "read" },
                    { mode: "mutate", optimisticPatch: { status: "read" } },
                  )
                }
              }}
            />
            <QuickAddUpdateBar
              clients={clients}
              users={users}
              lockedClient={lockedClient}
              currentUserId={currentUser.id}
              onCreated={refreshAll}
            />
            {updatesQuery.isLoading ? (
              <EmptyState text={t("inbox.empty.updates_loading", locale)} />
            ) : updates.length === 0 ? (
              <EmptyState
                text={
                  updateFilter === "all"
                    ? t("inbox.empty.updates_none", locale)
                    : t("inbox.empty.updates_filtered", locale, {
                        filter:
                          updateFilter === "unread"
                            ? t("inbox.update.filter.unread_lower", locale)
                            : t("inbox.update.filter.read_lower", locale),
                        assigned: assignedToMe ? t("inbox.empty.tasks_assigned_suffix", locale) : "",
                      })
                }
                onCreate={() => openComposer("update")}
              />
            ) : (
              <GroupedUpdates
                updates={updates}
                showClient={!lockedClient}
                focusedItemId={focusedItemId}
                onItemClick={openDetailItem}
                onBulkDelete={(ids) => {
                  for (const id of ids) deleteItem(id)
                }}
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
                  } else if (action === "delete") {
                    deleteItem(item.id)
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

        {activeTab === "client-inbox" && (
          lockedClient ? (
            <CommunicationTab
              mondayItemId={lockedClient.id}
              trengoContactId={lockedClient.trengoContactId ?? null}
            />
          ) : (
            <>
              {/* Two ChatPane variants behind one tab. On xl+ we render the
                  docked-detail variant so the selected thread opens in the
                  right-side dock (same UX as Tasks/Updates). Below xl,
                  ChatPane keeps its internal 360px|1fr split — there isn't
                  room for a separate dock at that width. */}
              <div className="hidden xl:block">
                <ChatPane
                  scope="external"
                  users={users}
                  onMakeTaskFromMessage={openComposerFromChat}
                  dockedDetail
                  selectedThreadKey={selectedThread?.threadKey ?? null}
                  onSelectedChange={(t) => setSelectedThread(t)}
                />
              </div>
              <div className="xl:hidden">
                <ChatPane
                  scope="external"
                  users={users}
                  onMakeTaskFromMessage={openComposerFromChat}
                />
              </div>
            </>
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
        defaultClientId={composerPrefill.clientId}
        defaultTitle={composerPrefill.title}
        defaultBody={composerPrefill.body}
        onCreated={() => {
          setComposerOpen(false)
          refreshAll()
        }}
      />

      {/* Below-xl fallback: a Task/Update detail still uses the original
          right-side slide-over with a backdrop. On xl+ the docked aside
          below renders alongside the list (slide-in panel, no backdrop). */}
      {detailItem && (
        <div className="xl:hidden">
          <ItemDetailDialog
            itemId={detailItem.id}
            currentUser={currentUser}
            users={users}
            onClose={closeDock}
            onChanged={refreshAll}
            mode="overlay"
          />
        </div>
      )}

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>

      {/* Docked slide-in aside — xl+ only. Sibling of the inbox content
          column so the list visibly compresses (rather than being hidden
          under a floating panel). Sticky positioning + own internal scroll
          so the detail follows the page as the user scrolls the list.
          Slide-in animation on mount via tailwindcss-animate. */}
      {showDockedPane && (
        <aside
          className={cn(
            "hidden xl:block shrink-0 self-stretch",
            // 50/50 on the Client Inbox tab (chat IS the work); fixed 540px
            // on Tasks/Updates where the detail is a side-pane of the list.
            dockSplit5050 ? "xl:w-[calc(50%-12px)]" : "w-[540px]",
            "animate-in slide-in-from-right duration-150 ease-out",
          )}
        >
          <div className="sticky top-[72px] h-[calc(100vh-96px)]">
            {renderDockedContent()}
          </div>
        </aside>
      )}
    </div>
  )
}

/**
 * Keyboard shortcuts overlay. Triggered by `?` (Slack/Linear default) or
 * the `?` button in the inbox header. Lists what each key does in a clean
 * grid so AMs don't have to remember the bindings.
 *
 * Built on the same base-ui dialog the detail slide-over uses, but rendered
 * as a centered modal — small reference card, not a slide-out panel.
 */
function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Esc closes via base-ui's built-in handler.
  const groups: Array<{ label: string; rows: Array<{ keys: string[]; desc: string }> }> = [
    {
      label: "Navigate",
      rows: [
        { keys: ["j", "↓"], desc: "Next row" },
        { keys: ["k", "↑"], desc: "Previous row" },
        { keys: ["Enter", "o"], desc: "Open detail" },
        { keys: ["Esc"], desc: "Close detail" },
      ],
    },
    {
      label: "Act on focused row",
      rows: [
        { keys: ["e"], desc: "Done (task) / toggle read (update)" },
      ],
    },
    {
      label: "Create",
      rows: [
        { keys: ["c"], desc: "New task / update (matches active tab)" },
      ],
    },
    {
      label: "Search & help",
      rows: [
        { keys: ["/"], desc: "Focus search" },
        { keys: ["?"], desc: "Show this help" },
      ],
    },
  ]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className={cn(
            "fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm",
            "duration-100 ease-out",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-[90vw] max-w-md rounded-xl border border-border bg-popover shadow-2xl outline-none",
            "duration-100 ease-out",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/60">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Keyboard shortcuts
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close"
                />
              }
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-5 py-4 space-y-4">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/60 mb-2">
                  {g.label}
                </p>
                <div className="space-y-1.5">
                  {g.rows.map((r) => (
                    <div key={r.desc} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-foreground/80">{r.desc}</span>
                      <span className="inline-flex items-center gap-1">
                        {r.keys.map((k, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-md border border-border bg-background text-[11px] font-mono font-medium text-foreground/80"
                          >
                            {k}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Inbox-zero affordance for the Updates tab. Renders only when there
 * are unread updates currently visible — tapping it marks all of them
 * read in one shot (one PATCH per row through the optimistic path).
 * Hidden when nothing is unread, so a clean tab stays clean.
 */
function MarkAllReadBanner({
  updates,
  onMarkAll,
}: {
  updates: InboxItem[]
  onMarkAll: (ids: string[]) => void
}) {
  const unreadIds = updates
    .filter((u) => u.status === "unread")
    .map((u) => u.id)
  if (unreadIds.length === 0) return null
  return (
    <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {unreadIds.length} unread update
        {unreadIds.length === 1 ? "" : "s"} in this view
      </span>
      <button
        type="button"
        onClick={() => onMarkAll(unreadIds)}
        className="text-xs font-medium text-foreground hover:bg-muted/60 px-2.5 h-7 rounded-md transition-colors"
        title="Mark every visible unread update as read"
      >
        Mark all read
      </button>
    </div>
  )
}

/**
 * useState backed by localStorage. Reads the persisted value on mount
 * (after hydration so SSR doesn't mismatch) and writes through on every
 * setState call. The key is namespaced by the caller; values must be
 * JSON-serialisable. Falls back to the initial value silently if storage
 * is full, blocked, or the persisted JSON is corrupt.
 */
function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial)
  const hydratedRef = useRef(false)

  // Hydrate from localStorage on mount. Only writes back to state when the
  // persisted value actually exists, so the initial-default branch above
  // stays authoritative for fresh users.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        setValue(JSON.parse(raw) as T)
      }
    } catch {
      // Bad JSON or storage unavailable — stick with the initial value.
    }
    hydratedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirror state changes back to storage. Skips the first render so we
  // don't overwrite a real persisted value with the initial default
  // before hydration runs.
  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore — full storage shouldn't break the UI
    }
  }, [key, value])

  return [value, setValue]
}

function EmptyState({ text, onCreate }: { text: string; onCreate?: () => void }) {
  return (
    <div className="border border-dashed border-border/60 rounded-lg p-12 text-center bg-card/30">
      <div className="mx-auto h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
        <InboxIcon className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <p className="text-base text-muted-foreground">{text}</p>
      {onCreate && (
        <Button size="sm" className="mt-5" onClick={onCreate}>
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
  users,
  lockedClient,
  currentUserId,
  onCreated,
}: {
  clients: InboxClientOption[]
  users: InboxUser[]
  lockedClient?: InboxClientOption
  currentUserId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState("")
  const [clientId, setClientId] = useState<string>(lockedClient?.id ?? "")
  // Tasks default to "me" — AMs typically jot down their own to-dos via
  // QuickAdd and reassign via the composer or row action when needed.
  const [assigneeId, setAssigneeId] = useState<string>(currentUserId)
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
          assigneeId,
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
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-muted-foreground/70 shrink-0" />
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
          className="flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:opacity-50"
        />
        {showClient && (
          <div ref={clientWrapRef} className="w-44 shrink-0">
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
        <select
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-xs max-w-[150px] shrink-0"
          title="Assignee"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id === currentUserId ? "Me" : u.name ?? u.email}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-xs"
          title="Due date"
        />
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="shrink-0 h-9"
        >
          Add
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-1.5 ml-7">{error}</p>
      )}
    </div>
  )
}

/**
 * Quick-add bar for Updates — same speed-of-action principle as the Tasks
 * quick-add: title input, client picker, assignee picker (since updates
 * are addressed to someone specific), Enter creates. No due date, no
 * priority — those are task concepts. Submit POST is kind=update,
 * status=unread by default per the create endpoint.
 */
function QuickAddUpdateBar({
  clients,
  users,
  lockedClient,
  currentUserId,
  onCreated,
}: {
  clients: InboxClientOption[]
  users: InboxUser[]
  lockedClient?: InboxClientOption
  currentUserId: string
  onCreated: () => void
}) {
  const [title, setTitle] = useState("")
  const [clientId, setClientId] = useState<string>(lockedClient?.id ?? "")
  // Default the recipient to the first teammate that isn't the current user
  // — updates need an audience and "to myself" is rarely useful. Falls back
  // to the current user when there's only one Hub user (dev environment).
  const defaultAssigneeId = useMemo(() => {
    const other = users.find((u) => u.id !== currentUserId)
    return other?.id ?? currentUserId
  }, [users, currentUserId])
  const [assigneeId, setAssigneeId] = useState<string>(defaultAssigneeId)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)
  const clientWrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (lockedClient?.id) setClientId(lockedClient.id)
  }, [lockedClient?.id])

  useEffect(() => {
    setAssigneeId(defaultAssigneeId)
  }, [defaultAssigneeId])

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed) {
      titleRef.current?.focus()
      return
    }
    if (!clientId) {
      setError("Pick a client first.")
      const input = clientWrapRef.current?.querySelector<HTMLInputElement>("input")
      input?.focus()
      return
    }
    if (!assigneeId) {
      setError("Pick a recipient.")
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "update",
          clientId,
          assigneeId,
          title: trimmed,
        }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `Create failed (${res.status})`)
      }
      setTitle("")
      titleRef.current?.focus()
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create update")
    } finally {
      setSubmitting(false)
    }
  }

  const showClient = !lockedClient

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Plus className="h-5 w-5 text-muted-foreground/70 shrink-0" />
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
          placeholder="Add an update — type and Enter"
          disabled={submitting}
          className="flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground/50 focus-visible:outline-none disabled:opacity-50"
        />
        {showClient && (
          <div ref={clientWrapRef} className="w-44 shrink-0">
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
        <select
          value={assigneeId}
          onChange={(e) => {
            setAssigneeId(e.target.value)
            if (error) setError(null)
          }}
          className="h-9 rounded-md border border-input bg-background px-2.5 text-xs max-w-[150px] shrink-0"
          title="Recipient"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.id === currentUserId ? "Me" : u.name ?? u.email}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={submit}
          disabled={submitting || !title.trim()}
          className="shrink-0 h-9"
        >
          Add
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-1.5 ml-7">{error}</p>
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
        className="h-9 w-full rounded-md border border-input bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
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
  sky: {
    bar: "bg-sky-500",
    bg: "bg-sky-500/10 hover:bg-sky-500/15",
    text: "text-sky-700 dark:text-sky-400",
    iconBg: "bg-sky-500/20 text-sky-600 dark:text-sky-400",
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
  selectAllState,
  onToggleSelectAll,
}: {
  icon: typeof AlertOctagon
  label: string
  count: number
  tone: SectionTone
  collapsed: boolean
  onToggle: () => void
  /** Bulk-select state for the rows in this section. Hover-revealed
   *  checkbox in the header lets the AM tick every row in Today/Overdue/
   *  Upcoming with one click. Optional — updates don't have bulk-select. */
  selectAllState?: "none" | "some" | "all"
  onToggleSelectAll?: () => void
}) {
  const t = SECTION_TONES[tone]
  const showSelectAll = !!onToggleSelectAll
  // Compact divider style — mirrors NowSection so all section headers in
  // the inbox share the same visual language. Reads as a label + rule
  // rather than a card, so the eye can tell at a glance that headers are
  // not items. Bulk-select checkbox (when present) sits between the
  // chevron and the icon pill, hover-revealed except when something is
  // already selected.
  return (
    <section className="group">
      <div className="w-full flex items-center gap-2.5 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          className="shrink-0"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-150 group-hover:text-foreground",
              collapsed && "-rotate-90",
            )}
          />
        </button>
        {showSelectAll && (
          <button
            type="button"
            role="checkbox"
            aria-checked={selectAllState === "all"}
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelectAll?.()
            }}
            className={cn(
              "h-4 w-4 shrink-0 rounded border-2 inline-flex items-center justify-center transition-all",
              selectAllState === "none"
                ? "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-foreground hover:bg-muted/40"
                : selectAllState === "all"
                  ? "bg-primary border-primary text-primary-foreground"
                  : "bg-primary/20 border-primary text-primary",
            )}
            title={
              selectAllState === "all"
                ? "Deselect all in this group"
                : "Select all in this group"
            }
          >
            {selectAllState === "all" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
            {selectAllState === "some" && (
              <span className="block h-0.5 w-2 bg-primary rounded-full" aria-hidden />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2.5 min-w-0 text-left flex-1"
        >
          <span
            className={cn(
              "h-5 w-5 rounded-md flex items-center justify-center shrink-0",
              t.iconBg,
            )}
            aria-hidden
          >
            <Icon className="h-3 w-3" />
          </span>
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide",
              t.text,
            )}
          >
            {label}
          </span>
          <span className="text-[11px] tabular-nums text-muted-foreground/70 font-medium">
            {count}
          </span>
          <span className="flex-1 ml-1 h-px bg-border/60" aria-hidden />
        </button>
      </div>
    </section>
  )
}

type TaskAction =
  | Extract<RowAction, "done" | "delete" | "reopen" | "unsnooze">
  | { type: "snooze"; until: string }
  | { type: "reassign"; assigneeId: string }
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
  onToggleSelectAll,
  users,
  focusedItemId,
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
  /** Toggle every row in this group (Today / Overdue / Upcoming) on or off
   *  in one click. Computes "all/some/none" locally to drive the indeterminate
   *  state on the header checkbox. */
  onToggleSelectAll: (ids: string[], shouldSelect: boolean) => void
  users?: InboxUser[]
  focusedItemId?: string | null
}) {
  if (items.length === 0) return null
  const selectedInGroup = items.filter((it) => selectedIds.has(it.id)).length
  const selectAllState: "none" | "some" | "all" =
    selectedInGroup === 0
      ? "none"
      : selectedInGroup === items.length
        ? "all"
        : "some"
  return (
    <div>
      <SectionHeader
        icon={icon}
        label={label}
        count={items.length}
        tone={tone}
        collapsed={collapsed}
        onToggle={onToggle}
        selectAllState={selectAllState}
        onToggleSelectAll={() =>
          onToggleSelectAll(
            items.map((it) => it.id),
            // If anything is unselected in this group, fill it; if all are
            // already selected, the click clears them.
            selectAllState !== "all",
          )
        }
      />
      {!collapsed && (
        <div className="space-y-1.5 mb-1">
          {items.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient={showClient}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              onClick={() => onItemClick(item)}
              users={users}
              keyboardFocused={focusedItemId === item.id}
              onAction={(action) => {
                if (
                  action === "done" ||
                  action === "delete" ||
                  action === "reopen" ||
                  action === "unsnooze" ||
                  (typeof action === "object" &&
                    (action.type === "snooze" ||
                      action.type === "reassign" ||
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
  focusedItemId,
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
  /** Keyboard-navigation target. Highlights the matching row and lets the
   *  parent's global keydown handler dispatch actions against it. */
  focusedItemId?: string | null
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

  function toggleSelectMany(ids: string[], shouldSelect: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
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
    <div className="space-y-1 pb-20">
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
        onToggleSelectAll={toggleSelectMany}
        users={users}
        focusedItemId={focusedItemId}
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
        onToggleSelectAll={toggleSelectMany}
        users={users}
        focusedItemId={focusedItemId}
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
        onToggleSelectAll={toggleSelectMany}
        users={users}
        focusedItemId={focusedItemId}
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
/** Shared chrome for the floating bulk-action bars (Tasks + Updates). Roy
 *  2026-05-22: "bulk bar mag eigen pattern blijven maar moet wel in dezelfde
 *  huisstijl — minder rond, dikker, iets meer vierkant." So: rounded-xl
 *  container (was rounded-full), h-9 px-3 rounded-md chip buttons (was h-7
 *  px-3 rounded-full), same coloured hover tints as before. */
const BULK_BAR_CHIP =
  "h-9 inline-flex items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors"
const BULK_BAR_CONTAINER =
  "fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-xl border border-border bg-popover shadow-lg px-2 py-1.5"

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
    <div className={BULK_BAR_CONTAINER}>
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} geselecteerd
      </span>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={() => onBulk("done")}
        className={cn(BULK_BAR_CHIP, "hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400")}
        title="Markeer geselecteerde taken als done"
      >
        <Check className="h-3.5 w-3.5" />
        Done
      </button>
      <BulkSnoozeButton
        onPick={(until) => onBulk({ type: "snooze", until })}
      />
      {users && users.length > 0 && (
        <BulkReassignButton
          users={users}
          onPick={(assigneeId) => onBulk({ type: "reassign", assigneeId })}
        />
      )}
      <button
        type="button"
        onClick={onDelete}
        className={cn(BULK_BAR_CHIP, "hover:bg-red-500/15 hover:text-red-500")}
        title="Verwijder geselecteerde taken — dit kan niet ongedaan worden"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="h-9 inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground px-2 rounded-md hover:bg-muted/50 transition-colors"
        title="Selectie wissen"
      >
        Clear
      </button>
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
        className={cn(BULK_BAR_CHIP, "hover:bg-muted/60")}
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
        className={cn(BULK_BAR_CHIP, "hover:bg-muted/60")}
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

type UpdateAction =
  | "read"
  | "unread"
  | "make_task"
  | "delete"
  | { type: "rename"; title: string }

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
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  focusedItemId,
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
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onToggleSelectAll: (ids: string[], shouldSelect: boolean) => void
  focusedItemId?: string | null
}) {
  if (items.length === 0) return null
  const selectedInGroup = items.filter((it) => selectedIds.has(it.id)).length
  const selectAllState: "none" | "some" | "all" =
    selectedInGroup === 0
      ? "none"
      : selectedInGroup === items.length
        ? "all"
        : "some"
  return (
    <div>
      <SectionHeader
        icon={icon}
        label={label}
        count={items.length}
        tone={tone}
        collapsed={collapsed}
        onToggle={onToggle}
        selectAllState={selectAllState}
        onToggleSelectAll={() =>
          onToggleSelectAll(
            items.map((it) => it.id),
            selectAllState !== "all",
          )
        }
      />
      {!collapsed && (
        <div className="space-y-1.5 mb-1">
          {items.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient={showClient}
              selected={selectedIds.has(item.id)}
              onToggleSelect={() => onToggleSelect(item.id)}
              onClick={() => onItemClick(item)}
              keyboardFocused={focusedItemId === item.id}
              onAction={(action) => {
                if (
                  action === "read" ||
                  action === "unread" ||
                  action === "make_task" ||
                  action === "delete" ||
                  (typeof action === "object" && action.type === "rename")
                ) {
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
  onBulkDelete,
  focusedItemId,
}: {
  updates: InboxItem[]
  showClient: boolean
  onItemClick: (item: InboxItem) => void
  onAction: (item: InboxItem, action: UpdateAction) => void
  /** Bulk delete handler — fans out DELETE requests with optimistic
   *  cache removal in the parent. Same shape as GroupedTasks. */
  onBulkDelete: (ids: string[]) => void
  focusedItemId?: string | null
}) {
  const groups = useMemo(() => groupUpdatesByDate(updates), [updates])
  const { collapsed, toggle } = useUpdateCollapse()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Auto-prune selection when items leave the visible set (filter switch,
  // an action removed it). Mirrors GroupedTasks behaviour.
  useEffect(() => {
    const visible = new Set(updates.map((u) => u.id))
    setSelectedIds((prev) => {
      let dirty = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
        else dirty = true
      }
      return dirty ? next : prev
    })
  }, [updates])

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectMany(ids: string[], shouldSelect: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of ids) {
        if (shouldSelect) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function handleBulk(action: UpdateAction) {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const items = updates.filter((u) => selectedIds.has(u.id))
    clearSelection()
    for (const item of items) onAction(item, action)
  }

  function handleBulkDeleteSelected() {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const ok = window.confirm(
      `Permanently delete ${ids.length} update${ids.length === 1 ? "" : "s"}? This can't be undone.`,
    )
    if (!ok) return
    clearSelection()
    onBulkDelete(ids)
  }

  return (
    <div className="space-y-1 pb-20">
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
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectMany}
        focusedItemId={focusedItemId}
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
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectMany}
        focusedItemId={focusedItemId}
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
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectMany}
        focusedItemId={focusedItemId}
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
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectMany}
        focusedItemId={focusedItemId}
      />

      {selectedIds.size > 0 && (
        <UpdateBulkActionBar
          count={selectedIds.size}
          onClear={clearSelection}
          onBulk={handleBulk}
          onDelete={handleBulkDeleteSelected}
        />
      )}
    </div>
  )
}

/**
 * Floating bottom bar that appears when 1+ updates are selected. Mirrors
 * the Tasks bulk bar shape but with the actions that make sense for
 * informational items: Mark as read, Make task (bulk-promote to Tasks),
 * and permanent Delete.
 */
function UpdateBulkActionBar({
  count,
  onClear,
  onBulk,
  onDelete,
}: {
  count: number
  onClear: () => void
  onBulk: (action: UpdateAction) => void
  onDelete: () => void
}) {
  return (
    <div className={BULK_BAR_CONTAINER}>
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} geselecteerd
      </span>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={() => onBulk("read")}
        className={cn(BULK_BAR_CHIP, "hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400")}
        title="Markeer geselecteerde updates als gelezen"
      >
        <Check className="h-3.5 w-3.5" />
        Mark read
      </button>
      <button
        type="button"
        onClick={() => onBulk("make_task")}
        className={cn(BULK_BAR_CHIP, "hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400")}
        title="Create tasks from selected updates"
      >
        <ListTodo className="h-3.5 w-3.5" />
        Create task
      </button>
      <button
        type="button"
        onClick={onDelete}
        className={cn(BULK_BAR_CHIP, "hover:bg-red-500/15 hover:text-red-500")}
        title="Verwijder geselecteerde updates — dit kan niet ongedaan worden"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </button>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="h-9 inline-flex items-center text-[11px] text-muted-foreground hover:text-foreground px-2 rounded-md hover:bg-muted/50 transition-colors"
        title="Selectie wissen"
      >
        Clear
      </button>
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
  const locale = useLocale()
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
        label={t("inbox.source.all", locale)}
        count={totalCount}
      />
      {populatedSources.map((source) => (
        <SourceChip
          key={source}
          active={value === source}
          onClick={() => onChange(source)}
          label={t(TASK_SOURCE_LABEL_KEYS[source], locale)}
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

/**
 * "Now" — the cross-source triage feed.
 *
 * Merges three independent queries (tasks, updates, chats) into a single
 * scannable surface so an AM doesn't have to switch tabs to figure out
 * what's on their plate. Each section renders only when it has something;
 * empty Now == "all caught up" celebratory state.
 *
 * Read-only by design: items keep their full action surface (mark done,
 * snooze, reassign) via the InboxListRow component, but creating new items
 * happens in the dedicated tabs. Clicking a chat card switches to the
 * Client Inbox tab — opening a specific thread isn't wired yet (one click
 * away is acceptable for v1).
 */
function NowFeed({
  currentUserId,
  users,
  summary,
  onJumpToTab,
  onOpenItem,
  onOpenThread,
}: {
  currentUserId: string
  users: InboxUser[]
  /** Aggregate counts for the three jump-cards rendered above the sections.
   *  Wired to the same `inbox-badge` query the main tabs use, so the cards
   *  and the tab counters never disagree. */
  summary: { tasks: number; updates: number; chats: number }
  /** Click handler for the jump-cards. Switches the parent's activeTab so
   *  the AM can drill into the relevant queue from the Now summary. */
  onJumpToTab: (tab: "tasks" | "updates" | "client-inbox") => void
  onOpenItem: (item: InboxItem) => void
  /** Open a chat thread. The parent renders ThreadView in the page-level
   *  slide-in aside — same UX as Tasks/Updates. No tab switch. */
  onOpenThread: (thread: ChatThreadSummary) => void
}) {
  const locale = useLocale()
  const POLL_MS = 15 * 1000

  // Overdue + today tasks: open or in_progress, assigned to me, not snoozed.
  // We over-fetch slightly (all active assigned-to-me) and filter to due≤today
  // client-side rather than adding a dueBefore param to the API — keeps the
  // server fetcher simple, and the assigned-to-me set is small enough that
  // shipping a few extra rows is fine.
  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox-now", "tasks", currentUserId],
    queryFn: () =>
      fetch(
        `/api/inbox?kind=task&assignedToMe=true&statuses=open,in_progress&snoozed=active`,
      ).then((r) => r.json()),
    refetchInterval: POLL_MS,
    staleTime: 10 * 1000,
  })

  const updatesQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["inbox-now", "updates", currentUserId],
    queryFn: () =>
      fetch(`/api/inbox?kind=update&assignedToMe=true&statuses=unread`).then((r) =>
        r.json(),
      ),
    refetchInterval: POLL_MS,
    staleTime: 10 * 1000,
  })

  const chatsQuery = useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["inbox-now", "chats"],
    queryFn: () => fetch(`/api/inbox/threads?scope=external`).then((r) => r.json()),
    refetchInterval: POLL_MS,
    staleTime: 10 * 1000,
  })

  const todayStart = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const tomorrowStart = useMemo(() => {
    const d = new Date(todayStart)
    d.setDate(d.getDate() + 1)
    return d
  }, [todayStart])

  const { overdue, today } = useMemo(() => {
    const all = tasksQuery.data?.items ?? []
    const o: InboxItem[] = []
    const t: InboxItem[] = []
    for (const item of all) {
      if (!item.dueDate) continue
      const due = new Date(item.dueDate + "T00:00:00")
      if (due.getTime() < todayStart.getTime()) o.push(item)
      else if (due.getTime() < tomorrowStart.getTime()) t.push(item)
      // Future tasks intentionally excluded — they belong in the Tasks tab.
    }
    return { overdue: o, today: t }
  }, [tasksQuery.data, todayStart, tomorrowStart])

  const unreadUpdates = updatesQuery.data?.items ?? []
  const unreadChats = useMemo(
    () =>
      (chatsQuery.data?.threads ?? [])
        .filter((tt) => tt.unreadCount > 0)
        .sort((a, b) => b.latestAt.localeCompare(a.latestAt)),
    [chatsQuery.data],
  )

  // Combined "Unread inbox" feed — interleave unread updates + unread chat
  // threads, sorted by most-recent activity. Roy: one consolidated section
  // instead of two separate ones, so the AM has a single "what's new" list
  // to scan. The discriminated union below preserves per-entry typing so
  // the renderer can dispatch to InboxListRow vs NowChatCard cleanly.
  type UnreadEntry =
    | { kind: "update"; item: InboxItem; sortKey: string }
    | { kind: "chat"; thread: ChatThreadSummary; sortKey: string }
  const unreadFeed = useMemo<UnreadEntry[]>(() => {
    const entries: UnreadEntry[] = [
      ...unreadUpdates.map((item) => ({
        kind: "update" as const,
        item,
        sortKey: item.createdAt,
      })),
      ...unreadChats.map((thread) => ({
        kind: "chat" as const,
        thread,
        sortKey: thread.latestAt,
      })),
    ]
    entries.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    return entries
  }, [unreadUpdates, unreadChats])

  const totalCount = overdue.length + today.length + unreadFeed.length

  const loading =
    tasksQuery.isLoading || updatesQuery.isLoading || chatsQuery.isLoading

  // Top-of-Now summary cards — three jump-cards showing what's still open
  // across the AM's queues so the inbox state is legible at a glance. The
  // cards are always rendered (even on "all caught up") so the user has a
  // consistent landing zone; when everything is zero the cards just confirm
  // it. Counts come from the shared `inbox-badge` query upstream so they
  // never drift from the main-tab badges. Click jumps to that queue.
  const summaryCards = (
    <div className="grid grid-cols-3 gap-3">
      <NowSummaryCard
        icon={ListTodo}
        label="Tasks"
        count={summary.tasks}
        tone="violet"
        onClick={() => onJumpToTab("tasks")}
      />
      <NowSummaryCard
        icon={InboxIcon}
        label="Updates"
        count={summary.updates}
        tone="sky"
        onClick={() => onJumpToTab("updates")}
      />
      <NowSummaryCard
        icon={MessageCircle}
        label="Client Inbox"
        count={summary.chats}
        tone="emerald"
        onClick={() => onJumpToTab("client-inbox")}
      />
    </div>
  )

  // Sections list — same structure regardless of whether the inline detail
  // is open. When open, the parent caller wraps it in the 50/50 grid below
  // so the list scrolls inside the left column with the detail on the
  // right; when closed, the sections render full-width as before.
  //
  // Outer gap is small (space-y-1) because each section already has its
  // own internal mb-3 below the items — keeps spacing consistent whether
  // a section is collapsed or expanded.
  const sectionsList = (
    <div className="space-y-1">
      {overdue.length > 0 && (
        <NowSection
          sectionKey="overdue"
          icon={AlertOctagon}
          label={t("inbox.now.section.overdue", locale)}
          count={overdue.length}
          tone="red"
        >
          {overdue.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient
              onClick={() => onOpenItem(item)}
              users={users}
            />
          ))}
        </NowSection>
      )}

      {today.length > 0 && (
        <NowSection
          sectionKey="today"
          icon={CalendarDays}
          label={t("inbox.now.section.today", locale)}
          count={today.length}
          tone="muted"
        >
          {today.map((item) => (
            <InboxListRow
              key={item.id}
              item={item}
              showClient
              onClick={() => onOpenItem(item)}
              users={users}
            />
          ))}
        </NowSection>
      )}

      {unreadFeed.length > 0 && (
        <NowSection
          sectionKey="unread"
          icon={InboxIcon}
          label={t("inbox.now.section.unread_inbox", locale)}
          count={unreadFeed.length}
          tone="muted"
        >
          {unreadFeed.map((entry) =>
            entry.kind === "update" ? (
              <InboxListRow
                key={`u-${entry.item.id}`}
                item={entry.item}
                showClient
                onClick={() => onOpenItem(entry.item)}
                users={users}
              />
            ) : (
              <NowChatCard
                key={`c-${entry.thread.threadKey}`}
                thread={entry.thread}
                onOpen={() => onOpenThread(entry.thread)}
                openLabel={t("inbox.now.chat.open", locale)}
              />
            ),
          )}
        </NowSection>
      )}
    </div>
  )

  // Body: sections list (full width). When the AM opens a ticket the
  // parent (inbox-view) renders the page-level slide-in aside alongside —
  // the list area itself shrinks via the outer flex layout, no inline
  // grid recompute (no layout shake when jumping between rows).
  const body =
    totalCount === 0 && loading ? (
      <EmptyState text={t("inbox.empty.tasks_loading", locale)} />
    ) : totalCount === 0 ? (
      <div className="border border-dashed border-border/60 rounded-lg p-12 text-center bg-card/30">
        <div className="mx-auto h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
          <Check className="h-6 w-6 text-emerald-500" strokeWidth={2.5} />
        </div>
        <p className="text-base text-muted-foreground">{t("inbox.now.empty", locale)}</p>
      </div>
    ) : (
      sectionsList
    )

  return (
    <div className="space-y-5 pb-12">
      {summaryCards}
      {body}
    </div>
  )
}

/** Top-of-Now jump-card. Three of these render side-by-side at the top of
 *  the Now feed, summarising what's still open across the AM's queues
 *  (Tasks / Updates / Client Inbox). The card colour matches the row rail
 *  treatment elsewhere (violet/sky/emerald) so the same visual language
 *  ties the summary to the lists below. Click jumps to that tab.
 *
 *  The "0" state is rendered intentionally — a deliberate zero is more
 *  useful than a missing card ("yes, I have nothing in Tasks" reassures
 *  more than the card just being absent). Zero cards get a muted treatment
 *  so the AM's eye lands on the cards that actually need attention. */
function NowSummaryCard({
  icon: Icon,
  label,
  count,
  tone,
  onClick,
}: {
  icon: typeof ListTodo
  label: string
  count: number
  tone: "violet" | "sky" | "emerald"
  onClick: () => void
}) {
  const isZero = count === 0
  // Saturated styling when there's something to act on; muted greys when
  // the queue is empty so the eye is drawn only to the cards that matter.
  const palettes = {
    violet: {
      iconBg: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      count: "text-violet-600 dark:text-violet-300",
      hover: "hover:border-violet-500/40 hover:bg-violet-500/[0.04]",
    },
    sky: {
      iconBg: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      count: "text-sky-600 dark:text-sky-300",
      hover: "hover:border-sky-500/40 hover:bg-sky-500/[0.04]",
    },
    emerald: {
      iconBg: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      count: "text-emerald-600 dark:text-emerald-300",
      hover: "hover:border-emerald-500/40 hover:bg-emerald-500/[0.04]",
    },
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left transition-all",
        isZero ? "opacity-70 hover:opacity-100" : "",
        palettes.hover,
      )}
    >
      <span
        className={cn(
          "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
          isZero ? "bg-muted text-muted-foreground" : palettes.iconBg,
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "text-2xl font-semibold leading-tight tabular-nums",
            isZero ? "text-muted-foreground" : palettes.count,
          )}
        >
          {count}
        </div>
      </div>
    </button>
  )
}

/** Section header + collapsible body for the Now feed.
 *
 *  Roy: the previous design rendered each section header as a full-width
 *  coloured card, which made headers and rows compete visually — the eye
 *  couldn't tell at a glance which was a label vs. an item. New treatment
 *  is a compact "section divider" style: small tonal icon pill, label in
 *  the tone colour, count, a thin rule extending to the right edge, and
 *  a chevron on the far right. No big background card. Reads as a clear
 *  visual hierarchy (header → indented item cards below). Each section is
 *  collapsible; open/closed state is persisted per section in localStorage
 *  so the AM can hide queues they're not working on without re-clicking
 *  every reload. */
function NowSection({
  sectionKey,
  icon: Icon,
  label,
  count,
  tone,
  children,
}: {
  /** Stable key used for the localStorage entry that remembers the
   *  collapsed/expanded state across reloads. Keep it short and snake-case
   *  ("overdue", "today", …). */
  sectionKey: string
  icon: typeof AlertOctagon
  label: string
  count: number
  tone: SectionTone
  children: React.ReactNode
}) {
  const t = SECTION_TONES[tone]
  const [open, setOpen] = usePersistedState<boolean>(
    `inbox.now.section.${sectionKey}.open`,
    true,
  )
  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group w-full flex items-center gap-2.5 py-1.5 text-left"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 group-hover:text-foreground",
            !open && "-rotate-90",
          )}
        />
        <span
          className={cn(
            "h-5 w-5 rounded-md flex items-center justify-center shrink-0",
            t.iconBg,
          )}
          aria-hidden
        >
          <Icon className="h-3 w-3" />
        </span>
        <span
          className={cn(
            "text-[11px] font-semibold uppercase tracking-wide",
            t.text,
          )}
        >
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/70 font-medium">
          {count}
        </span>
        {/* Hairline rule extending to the right edge — gives the header a
            divider feel without a heavy card background. */}
        <span className="flex-1 ml-1 h-px bg-border/60" aria-hidden />
      </button>
      {open && <div className="space-y-1.5 mt-2 mb-3">{children}</div>}
    </section>
  )
}

/** Compact card for an unread chat thread in the Now feed. Clicking opens
 *  the Client Inbox tab — selecting the specific thread is a v2 nicety
 *  (one extra click in v1 is acceptable). */
function NowChatCard({
  thread,
  onOpen,
  openLabel,
}: {
  thread: ChatThreadSummary
  onOpen: () => void
  openLabel: string
}) {
  // Mirrors the visual structure of ThreadRow in Client Inbox so chat
  // tickets read identically across the inbox — Roy: "geen dubbel
  // tekstwolkje en CLIENT chip; gewoon WhatsApp-icoontje zoals bij
  // Client Inbox". Card wrapper (border + bg) is kept here because in Now
  // the row sits inline with task/update cards, where the eye expects a
  // card; inside Client Inbox the same content sits in a single outer
  // list card with dividers between rows.
  const isUnread = thread.unreadCount > 0
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      title={openLabel}
      className="group relative w-full text-left rounded-lg border border-border bg-card hover:border-border hover:bg-muted/40 hover:shadow-sm transition-all px-4 py-3 overflow-hidden cursor-pointer"
    >
      {/* Left-edge unread bar — same convention as ThreadRow in Client
          Inbox. Hairline (w-0.5) so it doesn't compete with row content. */}
      {isUnread && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" aria-hidden />
      )}
      <div className="flex items-start gap-2.5">
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <SourceIcon thread={thread} />
              <span
                className={cn(
                  "text-sm truncate",
                  isUnread ? "font-semibold text-foreground" : "font-medium text-foreground/90",
                )}
              >
                {thread.primaryName}
              </span>
              {/* No ChannelBadge here — SourceIcon already encodes the
                  channel (WhatsApp brand, email icon, Slack purple, …)
                  so repeating "WhatsApp" as a text pill is dubbel-op. */}
            </div>
            {thread.unreadCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums shrink-0">
                {thread.unreadCount}
              </span>
            )}
          </div>
          {thread.clientName && (
            <p className="text-[10px] text-muted-foreground/70 truncate mb-1">
              {thread.clientName}
            </p>
          )}
          <p
            className={cn(
              "text-[11px] truncate leading-snug",
              isUnread ? "text-foreground/80" : "text-muted-foreground/80",
            )}
          >
            {thread.latestPreview || <span className="italic">No preview</span>}
          </p>
          <p className="text-[10px] text-muted-foreground/50 mt-0.5">
            {fmtRelative(thread.latestAt)}
          </p>
        </div>
      </div>
    </div>
  )
}
