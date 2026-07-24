"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, PanelLeftClose, PanelLeftOpen, Circle, User, CircleCheck, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import type { TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { ComposerDialog } from "../composer-dialog"
import { type ChannelEntry, type ExternalGroup } from "./external-rail"
import { InternalRail, type InternalType, type DeadlineFilter } from "./internal-rail"
import { UnifiedFeed } from "./unified-feed"
import { InboxHero } from "./inbox-hero"
import { ChannelPicker } from "./channel-picker"
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

/** The instant, client-side state change a thread action implies, applied
 *  optimistically to the cached thread so the row moves tabs / clears its badge
 *  the moment you click - before the server (and its background Trengo mirror)
 *  round-trip. Returns null for actions with no visible thread-state change.
 *  Roy 2026-07-21: "als ik klik, boom, de volgende". */
function optimisticThreadPatch(
  action: string,
  payload?: { until?: string | null },
): Partial<ChatThreadSummary> | null {
  switch (action) {
    case "archive":
      return { isArchived: true }
    case "unarchive":
      return { isArchived: false }
    case "assign":
      return { isAssigned: true }
    case "open":
      return { isArchived: false, isAssigned: false }
    case "mark_read":
      return { unreadCount: 0 }
    case "mark_unread":
      return { unreadCount: 1 }
    case "star":
      return { isStarred: true }
    case "unstar":
      return { isStarred: false }
    case "snooze":
      return { snoozedUntil: payload?.until ?? null }
    case "unsnooze":
      return { snoozedUntil: null }
    default:
      return null
  }
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
  const threadKey = mentionThreadKey(u)
  if (!threadKey) return null
  if (loaded) return threadToFeedRow(loaded)
  // Read the conversation name + channel the fan-out recorded on the mention so
  // the row/detail look identical to the channel view even when the thread
  // isn't loaded (unsubscribed channel). Fall back to parsing the title.
  const ref = (u.sourceRef ?? {}) as Record<string, unknown>
  const storedName = ref.trengo_mention_contact_name
  const storedChannelName = ref.trengo_mention_channel_name
  const storedChannelKind = ref.trengo_mention_channel_kind
  const parsed = u.title.match(/^(.*?)\s+mentioned you(?:\s+in\s+(.*))?$/i)?.[2]
  const contactName =
    (typeof storedName === "string" && storedName.trim()) ||
    (parsed && parsed.trim()) ||
    (u.clientName && u.clientName !== "(unknown)" ? u.clientName : "") ||
    "Conversation"
  const channelKind = (typeof storedChannelKind === "string"
    ? storedChannelKind
    : u.channelKind ?? null) as ChatThreadSummary["channelKind"]
  const channelName = typeof storedChannelName === "string" ? storedChannelName : null
  const stub: ChatThreadSummary = {
    threadKey,
    scope: "external",
    source: "trengo",
    primaryName: contactName,
    clientName: u.clientName && u.clientName !== "(unknown)" ? u.clientName : null,
    clientId: null,
    channelKind,
    channelName,
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
    id: threadKey,
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
    // Mentions now key on the PER-CHANNEL thread (`...|ch:<channel>`), so match
    // the loaded thread by its full key - that IS the same ticket as in the
    // channel view (Roy 2026-07-17). Fall back to a stub when unsubscribed.
    const threadByKey = new Map<string, ChatThreadSummary>()
    for (const t of threads) threadByKey.set(t.threadKey, t)
    const seen = new Set<string>()
    const rows: FeedRow[] = []
    for (const u of mentionItems) {
      const key = mentionThreadKey(u)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const row = mentionUpdateToFeedRow(u, threadByKey.get(key))
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
      const list = mentionUpdatesByThread.get(threadKey)
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

  // Per-channel-kind threads + unread, for the compact COMMS hero strip.
  const channelStats = useMemo(() => {
    let waT = 0, waU = 0, emT = 0, emU = 0
    for (const th of threads) {
      const isOpen = !th.isArchived && !th.isAssigned
      const unread = isOpen && th.unreadCount > 0 ? 1 : 0
      if (th.channelKind === "whatsapp") { waT += 1; waU += unread }
      else if (th.channelKind === "email") { emT += 1; emU += unread }
    }
    return [
      { label: "WhatsApp", threads: waT, unread: waU },
      { label: "Email", threads: emT, unread: emU },
    ]
  }, [threads])

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
        { id: "open", label: t("inbox.shell.state.open", locale), icon: Circle, count: extCounts.open, accent: "primary" },
        { id: "closed", label: t("inbox.shell.state.closed", locale), icon: CircleCheck, count: extCounts.closed },
      ]
    : [
        { id: "open", label: t("inbox.shell.state.open", locale), icon: Circle, count: extCounts.open, accent: "primary" },
        { id: "assigned", label: t("inbox.shell.state.assigned", locale), icon: User, count: extCounts.assigned },
        { id: "closed", label: t("inbox.shell.state.closed", locale), icon: CircleCheck, count: extCounts.closed },
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
      // 1. Optimistic: patch the cached thread NOW so the row moves tabs / clears
      //    its badge and the auto-open effect advances to the next ticket, all in
      //    the same frame as the click. No waiting on the network.
      const patch = optimisticThreadPatch(action, payload)
      if (patch) {
        queryClient.setQueryData<{ threads: ChatThreadSummary[] }>(
          ["inbox-threads", "external"],
          (old) =>
            old?.threads
              ? {
                  ...old,
                  threads: old.threads.map((t) =>
                    t.threadKey === thread.threadKey ? { ...t, ...patch } : t,
                  ),
                }
              : old,
        )
      }
      // 2. Fire the write. On success we DON'T refetch the list (the optimistic
      //    state already matches the canonical Supabase write, and a refetch
      //    would flicker); the 5s poll + open-thread detail invalidate reconcile.
      //    On failure we resync from the server to roll the optimism back.
      fetch(`/api/inbox/threads/${encodeURIComponent(thread.threadKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, until: payload?.until }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`thread ${action} failed: ${res.status}`)
          queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
        })
        .catch(() => {
          queryClient.invalidateQueries({ queryKey: ["inbox-threads", "external"] })
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
    if (openRow?.thread) {
      // Show the message we just sent in the open pane.
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", openRow.thread.threadKey] })
      // Auto pick-up: replying to an untouched (Open) ticket moves it to
      // Opgepakt, instantly + optimistically (markThread patches the cache).
      // Open = nothing done yet; the moment you reply, you've picked it up.
      // Roy 2026-07-22. We deliberately do NOT invalidate the thread list here:
      // that refetch races the async assign and would clobber the optimistic
      // Opgepakt back to Open. The 5s poll reconciles the preview.
      if (!openRow.thread.isArchived && !openRow.thread.isAssigned) {
        markThread(openRow.thread, "assign")
        // Follow the ticket to the Assigned tab so you stay on the conversation
        // (and see your reply land) instead of the Open-tab auto-advance jumping
        // you to the next ticket right after you send.
        setExtState((s) => (s === "open" ? "assigned" : s))
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

  // Mark a mention done/undone = flip the read-state of MY mention update rows
  // for that thread (per-user; doesn't touch the shared thread).
  const closeMention = useCallback(
    (row: FeedRow) => {
      const list = mentionUpdatesByThread.get(row.id) ?? []
      if (list.length === 0) return
      const done = list.every((u) => u.status === "read")
      const status = done ? "unread" : "read"
      const ids = new Set(list.map((u) => u.id))
      // Optimistic: flip the cached mention rows now so the row moves To-do <->
      // Done and the Mentioned view advances instantly (Roy 2026-07-21).
      queryClient.setQueryData<{ items: InboxItem[] }>(
        ["shell-mentions", locked?.id ?? "me"],
        (old) =>
          old?.items
            ? { ...old, items: old.items.map((it) => (ids.has(it.id) ? { ...it, status } : it)) }
            : old,
      )
      Promise.all(
        list.map((u) =>
          fetch(`/api/inbox/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          }),
        ),
      ).catch(refreshItems) // only resync on failure; success already matches
    },
    [mentionUpdatesByThread, queryClient, locked?.id, refreshItems],
  )

  const selectMentioned = useCallback(() => {
    setViewMode("mentioned")
    setExtState((s) => (s === "assigned" ? "open" : s))
  }, [])

  // --- Channel-ticket multi-select (bulk close) ------------------------------
  // Roy 2026-07-21: select tickets via the left channel icon, Shift-click to
  // range-select down the list, then close them all at once from the bulk bar.
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set())
  const lastSelectedRef = useRef<string | null>(null)
  // Offer selection on the channel ticket views (not the Mentioned view, whose
  // right-side per-user "done" checkbox is a different axis). Shift-range uses
  // whatever order the current list is in (tab or search results).
  const selectable = isExternal && !mentionedOnly

  const toggleTicketSelect = useCallback(
    (row: FeedRow, e: React.MouseEvent) => {
      const ordered = visibleExternalRows.map((r) => r.id)
      const anchor = lastSelectedRef.current
      setSelectedTickets((prev) => {
        const next = new Set(prev)
        if (e.shiftKey && anchor && anchor !== row.id) {
          // Range-select every row between the last-clicked anchor and this one.
          const a = ordered.indexOf(anchor)
          const b = ordered.indexOf(row.id)
          if (a !== -1 && b !== -1) {
            const [lo, hi] = a < b ? [a, b] : [b, a]
            for (let i = lo; i <= hi; i++) next.add(ordered[i])
          } else {
            next.has(row.id) ? next.delete(row.id) : next.add(row.id)
          }
        } else {
          next.has(row.id) ? next.delete(row.id) : next.add(row.id)
        }
        return next
      })
      lastSelectedRef.current = row.id
    },
    [visibleExternalRows],
  )

  const clearTicketSelection = useCallback(() => {
    setSelectedTickets((prev) => (prev.size === 0 ? prev : new Set()))
    lastSelectedRef.current = null
  }, [])

  // Selection is scoped to the current tab/view — drop it when the context
  // changes so a stale Shift-anchor can't range-select across lists.
  useEffect(() => {
    clearTicketSelection()
  }, [effectiveState, viewMode, scope, clearTicketSelection])

  const closeSelectedTickets = useCallback(() => {
    const ids = Array.from(selectedTickets)
    for (const id of ids) {
      const thread = threads.find((t) => t.threadKey === id)
      if (thread && !thread.isArchived) markThread(thread, "archive")
    }
    clearTicketSelection()
  }, [selectedTickets, threads, markThread, clearTicketSelection])

  // Select-all header (Trengo-style): tri-state over the currently-visible tab.
  const visibleTicketIds = useMemo(() => visibleExternalRows.map((r) => r.id), [visibleExternalRows])
  const selectAllState: "none" | "some" | "all" = useMemo(() => {
    if (!selectable || visibleTicketIds.length === 0) return "none"
    const sel = visibleTicketIds.filter((id) => selectedTickets.has(id)).length
    if (sel === 0) return "none"
    return sel === visibleTicketIds.length ? "all" : "some"
  }, [selectable, visibleTicketIds, selectedTickets])
  const toggleSelectAll = useCallback(() => {
    setSelectedTickets((prev) => {
      const allSelected =
        visibleTicketIds.length > 0 && visibleTicketIds.every((id) => prev.has(id))
      return allSelected ? new Set() : new Set(visibleTicketIds)
    })
    lastSelectedRef.current = null
  }, [visibleTicketIds])

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
    { id: "internal", label: t("inbox.shell.scope.internal", locale) },
    { id: "external", label: t("inbox.shell.scope.external", locale) },
  ]

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
  // Compact channel selector — the 187N 2-column fold of the external rail into
  // the thread-list header. Roy 2026-07-24.
  const channelPicker = (
    <ChannelPicker
      whatsapp={waEntries}
      email={emailEntries}
      activeChannelId={viewMode === "channel" ? activeChannelId : null}
      allActive={viewMode === "all"}
      mentionedOnly={mentionedOnly}
      allCount={allCount}
      mentionedCount={mentionedCount}
      onSelectAll={onSelectAll}
      onSelectChannel={onSelectChannel}
      onSelectMentioned={selectMentioned}
    />
  )
  const railToggle = (
    <button
      type="button"
      onClick={toggleRail}
      title={railCollapsed ? t("inbox.shell.rail.show", locale) : t("inbox.shell.rail.hide", locale)}
      aria-label={railCollapsed ? t("inbox.shell.rail.show", locale) : t("inbox.shell.rail.hide", locale)}
      className="icon-btn shrink-0"
    >
      {railCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
    </button>
  )

  const emptyHint = isExternal
    ? searching
      ? t("inbox.shell.empty.search", locale)
      : mentionedOnly
        ? t("inbox.shell.empty.mentioned", locale)
        : identityChannels.length === 0
          ? t("inbox.shell.empty.no_channels", locale)
          : viewMode === "all"
            ? t("inbox.shell.empty.view", locale)
            : t("inbox.shell.empty.view_channel", locale)
    : null

  return (
    <div className="flex flex-col gap-4">
      {!locked && (
        <PageHeader
          title={t("inbox.shell.header.title", locale)}
          actions={
            <Button size="sm" onClick={() => openComposer(isExternal ? "task" : "update")}>
              <Plus className="h-4 w-4" /> {t("inbox.shell.action.new", locale)}
            </Button>
          }
        />
      )}

      <div className="flex items-center gap-2">
        {railToggle}
        {(!locked || canViewComms) && (
          <div className="flex items-center gap-1.5" role="group" aria-label="Scope">
            {scopeItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setScope(it.id)}
                aria-pressed={scope === it.id}
                className={cn("chip h-9", scope === it.id && "active")}
              >
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compact COMMS · LIVE strip - only on the main channel inbox (not locked
          per-client tabs, not the Mentioned view). */}
      {isExternal && !locked && !mentionedOnly && (
        <InboxHero
          newCount={extCounts.open}
          assignedCount={extCounts.assigned}
          closedCount={extCounts.closed}
          channels={channelStats}
        />
      )}

      {/* Internal scope keeps its Type/Deadline rail above the feed below xl (and
          always in locked mode). The external scope folds its channel rail into
          the ChannelPicker in the list header instead. Roy 2026-07-24. */}
      {!isExternal && !railCollapsed && (
        <div className={cn(locked ? "block" : "xl:hidden")}>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 p-2">{internalRail}</div>
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
              // 187N 2-column fold: the channel rail is gone (now the
              // ChannelPicker dropdown in this column's header), so the list
              // column is just the thread list. Roy 2026-07-24.
              locked ? "lg:w-[360px]" : "lg:w-[360px] xl:w-[400px]",
            )}
          >
            <div className="search-pill w-full shrink-0">
              <Search />
              <input
                type="text"
                value={extSearch}
                onChange={(e) => setExtSearch(e.target.value)}
                placeholder={t("inbox.shell.search.placeholder", locale)}
              />
              {extSearch && (
                <button
                  type="button"
                  onClick={() => setExtSearch("")}
                  aria-label={t("inbox.shell.search.clear", locale)}
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Channel selector (folds the old rail into the list header). Hidden
                while searching - search spans the current scope. */}
            {!searching && channelPicker}
            {/* Scope toggle: when searching inside one channel, choose whether
                to stay on that line or widen to all channels (Trengo-style). */}
            {searching && viewMode === "channel" && (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">{t("inbox.shell.search.scope_label", locale)}</span>
                <button
                  type="button"
                  onClick={() => setSearchScope("current")}
                  className={cn("chip h-7", searchScope === "current" && "active")}
                >
                  {[...waEntries, ...emailEntries].find((e) => e.id === activeChannelId)?.name ?? t("inbox.shell.search.scope_this", locale)}
                </button>
                <button
                  type="button"
                  onClick={() => setSearchScope("all")}
                  className={cn("chip h-7", searchScope === "all" && "active")}
                >
                  {t("inbox.shell.search.scope_all", locale)}
                </button>
              </div>
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
                onCloseRow={mentionedOnly ? closeMention : undefined}
                closedOf={mentionedOnly ? (row) => mentionDone(row.id) : undefined}
                checkboxKind={mentionedOnly ? "mention" : "ticket"}
                selectable={selectable}
                selectedOf={selectable ? (row) => selectedTickets.has(row.id) : undefined}
                onToggleSelect={selectable ? toggleTicketSelect : undefined}
                selectAllState={selectAllState}
                onToggleSelectAll={toggleSelectAll}
                users={users}
                emptyHint={emptyHint}
              />
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

      {/* Bulk-select action bar — appears once ≥1 ticket is selected via the
          left icon. Same h-9 rounded-md chip chrome as the chat bulk bar. */}
      {selectable && selectedTickets.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-popover px-2 py-1.5 shadow-lg">
          <span className="px-2 text-xs font-medium tabular-nums">
            {t("inbox.shell.bulk.selected", locale, { n: selectedTickets.size })}
          </span>
          <span className="h-5 w-px bg-border/60" aria-hidden />
          <button
            type="button"
            onClick={closeSelectedTickets}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            <CircleCheck className="h-3.5 w-3.5" />
            {t("inbox.shell.bulk.close", locale)}
          </button>
          <span className="h-5 w-px bg-border/60" aria-hidden />
          <button
            type="button"
            onClick={clearTicketSelection}
            className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t("inbox.shell.bulk.clear", locale)}
          </button>
        </div>
      )}
    </div>
  )
}
