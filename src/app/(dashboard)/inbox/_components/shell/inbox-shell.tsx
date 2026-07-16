"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, PanelLeftClose, PanelLeftOpen, Circle, User, CircleCheck, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedTabs } from "@/components/ui/segmented-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { ComposerDialog } from "../composer-dialog"
import { ExternalRail, type ChannelEntry, type ExternalGroup } from "./external-rail"
import { InternalRail, type InternalType, type DeadlineFilter } from "./internal-rail"
import { UnifiedFeed } from "./unified-feed"
import { UpdateFeed } from "./update-feed"
import { DetailPane } from "./detail-pane"
import {
  threadToFeedRow,
  type FeedRow,
  type CurrentUser,
  type InboxUser,
  type InboxClientOption,
  type LockedClient,
} from "./types"
import type { InboxItem, InboxKind } from "@/types/inbox"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import type { TrengoIdentity } from "@/app/api/inbox/trengo-identity/route"
import type { RowAction } from "../inbox-list-row"

type Props = {
  currentUser: CurrentUser
  initialUpdates: InboxItem[]
  initialTasks: InboxItem[]
  users: InboxUser[]
  clients: InboxClientOption[]
  lockedClient?: LockedClient
}

type InboxScope = "internal" | "external"
const REFETCH_MS = 5000
const ALL_TYPES: InternalType[] = ["task", "update"]

function mentionThreadKey(item: InboxItem): string | null {
  const ref = item.sourceRef
  const key = ref && typeof ref === "object" ? (ref as Record<string, unknown>).trengo_mention_in_thread_key : null
  return typeof key === "string" ? key : null
}

/** Strip the per-channel suffix ("<base>|ch:<id>") from a thread key. Mentions
 *  are recorded against the base contact key, so mention lookups compare bases. */
function baseThreadKey(key: string): string {
  const i = key.indexOf("|ch:")
  return i === -1 ? key : key.slice(0, i)
}

/** External ticket lifecycle:
 *   Open     - a fresh ticket, nothing done yet (no team reply, not closed)
 *   Assigned - we've replied (hasTeamReply), still active
 *   Closed   - closed via the checkbox (archived)
 * Derived, not stored: replying anywhere (Hub or Trengo) sets hasTeamReply,
 * which moves Open -> Assigned automatically. */
type TicketState = "open" | "assigned" | "closed"
function threadState(t: ChatThreadSummary): TicketState {
  if (t.isArchived) return "closed"
  return t.isAssigned ? "assigned" : "open"
}

/** Build a Mentioned-view feed row from a mention UPDATE. Prefers the fully
 *  loaded thread (rich preview / channel / triage state) when it's in the
 *  active thread list; otherwise synthesizes a stub so the mention still shows
 *  even when its conversation isn't loaded (e.g. a CLOSED Trengo ticket that
 *  the active list doesn't include). Roy 2026-07-16: every Trengo mention must
 *  appear here 1:1, closed or not. Opening the row fetches the thread by key. */
function mentionUpdateToFeedRow(
  u: InboxItem,
  loaded: ChatThreadSummary | undefined,
): FeedRow | null {
  const baseKey = mentionThreadKey(u)
  if (!baseKey) return null
  if (loaded) return threadToFeedRow(loaded)
  // Prefer the conversation name stored on the mention (fan-out records it),
  // then parse it out of the "X mentioned you in Y" title, then the client.
  const storedName =
    u.sourceRef && typeof u.sourceRef === "object"
      ? (u.sourceRef as Record<string, unknown>).trengo_mention_contact_name
      : null
  const parsed = u.title.match(/^(.*?)\s+mentioned you(?:\s+in\s+(.*))?$/i)?.[2]
  const contactName =
    (typeof storedName === "string" && storedName.trim()) ||
    (parsed && parsed.trim()) ||
    (u.clientName && u.clientName !== "(unknown)" ? u.clientName : "") ||
    "Conversation"
  const channelKind = (u.channelKind ?? null) as ChatThreadSummary["channelKind"]
  const stub: ChatThreadSummary = {
    threadKey: baseKey,
    scope: "external",
    source: "trengo",
    primaryName: contactName,
    clientName: u.clientName && u.clientName !== "(unknown)" ? u.clientName : null,
    clientId: null,
    channelKind,
    channelName: null,
    trengoChannelId: null,
    channelIds: [],
    latestPreview: u.body ?? "",
    latestSubject: null,
    latestAt: u.createdAt,
    latestEventId: u.id,
    totalCount: 0,
    unreadCount: 0,
    isStarred: false,
    isArchived: false,
    isAssigned: false,
    snoozedUntil: null,
    hasTeamReply: false,
    pendingCount: 0,
  }
  return {
    id: baseKey,
    channel: channelKind === "email" ? "email" : "whatsapp",
    kind: "chat",
    sortAt: u.createdAt,
    unread: u.status !== "read",
    unreadCount: 0,
    title: contactName,
    preview: u.body,
    clientName: stub.clientName,
    thread: stub,
  }
}

/**
 * The unified inbox split into Internal (a Monday-style feed of tasks + updates
 * with inline replies + reactions) and External (client communication grouped
 * by Trengo channel + a Mentioned view). Both share the same underlying item /
 * thread queries and composer.
 */
export function InboxShell({
  currentUser,
  initialUpdates,
  initialTasks,
  users,
  clients,
  lockedClient,
}: Props) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const locale = useLocale()

  const locked = lockedClient ?? null
  const canViewComms = locked ? locked.canViewCommunication !== false : true

  // --- Top-level scope -------------------------------------------------------
  const urlScope = searchParams.get("scope")
  const [scope, setScopeState] = useState<InboxScope>(
    urlScope === "external" && canViewComms ? "external" : "internal",
  )
  const setScope = useCallback(
    (next: InboxScope) => {
      setScopeState(next)
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      params.set("scope", next)
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [router, searchParams],
  )
  const isExternal = scope === "external"

  // Collapsible left rail (channels / filters). Mirrors the main sidebar's
  // PanelLeft toggle: default expanded so SSR + first client paint agree, then
  // the effect applies the persisted choice. Collapsing hands the reclaimed
  // width to the feed / chat - Roy's ask.
  const [railCollapsed, setRailCollapsed] = useState(false)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem("inbox-rail-collapsed") === "1") setRailCollapsed(true)
    } catch {
      // localStorage unavailable - stay expanded.
    }
  }, [])
  const toggleRail = useCallback(() => {
    setRailCollapsed((v) => {
      const next = !v
      try {
        window.localStorage.setItem("inbox-rail-collapsed", next ? "1" : "0")
      } catch {
        // ignore write failures (private mode / full storage)
      }
      return next
    })
  }, [])

  // --- Data sources ----------------------------------------------------------
  const clientQ = locked ? `&clientId=${encodeURIComponent(locked.id)}` : "&assignedToMe=true"

  const tasksQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["shell-tasks", locked?.id ?? "me"],
    queryFn: () => fetch(`/api/inbox?kind=task${clientQ}`).then((r) => r.json()),
    initialData: locked ? undefined : { items: initialTasks },
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  })
  const updatesQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["shell-updates", locked?.id ?? "me"],
    queryFn: () => fetch(`/api/inbox?kind=update${clientQ}`).then((r) => r.json()),
    initialData: locked ? undefined : { items: initialUpdates },
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  })
  const threadsQuery = useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["inbox-threads", "external"],
    queryFn: () => fetch("/api/inbox/threads?scope=external").then((r) => r.json()),
    enabled: canViewComms,
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  })
  const identityQuery = useQuery<TrengoIdentity>({
    queryKey: ["inbox-trengo-identity"],
    queryFn: () => fetch("/api/inbox/trengo-identity").then((r) => r.json()),
    enabled: canViewComms,
    staleTime: 5 * 60 * 1000,
  })
  // Mentions get their own query spanning BOTH statuses (unread=To-do +
  // read=Done) so the Mentioned view shows every mention and can move one to
  // Done without it vanishing. The regular updates query is unread-only (drives
  // the Internal feed) so it can't back the Done tab. Roy 2026-07-16.
  const mentionsQuery = useQuery<{ items: InboxItem[] }>({
    queryKey: ["shell-mentions", locked?.id ?? "me"],
    queryFn: () =>
      fetch(`/api/inbox?kind=update${clientQ}&mentions=1&statuses=unread,read`).then((r) => r.json()),
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  })

  const tasks = useMemo(() => tasksQuery.data?.items ?? [], [tasksQuery.data?.items])
  const updates = useMemo(() => updatesQuery.data?.items ?? [], [updatesQuery.data?.items])
  const mentionItems = useMemo(() => mentionsQuery.data?.items ?? [], [mentionsQuery.data?.items])
  const items = useMemo(() => [...tasks, ...updates], [tasks, updates])
  const threads = useMemo(() => {
    const all = threadsQuery.data?.threads ?? []
    return locked ? all.filter((t) => t.clientId === locked.id) : all
  }, [threadsQuery.data?.threads, locked])

  const refreshItems = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["shell-tasks", locked?.id ?? "me"] })
    queryClient.invalidateQueries({ queryKey: ["shell-updates", locked?.id ?? "me"] })
    queryClient.invalidateQueries({ queryKey: ["shell-mentions", locked?.id ?? "me"] })
  }, [queryClient, locked?.id])

  // --- Internal scope --------------------------------------------------------
  const [internalTypes, setInternalTypes] = useState<Set<InternalType>>(() => new Set(ALL_TYPES))
  const [deadline, setDeadline] = useState<DeadlineFilter>("all")
  const internalCounts = useMemo(() => {
    const c: Record<InternalType, number> = { task: 0, update: 0 }
    for (const it of tasks) if (it.status === "open") c.task += 1
    for (const it of updates) if (it.status === "unread") c.update += 1
    return c
  }, [tasks, updates])
  const toggleType = useCallback((t: InternalType) => {
    setInternalTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }, [])
  const selectAllTypes = useCallback(() => setInternalTypes(new Set(ALL_TYPES)), [])

  // --- External scope --------------------------------------------------------
  // Single-select channel (Trengo-style): exactly one channel in focus at a
  // time, or the Mentioned view. Null falls back to the first channel.
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null)
  // External view: All channels (overview) / Mentioned / a single channel.
  const [viewMode, setViewMode] = useState<"all" | "mentioned" | "channel">("all")
  // When a channel is focused, search either just that line or across all.
  const [searchScope, setSearchScope] = useState<"current" | "all">("current")
  const mentionedOnly = viewMode === "mentioned"
  const [expanded, setExpanded] = useState<Record<ExternalGroup, boolean>>({ whatsapp: true, email: true })

  // Per-channel, per-kind pending counts. Split by kind because a single Trengo
  // "multi-channel" inbox can carry BOTH WhatsApp and email (content-classified
  // via channelKind). A WhatsApp channel's badge must count only WhatsApp
  // threads, matching what clicking it shows (Roy 2026-07-15).
  // Per-channel, per-kind counts = Open + Assigned (everything NOT closed) on
  // the channel, so the rail badge reflects the total workload per line, not
  // just what's awaiting a reply (Roy 2026-07-15: "3 open + 18 opgepakt = 21").
  const pendingByChannel = useMemo(() => {
    const m = new Map<number, { whatsapp: number; email: number }>()
    for (const t of threads) {
      if (t.isArchived) continue // closed tickets don't count
      if (t.channelKind !== "whatsapp" && t.channelKind !== "email") continue
      for (const cid of t.channelIds ?? []) {
        const e = m.get(cid) ?? { whatsapp: 0, email: 0 }
        e[t.channelKind] += 1
        m.set(cid, e)
      }
    }
    return m
  }, [threads])

  const identityChannels = useMemo(() => identityQuery.data?.channels ?? [], [identityQuery.data?.channels])
  const waEntries: ChannelEntry[] = useMemo(
    () =>
      identityChannels
        .filter((c) => c.type === "whatsapp")
        .map((c) => ({ id: c.id, name: c.name, unread: pendingByChannel.get(c.id)?.whatsapp ?? 0 })),
    [identityChannels, pendingByChannel],
  )
  const emailEntries: ChannelEntry[] = useMemo(
    () =>
      identityChannels
        .filter((c) => c.type === "email")
        .map((c) => ({ id: c.id, name: c.name, unread: pendingByChannel.get(c.id)?.email ?? 0 })),
    [identityChannels, pendingByChannel],
  )
  // Default focus = first channel (WhatsApp channels first, then email) until
  // the user clicks one. Derived, so no effect needed for the default.
  const firstChannelId = waEntries[0]?.id ?? emailEntries[0]?.id ?? null
  const activeChannelId = selectedChannelId ?? firstChannelId
  // The kind of the selected channel - used to keep the feed strictly to that
  // medium (WhatsApp channel → WhatsApp threads only).
  const activeGroup: ExternalGroup | null =
    activeChannelId == null
      ? null
      : waEntries.some((e) => e.id === activeChannelId)
        ? "whatsapp"
        : emailEntries.some((e) => e.id === activeChannelId)
          ? "email"
          : null

  // The Mentioned feed is driven by the mention UPDATE rows (one per teammate
  // per note), NOT by intersecting with the loaded thread list - otherwise a
  // mention on a CLOSED/unloaded Trengo ticket silently vanished (Roy 2026-07-16
  // saw only 1 of many). We show one row per mentioned conversation, using the
  // rich loaded thread when present and a stub otherwise.
  const mentionedRows = useMemo(() => {
    const threadByBase = new Map<string, ChatThreadSummary>()
    for (const t of threads) threadByBase.set(baseThreadKey(t.threadKey), t)
    const seen = new Set<string>()
    const rows: FeedRow[] = []
    for (const u of mentionItems) {
      const key = mentionThreadKey(u)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const row = mentionUpdateToFeedRow(u, threadByBase.get(key))
      if (row) rows.push(row)
    }
    rows.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    return rows
  }, [threads, mentionItems])

  // Single channel in focus → only that channel's threads, AND only the medium
  // the channel represents (so a WhatsApp line never shows the emails a
  // multi-channel Trengo inbox happens to route through it).
  const channelRows = useMemo(() => {
    if (activeChannelId == null) return []
    const rows = threads
      .filter(
        (t) =>
          t.channelIds.includes(activeChannelId) &&
          (activeGroup == null || t.channelKind === activeGroup),
      )
      .map(threadToFeedRow)
      .filter((r): r is FeedRow => r !== null)
    rows.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    return rows
  }, [threads, activeChannelId, activeGroup])

  // Mention "done" is per-user: it's the read-state of the mention UPDATE rows
  // the Trengo webhook created for me (assigned to me), keyed by the thread
  // they point at. Marking a mention done ≠ archiving the thread for everyone.
  const mentionUpdatesByThread = useMemo(() => {
    const m = new Map<string, InboxItem[]>()
    for (const u of mentionItems) {
      const key = mentionThreadKey(u)
      if (!key) continue
      const list = m.get(key) ?? []
      list.push(u)
      m.set(key, list)
    }
    return m
  }, [mentionItems])
  const mentionDone = useCallback(
    (threadKey: string): boolean => {
      const list = mentionUpdatesByThread.get(baseThreadKey(threadKey))
      return !!list && list.length > 0 && list.every((u) => u.status === "read")
    },
    [mentionUpdatesByThread],
  )
  const mentionedCount = useMemo(
    () => mentionedRows.filter((r) => !mentionDone(r.id)).length,
    [mentionedRows, mentionDone],
  )

  // Per-NOTE mention state: maps a Trengo note message id → my mention row on
  // that note, so the conversation view can render a checkbox on the internal
  // note itself (Trengo-style) that ticks off just that notification, not the
  // ticket. Keyed off the mention update's source_msg_id
  // (`trengo:mention:<noteMsgId>:<hubId>`). Roy 2026-07-16.
  const mentionByNoteMsgId = useMemo(() => {
    const m = new Map<string, InboxItem>()
    for (const u of mentionItems) {
      const mm = (u.sourceMsgId ?? "").match(/^trengo:mention:(\d+):/)
      if (mm) m.set(mm[1], u)
    }
    return m
  }, [mentionItems])
  const toggleNoteMention = useCallback(
    (noteMsgId: string) => {
      const u = mentionByNoteMsgId.get(noteMsgId)
      if (!u) return
      const status = u.status === "read" ? "unread" : "read"
      fetch(`/api/inbox/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).then(refreshItems)
    },
    [mentionByNoteMsgId, refreshItems],
  )
  const noteMentions = useMemo(() => {
    const done: Record<string, boolean> = {}
    for (const [noteMsgId, u] of mentionByNoteMsgId) done[noteMsgId] = u.status === "read"
    return { done, toggle: toggleNoteMention }
  }, [mentionByNoteMsgId, toggleNoteMention])

  const onSelectChannel = useCallback((id: number) => {
    setViewMode("channel")
    setSelectedChannelId(id)
  }, [])
  const onSelectAll = useCallback(() => setViewMode("all"), [])
  const toggleExpand = useCallback(
    (group: ExternalGroup) => setExpanded((prev) => ({ ...prev, [group]: !prev[group] })),
    [],
  )

  // Every external thread as a row (the "All channels" overview + the search
  // pool when scope is "all channels").
  const allChannelRows = useMemo(() => {
    const rows = threads.map(threadToFeedRow).filter((r): r is FeedRow => r !== null)
    rows.sort((a, b) => b.sortAt.localeCompare(a.sortAt))
    return rows
  }, [threads])
  const allCount = useMemo(
    () =>
      threads.filter(
        (t) => !t.isArchived && (t.channelKind === "whatsapp" || t.channelKind === "email"),
      ).length,
    [threads],
  )

  // --- External selection + detail ------------------------------------------
  const [openRow, setOpenRow] = useState<FeedRow | null>(null)
  const [extState, setExtState] = useState<TicketState>("open")
  const [extSearch, setExtSearch] = useState("")

  // Rows for the active view (before the state-tab filter).
  const currentBase =
    viewMode === "mentioned" ? mentionedRows : viewMode === "all" ? allChannelRows : channelRows

  // Ticket search: contact name, client, or the latest message text. By default
  // it stays within the view you're in (a specific channel stays that channel -
  // Roy 2026-07-15: searching shouldn't silently jump to every line). The scope
  // toggle widens a channel search to all channels.
  const extBase = useMemo(() => {
    const q = extSearch.trim().toLowerCase()
    if (!q) return currentBase
    const pool = viewMode !== "channel" || searchScope === "all" ? allChannelRows : channelRows
    return pool.filter((r) => {
      const t = r.thread
      const hay = `${t?.primaryName ?? ""} ${t?.clientName ?? ""} ${t?.latestPreview ?? ""} ${t?.latestSubject ?? ""}`.toLowerCase()
      return q.split(/\s+/).every((w) => hay.includes(w))
    })
  }, [extSearch, currentBase, viewMode, searchScope, allChannelRows, channelRows])

  // Mentioned uses a per-user Open / Closed split (a personal to-do checkbox,
  // like Trengo). Channels use the shared Open / Assigned / Closed lifecycle.
  const extCounts = useMemo(() => {
    const c: Record<TicketState, number> = { open: 0, assigned: 0, closed: 0 }
    for (const r of extBase) {
      if (!r.thread) continue
      if (mentionedOnly) c[mentionDone(r.id) ? "closed" : "open"] += 1
      else c[threadState(r.thread)] += 1
    }
    return c
  }, [extBase, mentionedOnly, mentionDone])

  // Mentioned has no "assigned" state; fall back to Open if it's selected.
  const effectiveState: TicketState = mentionedOnly && extState === "assigned" ? "open" : extState
  const searching = extSearch.trim().length > 0
  const visibleExternalRows = useMemo(() => {
    // While searching, show every match regardless of the Open/Assigned/Closed
    // tab - you're hunting for a specific ticket, not triaging.
    if (searching) return extBase
    return extBase.filter((r) => {
      if (!r.thread) return false
      const s = mentionedOnly ? (mentionDone(r.id) ? "closed" : "open") : threadState(r.thread)
      return s === effectiveState
    })
  }, [extBase, mentionedOnly, mentionDone, effectiveState, searching])

  const extFilterTabs: TopTab<TicketState>[] = mentionedOnly
    ? [
        { id: "open", label: "Open", icon: Circle, count: extCounts.open, accent: "primary" },
        { id: "closed", label: locale === "nl" ? "Gesloten" : "Closed", icon: CircleCheck, count: extCounts.closed },
      ]
    : [
        { id: "open", label: "Open", icon: Circle, count: extCounts.open, accent: "primary" },
        { id: "assigned", label: locale === "nl" ? "Opgepakt" : "Assigned", icon: User, count: extCounts.assigned },
        { id: "closed", label: locale === "nl" ? "Gesloten" : "Closed", icon: CircleCheck, count: extCounts.closed },
      ]

  // Auto-open the top ticket on the external side (Roy: don't land on an empty
  // "select an item" state). Re-selects when the current one leaves the list
  // (channel/tab switch, or it got replied-to and moved tabs). No-op while the
  // open ticket is still visible, so it doesn't fight manual selection.
  useEffect(() => {
    if (!isExternal) return
    const stillVisible = openRow != null && visibleExternalRows.some((r) => r.id === openRow.id)
    if (stillVisible) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenRow(visibleExternalRows[0] ?? null)
  }, [isExternal, visibleExternalRows, openRow])

  const markThread = useCallback(
    (thread: ChatThreadSummary, action: string, payload?: { until?: string | null }) => {
      fetch(`/api/inbox/threads/${encodeURIComponent(thread.threadKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, until: payload?.until }),
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["inbox-threads", "external"] })
        queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      })
    },
    [queryClient],
  )
  const openItem = useCallback(
    (row: FeedRow) => {
      setOpenRow(row)
      if (row.kind === "chat" && row.thread && row.thread.unreadCount > 0) {
        markThread(row.thread, "mark_read")
      }
    },
    [markThread],
  )
  const onReplied = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["inbox-threads", "external"] })
    if (openRow?.thread) {
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", openRow.thread.threadKey] })
      // Auto pick-up: replying to an untouched (Open) ticket moves it to
      // Assigned. Leaves already-assigned / closed tickets alone.
      if (!openRow.thread.isArchived && !openRow.thread.isAssigned) {
        markThread(openRow.thread, "assign")
      }
    }
  }, [queryClient, openRow, markThread])

  // Explicit 3-state transitions (Open / Assigned / Closed) for the ticket
  // header buttons - the user always sees the two states it's NOT in.
  const setThreadState = useCallback(
    (thread: ChatThreadSummary, target: TicketState) => {
      markThread(thread, target === "closed" ? "archive" : target === "assigned" ? "assign" : "open")
    },
    [markThread],
  )

  const closeThread = useCallback(
    (row: FeedRow) => {
      if (!row.thread) return
      markThread(row.thread, row.thread.isArchived ? "unarchive" : "archive")
    },
    [markThread],
  )

  // Mark a mention done/undone = flip the read-state of MY mention update rows
  // for that thread (per-user; doesn't touch the shared thread).
  const closeMention = useCallback(
    (row: FeedRow) => {
      const list = mentionUpdatesByThread.get(baseThreadKey(row.id)) ?? []
      if (list.length === 0) return
      const done = list.every((u) => u.status === "read")
      const status = done ? "unread" : "read"
      Promise.all(
        list.map((u) =>
          fetch(`/api/inbox/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        ),
      ).then(refreshItems)
    },
    [mentionUpdatesByThread, refreshItems],
  )

  const selectMentioned = useCallback(() => {
    setViewMode("mentioned")
    setExtState((s) => (s === "assigned" ? "open" : s))
  }, [])

  // --- Composer --------------------------------------------------------------
  const [composerOpen, setComposerOpen] = useState(false)
  const [composerDefaults, setComposerDefaults] = useState<{
    kind: InboxKind
    clientId?: string
    title?: string
    body?: string
  }>({ kind: "task" })
  const openComposer = useCallback((kind: InboxKind = "task") => {
    setComposerDefaults({ kind })
    setComposerOpen(true)
  }, [])
  const openComposerFromChat = useCallback((args: { clientId: string; title: string; body?: string }) => {
    setComposerDefaults({ kind: "task", clientId: args.clientId, title: args.title, body: args.body })
    setComposerOpen(true)
  }, [])

  const handleRowAction = useCallback(
    async (row: FeedRow, action: RowAction) => {
      if (row.kind === "chat" || !row.item) return
      const id = row.id
      const patch = (body: Record<string, unknown>) =>
        fetch(`/api/inbox/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(refreshItems)
      if (action === "done") return void patch({ status: "done" })
      if (action === "reopen") return void patch({ status: "open" })
      if (action === "read") return void patch({ status: "read" })
      if (action === "unread") return void patch({ status: "unread" })
      if (action === "unsnooze") return void patch({ snoozedUntil: null })
      if (action === "make_task")
        return openComposerFromChat({ clientId: row.item.clientId, title: row.item.title, body: row.item.body ?? undefined })
      if (action === "delete") {
        await fetch(`/api/inbox/${id}`, { method: "DELETE" })
        if (openRow?.id === id) setOpenRow(null)
        return void refreshItems()
      }
      if (typeof action === "object") {
        if (action.type === "snooze") return void patch({ snoozedUntil: action.until })
        if (action.type === "reassign") return void patch({ assigneeId: action.assigneeId })
        if (action.type === "rename") return void patch({ title: action.title })
      }
    },
    [refreshItems, openComposerFromChat, openRow?.id],
  )

  // --- Render ----------------------------------------------------------------
  const externalLoading = canViewComms && threadsQuery.isLoading
  const internalLoading = tasksQuery.isLoading || updatesQuery.isLoading
  const containerH = locked
    ? "h-[calc(100vh-320px)] min-h-[440px]"
    : "h-[calc(100vh-208px)] min-h-[520px]"

  const scopeItems: Array<{ id: InboxScope; label: string }> = [
    { id: "internal", label: "Internal" },
    { id: "external", label: "External" },
  ]

  const externalRail = (
    <ExternalRail
      whatsapp={waEntries}
      email={emailEntries}
      activeChannelId={viewMode === "channel" ? activeChannelId : null}
      allActive={viewMode === "all"}
      allCount={allCount}
      mentionedOnly={mentionedOnly}
      mentionedCount={mentionedCount}
      expanded={expanded}
      onSelectAll={onSelectAll}
      onSelectChannel={onSelectChannel}
      onToggleExpand={toggleExpand}
      onSelectMentioned={selectMentioned}
      loading={identityQuery.isLoading}
    />
  )
  const internalRail = (
    <InternalRail
      types={internalTypes}
      counts={internalCounts}
      onToggleType={toggleType}
      onSelectAllTypes={selectAllTypes}
      deadline={deadline}
      onDeadlineChange={setDeadline}
    />
  )
  const railForScope = isExternal ? externalRail : internalRail
  const railToggle = (
    <button
      type="button"
      onClick={toggleRail}
      title={railCollapsed ? "Show sidebar" : "Hide sidebar"}
      aria-label={railCollapsed ? "Show sidebar" : "Hide sidebar"}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {railCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  )

  const emptyHint = isExternal
    ? searching
      ? "No tickets match your search."
      : mentionedOnly
        ? "No tickets mention you right now."
        : identityChannels.length === 0
          ? "No channels connected — add them in Account settings."
          : viewMode === "all"
            ? "No tickets in this view."
            : "No tickets on this channel in this view."
    : null

  return (
    <div className="flex flex-col gap-4">
      {!locked && (
        <PageHeader
          title="Inbox"
          actions={
            <Button size="sm" onClick={() => openComposer(isExternal ? "task" : "update")}>
              <Plus className="h-4 w-4" /> New
            </Button>
          }
        />
      )}

      <div className="flex items-center gap-2">
        {railToggle}
        {(!locked || canViewComms) && (
          <SegmentedTabs items={scopeItems} value={scope} onChange={setScope} />
        )}
      </div>

      {/* Rail above the feed below xl (and always in locked mode). Hidden when
          the user collapses the sidebar. */}
      {!railCollapsed && (
        <div className={cn(locked ? "block" : "xl:hidden")}>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 p-2">{railForScope}</div>
        </div>
      )}

      {isExternal ? (
        <div className={cn("flex min-w-0 flex-col gap-4 lg:flex-row", containerH)}>
          {/* Left block: the ticket search sits ABOVE the rail + feed (only as
              wide as those two columns, Roy 2026-07-15) and shrinks with them
              when the rail collapses. The chat sits beside it at full height. */}
          <div
            className={cn(
              "flex w-full min-w-0 flex-col gap-3",
              locked
                ? "lg:w-[380px]"
                : railCollapsed
                  ? "lg:w-[400px]"
                  : "lg:w-[400px] xl:w-[640px]",
            )}
          >
            <div className="relative shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                value={extSearch}
                onChange={(e) => setExtSearch(e.target.value)}
                placeholder="Search tickets — name, client, or message…"
                className="h-9 w-full rounded-md border border-border/60 bg-card pl-9 pr-9 text-sm focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
              {extSearch && (
                <button
                  type="button"
                  onClick={() => setExtSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Scope toggle: when searching inside one channel, choose whether
                to stay on that line or widen to all channels (Trengo-style). */}
            {searching && viewMode === "channel" && (
              <div className="flex shrink-0 items-center gap-1.5 px-1 text-xs">
                <span className="text-muted-foreground/60">Search in:</span>
                <button
                  type="button"
                  onClick={() => setSearchScope("current")}
                  className={cn(
                    "rounded-md px-2 py-0.5 font-medium transition-colors",
                    searchScope === "current" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {[...waEntries, ...emailEntries].find((e) => e.id === activeChannelId)?.name ?? "This channel"}
                </button>
                <button
                  type="button"
                  onClick={() => setSearchScope("all")}
                  className={cn(
                    "rounded-md px-2 py-0.5 font-medium transition-colors",
                    searchScope === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  All channels
                </button>
              </div>
            )}
            <div className="flex min-h-0 flex-1 gap-4">
              {!locked && !railCollapsed && (
                <aside className="hidden w-[210px] shrink-0 overflow-y-auto xl:block">{externalRail}</aside>
              )}
              <div className="min-h-0 min-w-0 flex-1">
                <UnifiedFeed
                  rows={visibleExternalRows}
                  loading={externalLoading}
                  activeId={openRow?.id ?? null}
                  showClient={!locked}
                  filterTabs={extFilterTabs}
                  filterValue={effectiveState}
                  onFilterChange={setExtState}
                  onOpen={openItem}
                  onAction={handleRowAction}
                  onCloseRow={mentionedOnly ? closeMention : closeThread}
                  closedOf={mentionedOnly ? (row) => mentionDone(row.id) : undefined}
                  users={users}
                  emptyHint={emptyHint}
                />
              </div>
            </div>
          </div>
          <div className="hidden min-h-0 min-w-0 flex-1 lg:block">
            <DetailPane
              row={openRow}
              currentUser={currentUser}
              users={users}
              onClose={() => setOpenRow(null)}
              onChanged={refreshItems}
              onReplied={onReplied}
              onMakeTaskFromMessage={openComposerFromChat}
              mentioned={mentionedOnly}
              noteMentions={noteMentions}
              ticketState={openRow?.thread ? threadState(openRow.thread) : undefined}
              onSetState={(t) => {
                if (openRow?.thread) setThreadState(openRow.thread, t)
              }}
            />
          </div>
        </div>
      ) : (
        <div className={cn("grid min-w-0 gap-4", containerH, railCollapsed ? "grid-cols-1" : "grid-cols-1 xl:grid-cols-[230px_1fr]")}>
          {!locked && !railCollapsed && (
            <aside className="hidden min-h-0 overflow-y-auto xl:block">{internalRail}</aside>
          )}
          <div className="w-full min-h-0 min-w-0 max-w-3xl">
            <UpdateFeed
              items={items}
              currentUserId={currentUser.id}
              types={internalTypes}
              deadline={deadline}
              loading={internalLoading}
              onChanged={refreshItems}
            />
          </div>
        </div>
      )}

      {/* External detail overlay below lg */}
      {isExternal && openRow && (
        <div className="fixed inset-0 z-50 bg-background p-3 lg:hidden">
          <div className="h-full">
            <DetailPane
              row={openRow}
              currentUser={currentUser}
              users={users}
              onClose={() => setOpenRow(null)}
              onChanged={refreshItems}
              onReplied={onReplied}
              onMakeTaskFromMessage={openComposerFromChat}
              mentioned={mentionedOnly}
              noteMentions={noteMentions}
              ticketState={openRow?.thread ? threadState(openRow.thread) : undefined}
              onSetState={(t) => {
                if (openRow?.thread) setThreadState(openRow.thread, t)
              }}
              showDismiss
            />
          </div>
        </div>
      )}

      <ComposerDialog
        open={composerOpen}
        onOpenChange={setComposerOpen}
        defaultKind={composerDefaults.kind}
        users={users}
        clients={clients}
        lockedClient={locked ?? undefined}
        currentUserId={currentUser.id}
        onCreated={() => {
          setComposerOpen(false)
          refreshItems()
        }}
        defaultClientId={composerDefaults.clientId}
        defaultTitle={composerDefaults.title}
        defaultBody={composerDefaults.body}
      />
    </div>
  )
}
