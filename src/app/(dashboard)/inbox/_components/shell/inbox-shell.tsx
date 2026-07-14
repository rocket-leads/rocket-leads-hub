"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { cn } from "@/lib/utils"
import { ComposerDialog } from "../composer-dialog"
import { ChannelRail } from "./channel-rail"
import { UnifiedFeed, type FeedFilter } from "./unified-feed"
import { DetailPane } from "./detail-pane"
import {
  ALL_CHANNELS,
  mergeFeed,
  parseChannelsParam,
  serializeChannelsParam,
  type FeedChannel,
  type FeedRow,
  type CurrentUser,
  type InboxUser,
  type InboxClientOption,
  type LockedClient,
} from "./types"
import type { InboxItem, InboxKind } from "@/types/inbox"
import type { ChatThreadSummary } from "@/lib/inbox/fetchers"
import type { RowAction } from "../inbox-list-row"

type Props = {
  currentUser: CurrentUser
  initialUpdates: InboxItem[]
  initialTasks: InboxItem[]
  users: InboxUser[]
  clients: InboxClientOption[]
  /** When set, the shell is scoped to a single client (per-client inbox tab). */
  lockedClient?: LockedClient
}

const REFETCH_MS = 5000

/**
 * The 3-pane unified inbox: channel rail (multi-select) → merged feed → wide
 * detail pane. Replaces the InboxView monolith's layout. Reuses every data
 * endpoint and detail/composer component; the shell only owns the merge, the
 * channel filter, and the pane layout.
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

  const locked = lockedClient ?? null
  const canViewComms = locked ? locked.canViewCommunication !== false : true
  const hiddenChannels: FeedChannel[] = canViewComms ? [] : ["whatsapp", "email"]

  // Channel selection. URL is the source of truth in global mode (shareable,
  // back-button friendly); locked mode keeps it in local state so it doesn't
  // rewrite the client page's URL. Channels the user can't view are stripped.
  const [lockedSelected, setLockedSelected] = useState<Set<FeedChannel>>(
    () => new Set(ALL_CHANNELS.filter((c) => !hiddenChannels.includes(c))),
  )
  const selected = useMemo(() => {
    const base = locked ? lockedSelected : parseChannelsParam(searchParams.get("channels"))
    // never surface a hidden channel even if the URL forces it
    const pruned = new Set<FeedChannel>()
    for (const c of base) if (!hiddenChannels.includes(c)) pruned.add(c)
    return pruned
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, lockedSelected, searchParams, canViewComms])

  const setSelected = useCallback(
    (next: Set<FeedChannel>) => {
      if (locked) {
        setLockedSelected(next)
        return
      }
      const serialized = serializeChannelsParam(next)
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (serialized === null) params.delete("channels")
      else params.set("channels", serialized)
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : "?", { scroll: false })
    },
    [locked, router, searchParams],
  )

  const toggleChannel = useCallback(
    (channel: FeedChannel) => {
      const next = new Set(selected)
      if (next.has(channel)) next.delete(channel)
      else next.add(channel)
      setSelected(next)
    },
    [selected, setSelected],
  )
  const selectAll = useCallback(() => {
    setSelected(new Set(ALL_CHANNELS.filter((c) => !hiddenChannels.includes(c))))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSelected, canViewComms])

  // --- Data sources (all existing endpoints) ---------------------------------
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
  // Shares the cache key with ChatPane so mark/reply invalidations line up.
  const threadsQuery = useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["inbox-threads", "external"],
    queryFn: () => fetch("/api/inbox/threads?scope=external").then((r) => r.json()),
    enabled: canViewComms,
    staleTime: REFETCH_MS,
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: false,
  })

  const items = useMemo(
    () => [...(tasksQuery.data?.items ?? []), ...(updatesQuery.data?.items ?? [])],
    [tasksQuery.data?.items, updatesQuery.data?.items],
  )
  const threads = useMemo(() => {
    const all = threadsQuery.data?.threads ?? []
    // Per-client mode: the threads endpoint isn't client-scoped, so narrow here.
    return locked ? all.filter((t) => t.clientId === locked.id) : all
  }, [threadsQuery.data?.threads, locked])

  // Full merge across ALL channels drives the rail badge counts; the display
  // feed is the same merge filtered to the checked channels.
  const allRows = useMemo(() => mergeFeed(items, threads, new Set(ALL_CHANNELS)), [items, threads])
  const feedRows = useMemo(() => allRows.filter((r) => selected.has(r.channel)), [allRows, selected])

  const counts = useMemo(() => {
    const c: Record<FeedChannel, number> = { tasks: 0, updates: 0, whatsapp: 0, email: 0 }
    for (const r of allRows) if (r.unread) c[r.channel] += 1
    return c
  }, [allRows])

  // --- Selection + detail ----------------------------------------------------
  const [openRow, setOpenRow] = useState<FeedRow | null>(null)
  const [filter, setFilter] = useState<FeedFilter>("unread")

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

  const refreshItems = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["shell-tasks", locked?.id ?? "me"] })
    queryClient.invalidateQueries({ queryKey: ["shell-updates", locked?.id ?? "me"] })
  }, [queryClient, locked?.id])

  const onReplied = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["inbox-threads", "external"] })
    if (openRow?.thread) {
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", openRow.thread.threadKey] })
    }
  }, [queryClient, openRow?.thread])

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

  // --- Row (task/update) actions --------------------------------------------
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

  const loading = tasksQuery.isLoading || updatesQuery.isLoading || (canViewComms && threadsQuery.isLoading)
  const showClient = !locked
  const containerH = locked
    ? "h-[calc(100vh-320px)] min-h-[440px]"
    : "h-[calc(100vh-172px)] min-h-[540px]"

  const emptyHint = !canViewComms ? null : selected.size === 0 ? "No channels selected — pick one on the left." : null

  return (
    <div className="flex flex-col gap-4">
      {!locked && (
        <PageHeader
          title="Inbox"
          actions={
            <Button size="sm" onClick={() => openComposer("task")}>
              <Plus className="h-4 w-4" /> New
            </Button>
          }
        />
      )}

      {/* Horizontal channel strip: always below xl, and always in locked mode
          (the client tab is too narrow for a 3rd column). */}
      <div className={cn(locked ? "block" : "xl:hidden")}>
        <ChannelRail
          orientation="horizontal"
          selected={selected}
          counts={counts}
          onToggle={toggleChannel}
          onSelectAll={selectAll}
          hidden={hiddenChannels}
        />
      </div>

      <div
        className={cn(
          "grid gap-4",
          containerH,
          locked
            ? "grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr]"
            : "grid-cols-1 lg:grid-cols-[minmax(340px,420px)_1fr] xl:grid-cols-[210px_minmax(340px,420px)_1fr]",
        )}
      >
        {/* Vertical rail: xl+ global only */}
        {!locked && (
          <aside className="hidden min-h-0 overflow-y-auto xl:block">
            <ChannelRail
              orientation="vertical"
              selected={selected}
              counts={counts}
              onToggle={toggleChannel}
              onSelectAll={selectAll}
              hidden={hiddenChannels}
            />
          </aside>
        )}

        {/* Feed */}
        <div className="min-h-0">
          <UnifiedFeed
            rows={feedRows}
            loading={loading}
            activeId={openRow?.id ?? null}
            showClient={showClient}
            filter={filter}
            onFilterChange={setFilter}
            onOpen={openItem}
            onAction={handleRowAction}
            users={users}
            emptyHint={emptyHint}
          />
        </div>

        {/* Detail: inline on lg+ */}
        <div className="hidden min-h-0 lg:block">
          <DetailPane
            row={openRow}
            currentUser={currentUser}
            users={users}
            onClose={() => setOpenRow(null)}
            onChanged={refreshItems}
            onReplied={onReplied}
            onMakeTaskFromMessage={openComposerFromChat}
            onMarkThread={markThread}
          />
        </div>
      </div>

      {/* Detail overlay: below lg */}
      {openRow && (
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
              onMarkThread={markThread}
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
