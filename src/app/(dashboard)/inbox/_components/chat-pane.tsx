"use client"

import { useState, useEffect, useRef, useMemo, Fragment } from "react"
import Image from "next/image"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Loader2,
  Send,
  MessageSquare,
  Hash,
  LayoutGrid,
  LayoutList,
  Inbox,
  Mail,
  Check,
  CheckCheck,
  MailOpen,
  X,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Bold,
  Italic,
  Strikethrough,
  Clock3,
  ShieldAlert,
  ChevronDown,
  ListTodo,
  Sparkles,
  Star,
  Archive,
  Link2,
  Forward,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DismissButton } from "@/components/ui/dismiss-button"
import { ErrorBoundary } from "@/components/ui/error-boundary"
import { InboxRowSkeletonList } from "./shell/row-skeleton"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { UserAvatar } from "@/components/ui/user-avatar"
import { cn } from "@/lib/utils"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import type { ChatScope, ChatThreadSummary, ChatMessage, ChatAttachment } from "@/lib/inbox/fetchers"
import type { InboxUser } from "./shell/types"
import { EmailComposer } from "./email-composer"
import { ClientUpdateButton } from "@/app/(dashboard)/clients/_components/client-update-button"
import type { TrengoIdentity } from "@/app/api/inbox/trengo-identity/route"
import { AlertTriangle } from "lucide-react"

type Props = {
  scope: ChatScope
  /** Reserved for future features (assignee labels, @-mention autocomplete).
   *  Accepted now so callers can wire it pre-emptively. */
  users?: InboxUser[]
  /** Opens the parent composer pre-filled when the user hits "Make task" on
   *  a message bubble. Passes through the linked client id + a title preview
   *  derived from the message body so the AM only has to confirm. Optional
   *  - when omitted, the Make-task affordance is hidden (e.g. per-client
   *  views that don't have a composer wired up yet). */
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  /** Docked-pane mode. When true, ChatPane renders only the thread list
   *  (no internal ThreadView column) and bubbles the current selection up
   *  to the parent via `selectedThreadKey` + `onSelectedChange`. The parent
   *  is then responsible for rendering ThreadView inside the right-side
   *  docked pane. This keeps the Client Inbox visually consistent with the
   *  Tasks/Updates docked pattern on xl+ screens. */
  dockedDetail?: boolean
  /** Controlled-mode selection. Provided alongside `dockedDetail` so the
   *  parent (inbox-view) can open a thread from outside the pane (e.g.
   *  clicking a chat card on the Now tab). Omit for the legacy internal
   *  split layout where ChatPane manages selection itself. */
  selectedThreadKey?: string | null
  onSelectedChange?: (thread: ChatThreadSummary | null) => void
  /** Free-text search applied to the thread list. Matches the contact
   *  name, the linked client name, and the latest preview. Empty string =
   *  no filter. Driven from the inbox-level toolbar search input so the
   *  same field works across Tasks / Updates / Now / Client Inbox. */
  searchQuery?: string
  /** Slot rendered DIRECTLY under the All/Unread filter strip. Roy
   *  2026-06-09: the inbox-level search input lives here on the Client
   *  Inbox tab so it visually sits beneath the sub-filter chips, same
   *  as on Tasks/Updates. ChatPane stays unaware of what the slot
   *  contains - just renders it in the right slot. */
  underTabsSlot?: React.ReactNode
}

/** All thread-level triage signals share one server endpoint
 *  (`PATCH /api/inbox/threads/{key}`) so they share the wire format
 *  here. New entries need a corresponding optimistic update inside
 *  `markThread` so the list reacts instantly. */
type MarkAction =
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "archive"
  | "unarchive"
  | "snooze"
  | "unsnooze"
/** Snoozed and archived join Unread + All as discoverable filter
 *  buckets. Starred is a per-row icon toggle, not a filter view -
 *  scope kept tight so the strip stays a clean 4-up. */
type ChatFilter = "all" | "unread" | "snoozed" | "archived"

/**
 * Two-pane chat view for the Team Inbox / Client Inbox tabs.
 *
 * Left: list of threads grouped by thread_key (Trengo contact, Slack DM,
 * Slack channel, etc.), most-recently-active first. Click selects.
 *
 * Right: selected thread's messages in chronological order, plus a reply box
 * at the bottom. Reply uses the existing /api/inbox/[id]/reply endpoint -
 * we pass the thread's latest event id; the helper derives source +
 * thread metadata from there.
 *
 * Multi-select + bulk mark read/unread mirror the Updates tab UX so an AM
 * doesn't have to learn two patterns. Per-row hover actions cover the common
 * "save for later" case (mark a single thread back to unread without
 * selecting). The fixed-height grid is sized to fill the viewport so the
 * thread list scrolls independently of the page chrome - fixes the prior
 * h-[640px] which left half the page empty.
 */
export function ChatPane({
  scope,
  users,
  onMakeTaskFromMessage,
  dockedDetail,
  selectedThreadKey,
  onSelectedChange,
  searchQuery = "",
  underTabsSlot,
}: Props) {
  const queryClient = useQueryClient()
  const locale = useLocale()
  // Selection state. Always lives in `selectedInternal`; in docked mode we
  // keep it in sync with the parent's controlled `selectedThreadKey` via a
  // useEffect below, so auto-select-first and re-select-on-refresh logic
  // still works without a second source of truth. setSelected fans out to
  // the parent in docked mode so the parent's docked aside renders the
  // correct ThreadView.
  const [selectedInternal, setSelectedInternal] = useState<ChatThreadSummary | null>(null)
  const selected = selectedInternal
  function setSelected(next: ChatThreadSummary | null) {
    setSelectedInternal(next)
    if (dockedDetail) onSelectedChange?.(next)
  }
  // "User just emptied the inbox via mark-read" intent. When true, the
  // auto-select-first effect below stays its hand so the inbox-zero
  // empty state can render. Cleared as soon as the user manually picks
  // a thread, switches filter/scope, or a fresh thread arrives. Roy
  // 2026-06-12: marking the current ticket read should advance to the
  // next unread, and when there's no next unread leave the right pane
  // empty with an "all caught up" message.
  const inboxZeroRef = useRef(false)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  // Filter strip state - All / Unread / Read. Persisted per scope so the
  // Client Inbox and Team Inbox keep their own preferences (an AM might
  // want Unread by default for client chat but All for team chat).
  const [filter, setFilter] = usePersistedChatFilter(scope)

  const threadsQuery = useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["inbox-threads", scope],
    queryFn: () =>
      fetch(`/api/inbox/threads?scope=${scope}`).then((r) => r.json()),
    // Poll every 5s while the inbox tab is in focus so newly-arrived
    // messages bubble in without a manual refresh. React Query auto-pauses
    // refetching when the window blurs (refetchIntervalInBackground=false
    // is the default), so this isn't a constant network hammer.
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
  })

  const threads = useMemo(
    () => threadsQuery.data?.threads ?? [],
    [threadsQuery.data?.threads],
  )

  // Tab counts come off the unfiltered set - flipping to "Unread" shouldn't
  // make the Unread tab claim "0 unread" when there are still unread items
  // hiding behind the filter.
  // Visibility helpers shared by the tab counts and the filter
  // memo so the badges always match what the list actually renders.
  // "Active" = the default Inbox-zero view: not archived, snooze
  // already passed (or never set), and not claimed in Trengo (the
  // server already drops claimed rows).
  const nowMs = Date.now()
  function isSnoozedThread(t: ChatThreadSummary): boolean {
    if (!t.snoozedUntil) return false
    return new Date(t.snoozedUntil).getTime() > nowMs
  }
  function isActiveThread(t: ChatThreadSummary): boolean {
    return !t.isArchived && !isSnoozedThread(t)
  }

  const tabCounts = useMemo(() => {
    let unread = 0
    let snoozed = 0
    let archived = 0
    let active = 0
    for (const t of threads) {
      const snoozedNow = isSnoozedThread(t)
      if (t.isArchived) archived += 1
      else if (snoozedNow) snoozed += 1
      else {
        active += 1
        if (t.unreadCount > 0) unread += 1
      }
    }
    return { all: active, unread, snoozed, archived }
    // nowMs is only sampled once per render so the count doesn't
    // jitter mid-paint; reactive over `threads`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads])

  const filteredThreads = useMemo(() => {
    let base: ChatThreadSummary[]
    switch (filter) {
      case "snoozed":
        base = threads.filter((t) => !t.isArchived && isSnoozedThread(t))
        break
      case "archived":
        base = threads.filter((t) => t.isArchived)
        break
      case "all":
        base = threads.filter(isActiveThread)
        break
      case "unread":
      default:
        base = threads.filter((t) => isActiveThread(t) && t.unreadCount > 0)
        break
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return base
    // AND semantics across whitespace-separated words, same as the
    // inbox-level filterByQuery - keeps a single search field feeling
    // consistent across every tab. Matches contact + client name +
    // latest preview. Older messages aren't loaded for the summary, so
    // a hit inside an earlier message still requires opening the thread.
    const words = q.split(/\s+/).filter(Boolean)
    return base.filter((th) => {
      const haystack = [
        th.primaryName ?? "",
        th.clientName ?? "",
        th.latestPreview ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return words.every((w) => haystack.includes(w))
    })
  }, [threads, filter, searchQuery])

  // Drop selections for threads that are no longer in the visible list (filter
  // change, claimed in Trengo, etc.) so the bulk bar count stays honest.
  useEffect(() => {
    if (selectedKeys.size === 0) return
    const visible = new Set(filteredThreads.map((t) => t.threadKey))
    setSelectedKeys((prev) => {
      let dirty = false
      const next = new Set<string>()
      for (const k of prev) {
        if (visible.has(k)) next.add(k)
        else dirty = true
      }
      return dirty ? next : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredThreads])

  function toggleSelect(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selectAll() {
    setSelectedKeys(new Set(filteredThreads.map((t) => t.threadKey)))
  }

  function clearSelection() {
    setSelectedKeys(new Set())
  }

  /** Walk the current thread list in display order (newest first) and
   *  return the first thread that is still unread - skipping the one
   *  we just marked. Used to auto-advance the open conversation after
   *  the user hits the green ✓ mark-read button. */
  function pickNextUnread(skipKey: string): ChatThreadSummary | null {
    for (const t of threads) {
      if (t.threadKey === skipKey) continue
      if (t.unreadCount > 0) return t
    }
    return null
  }

  /** Optimistically apply a triage action to a thread and PATCH the
   *  server. On failure we invalidate so the server's authoritative
   *  state wins. Roy 2026-06-12: mark-read advances to the next
   *  unread; 2026-06-13: star / archive / snooze are first-class
   *  here too so the hover quick-actions feel instant. */
  function markThread(
    thread: ChatThreadSummary,
    action: MarkAction,
    payload?: { until?: string | null },
  ) {
    queryClient.setQueryData<{ threads: ChatThreadSummary[] }>(
      ["inbox-threads", scope],
      (prev) => {
        if (!prev) return prev
        return {
          threads: prev.threads.map((t) => {
            if (t.threadKey !== thread.threadKey) return t
            switch (action) {
              case "mark_read":
                return { ...t, unreadCount: 0 }
              case "mark_unread":
                return { ...t, unreadCount: Math.max(t.unreadCount, 1) }
              case "star":
                return { ...t, isStarred: true }
              case "unstar":
                return { ...t, isStarred: false }
              case "archive":
                return { ...t, isArchived: true }
              case "unarchive":
                return { ...t, isArchived: false }
              case "snooze":
                return { ...t, snoozedUntil: payload?.until ?? t.snoozedUntil }
              case "unsnooze":
                return { ...t, snoozedUntil: null }
              default:
                return t
            }
          }),
        }
      },
    )

    // Advance when the user closes the OPEN ticket via mark-read OR
    // archive - both move the thread out of the Active view so the
    // chat pane should automatically reach for the next unread.
    if (
      (action === "mark_read" || action === "archive") &&
      selected?.threadKey === thread.threadKey
    ) {
      const next = pickNextUnread(thread.threadKey)
      if (next) {
        inboxZeroRef.current = false
        setSelected(next)
      } else {
        inboxZeroRef.current = true
        setSelected(null)
      }
    }
    fetch(`/api/inbox/threads/${encodeURIComponent(thread.threadKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, until: payload?.until }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${action} failed (${res.status})`)
        queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
        queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      })
      .catch((e) => {
        console.error("Failed to update thread triage state", e)
        queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
      })
  }

  function bulkMark(action: MarkAction) {
    const items = filteredThreads.filter((t) => selectedKeys.has(t.threadKey))
    clearSelection()
    for (const t of items) markThread(t, action)
  }

  /**
   * Select a thread without marking it read. Roy 2026-06-11 round 3:
   * "Ik wil niet dat als ik een message read, dat die gelijk van unread
   * naar all conversations gaat." A row stays Unread until the user
   * either replies (handled in `refresh()` callback below) or explicitly
   * marks it read via the per-row checkbox.
   */
  function selectAndMarkRead(thread: ChatThreadSummary) {
    // Picking a row clears the inbox-zero intent - the user is back in
    // an active conversation and the auto-select hands-off behaviour
    // should resume on the next mount.
    inboxZeroRef.current = false
    setSelected(thread)
  }

  // Filter or scope change resets the inbox-zero intent - flipping to
  // All conversations after emptying Unread should land on the first
  // available thread, not the celebratory empty state.
  useEffect(() => {
    inboxZeroRef.current = false
  }, [filter, scope])

  // Auto-select the first thread when the list loads, so the empty right
  // pane doesn't sit there waiting for a click. Selection only - no
  // mark-as-read side effect anymore (see comment on selectAndMarkRead).
  // Skip in docked mode - the parent owns whether/when to open a thread.
  // Skip when the user has just cleared via mark-read (inbox zero state).
  useEffect(() => {
    if (dockedDetail) return
    if (inboxZeroRef.current) return
    if (!selected && threads.length > 0) setSelected(threads[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, threads, dockedDetail])

  // Re-select the same thread by key when threads refresh, so the selection
  // survives query invalidations. Same inbox-zero gate as above.
  useEffect(() => {
    if (inboxZeroRef.current) return
    if (selected && !threads.some((t) => t.threadKey === selected.threadKey)) {
      setSelected(threads[0] ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, threads])

  // Controlled-mode sync: when the parent changes `selectedThreadKey` (e.g. a
  // NowChatCard click sets the active thread before switching tabs), align
  // ChatPane's internal `selected` to match so the right thread shows as
  // active in the list. Null clears.
  useEffect(() => {
    if (!dockedDetail) return
    if (selectedThreadKey == null) {
      if (selected) setSelectedInternal(null)
      return
    }
    if (selected?.threadKey === selectedThreadKey) return
    const match = threads.find((t) => t.threadKey === selectedThreadKey)
    if (match) setSelectedInternal(match)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dockedDetail, selectedThreadKey, threads])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
    if (selected) {
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", selected.threadKey] })
      // Replying counts as "I've dealt with this" - flip the thread to
      // read so it leaves the Unread filter. Skip when already read so
      // we don't fire pointless PATCHes. Roy 2026-06-11 round 3.
      if (selected.unreadCount > 0) {
        markThread(selected, "mark_read")
      }
    }
  }

  const filterTabs: TopTab<ChatFilter>[] = [
    // Roy 2026-06-09: Unread on the LEFT (anchor / default), All on the
    // RIGHT (scan-everything fallback). 2026-06-13: Snoozed + Archived
    // join the strip so the triage actions on the row have a discoverable
    // home for what they hide.
    { id: "unread", label: t("inbox.chat.filter.unread", locale), icon: Mail, count: tabCounts.unread },
    { id: "all", label: t("inbox.chat.filter.all", locale), icon: LayoutList, count: tabCounts.all },
    { id: "snoozed", label: t("inbox.chat.filter.snoozed", locale), icon: Clock3, count: tabCounts.snoozed },
    { id: "archived", label: t("inbox.chat.filter.archived", locale), icon: Inbox, count: tabCounts.archived },
  ]

  return (
    <div className="space-y-4">
      <TopTabs<ChatFilter> tabs={filterTabs} value={filter} onChange={setFilter} />

      {underTabsSlot}

      <TrengoIdentityBanner />

      {/* Sized to fill the viewport below the page chrome instead of being
          locked to 640px - keeps the thread list and chat pane equal in
          height regardless of screen size, and prevents the prior "sidebar
          stops halfway down the page" UX bug. The 280px subtraction covers
          page header + main tabs + filter tabs + spacing.
          In docked-detail mode the right column is dropped entirely - the
          thread list takes the full width here, and the selected thread's
          ThreadView is rendered by the parent (inbox-view) inside its
          page-level slide-in aside. Same UX as Tasks/Updates/Now: list on
          the left, slide-in detail on the right, no inline column shifts. */}
      <div
        className={cn(
          "grid grid-cols-1 h-[calc(100vh*var(--ui-unzoom)_-_280px)] min-h-[500px]",
          // Non-docked: list 30% / chat 70% (Roy 2026-06-12). Previously
          // 50/50 which left the actual conversation cramped on email
          // threads with long quoted history. fr units stay clean once
          // gap-4 is in play (% units would overflow by the gap).
          dockedDetail ? "" : "lg:grid-cols-[3fr_7fr] gap-4",
        )}
      >
        <ThreadList
          threads={filteredThreads}
          loading={threadsQuery.isLoading}
          selectedKey={selected?.threadKey ?? null}
          selectedKeys={selectedKeys}
          filter={filter}
          onSelect={selectAndMarkRead}
          onToggleSelect={toggleSelect}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onMarkThread={markThread}
          scope={scope}
        />
        {!dockedDetail && (
          <ThreadView
            thread={selected}
            onReplied={refresh}
            users={users}
            onMakeTaskFromMessage={onMakeTaskFromMessage}
            onMarkThread={markThread}
            inboxZero={!selected && inboxZeroRef.current}
          />
        )}
      </div>

      {selectedKeys.size > 0 && (
        <ChatBulkActionBar
          count={selectedKeys.size}
          onClear={clearSelection}
          onMark={bulkMark}
        />
      )}
    </div>
  )
}

// --- Thread list (left pane) ---------------------------------------------

function ThreadList({
  threads,
  loading,
  selectedKey,
  selectedKeys,
  filter,
  onSelect,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onMarkThread,
  scope,
  mergedRightEdge,
}: {
  threads: ChatThreadSummary[]
  loading: boolean
  selectedKey: string | null
  selectedKeys: Set<string>
  filter: ChatFilter
  onSelect: (thread: ChatThreadSummary) => void
  onToggleSelect: (key: string) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onMarkThread: (thread: ChatThreadSummary, action: MarkAction, payload?: { until?: string | null }) => void
  scope: ChatScope
  /** When true, the right edge of this panel butts up against the
   *  ThreadView panel - drop the right border-radius so the two cards
   *  read as one continuous surface. */
  mergedRightEdge?: boolean
}) {
  // Wrapper classes shared between loading / empty / loaded states so the
  // outer card is consistent - only its border-radius changes in merged
  // mode. We avoid passing this through the prop sidewalk for every
  // visual state.
  const wrapperClass = mergedRightEdge ? "rounded-l-xl rounded-r-none" : "rounded-xl"
  const locale = useLocale()
  if (loading) {
    return (
      <div className={cn("border border-border bg-card shadow-sm p-2", wrapperClass)}>
        <InboxRowSkeletonList count={7} />
      </div>
    )
  }

  if (threads.length === 0) {
    // Filtered-empty messaging shifts based on which tab the user is on so
    // "0 unread" doesn't look like a sync failure when they're on Unread mode.
    const empty =
      filter === "unread"
        ? scope === "external"
          ? t("inbox.chat.empty.no_unread_client", locale)
          : t("inbox.chat.empty.no_unread_team", locale)
        : scope === "external"
          ? t("inbox.chat.empty.no_client_yet", locale)
          : t("inbox.chat.empty.no_team_yet", locale)
    const sub =
      filter === "all"
        ? scope === "external"
          ? t("inbox.chat.empty.sub_trengo", locale)
          : t("inbox.chat.empty.sub_slack", locale)
        : t("inbox.chat.empty.sub_switch", locale)
    return (
      <div className={cn("border border-dashed border-border bg-card/40 flex flex-col items-center justify-center py-12 px-4 text-center", wrapperClass)}>
        <Inbox className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">{empty}</p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">{sub}</p>
      </div>
    )
  }

  const allSelected = selectedKeys.size > 0 && selectedKeys.size === threads.length
  const anySelected = selectedKeys.size > 0
  const selectAllState: "none" | "some" | "all" = allSelected
    ? "all"
    : anySelected
      ? "some"
      : "none"

  return (
    <div className={cn("border border-border bg-card shadow-sm flex flex-col overflow-hidden", wrapperClass)}>
      {/* Sticky header: shows total + a select-all checkbox. When 1+ threads
          are selected the header shifts to a "X selected · Clear" strip so
          the bulk affordance is discoverable without scrolling to the
          floating bar. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <SelectAllCheckbox
            state={selectAllState}
            onClick={() => {
              if (selectAllState === "all") onClearSelection()
              else onSelectAll()
            }}
          />
          {anySelected ? (
            <span className="text-xs font-medium tabular-nums">
              {selectedKeys.size} {t("inbox.chat.selected_suffix", locale)}
            </span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {threads.length} {threads.length === 1 ? t("inbox.chat.conversation", locale) : t("inbox.chat.conversations", locale)}
            </span>
          )}
        </div>
        {anySelected && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
          >
            {t("inbox.chat.clear", locale)}
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {threads.map((thread) => {
          const isSelected = thread.threadKey === selectedKey
          const isChecked = selectedKeys.has(thread.threadKey)
          const isUnread = thread.unreadCount > 0
          return (
            <ThreadRow
              key={thread.threadKey}
              thread={thread}
              isActive={isSelected}
              isChecked={isChecked}
              isUnread={isUnread}
              onSelect={() => onSelect(thread)}
              onToggleCheck={() => onToggleSelect(thread.threadKey)}
              onMark={(action, payload) => onMarkThread(thread, action, payload)}
            />
          )
        })}
      </div>
    </div>
  )
}

function ThreadRow({
  thread,
  isActive,
  isChecked,
  isUnread,
  onSelect,
  onToggleCheck,
  onMark,
}: {
  thread: ChatThreadSummary
  isActive: boolean
  isChecked: boolean
  isUnread: boolean
  onSelect: () => void
  onToggleCheck: () => void
  onMark: (action: MarkAction, payload?: { until?: string | null }) => void
}) {
  const locale = useLocale()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "group relative w-full text-left px-3.5 py-3 transition-colors cursor-pointer",
        "hover:bg-muted/40",
        isActive && "bg-primary/5 hover:bg-primary/10",
        isChecked && "bg-primary/[0.07]",
      )}
    >
      {/* Left edge unread bar - same convention email clients use. Doesn't
          shift the row content; sits flush against the divider. */}
      {isUnread && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary" />
      )}
      <div className="flex items-start gap-2.5">
        {/* Bulk-select checkbox. Hover-revealed when nothing is selected,
            pinned visible while there's an active selection so the AM can
            see the rest of the column at a glance. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={isChecked}
          onClick={(e) => {
            e.stopPropagation()
            onToggleCheck()
          }}
          className={cn(
            "h-4 w-4 shrink-0 rounded border-2 inline-flex items-center justify-center mt-0.5 transition-all",
            isChecked
              ? "bg-primary border-primary text-primary-foreground"
              : "border-muted-foreground/30 hover:border-foreground hover:bg-muted/60",
            isChecked ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title={isChecked ? t("inbox.chat.deselect", locale) : t("inbox.chat.select_bulk", locale)}
        >
          {isChecked && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
        </button>

        {/* Row content branches by channel kind. Email rows lead with
            the SUBJECT (Roy 2026-06-13: "subject is wat de mail is, niet
            de body-preview die voor marketing-mails toch alleen Google
            Fonts CSS is"); WhatsApp/Slack rows keep the sender-name +
            body-preview format that makes sense for short chat
            messages. */}
        {thread.channelKind === "email" ? (
          <EmailListRowBody thread={thread} isUnread={isUnread} />
        ) : (
          <ChatListRowBody thread={thread} isUnread={isUnread} />
        )}

        {/* Hover quick-actions on the right edge. Star stays pinned
            when active so the AM sees which rows are starred at a
            glance; the rest are hidden until hover so the row stays
            calm. Each action stops propagation so clicking doesn't
            select the row. */}
        <ThreadRowQuickActions
          thread={thread}
          isUnread={isUnread}
          onMark={onMark}
        />
      </div>
    </div>
  )
}

/**
 * Right-edge stack of triage buttons on each thread row. Star pinned
 * when active; mark-read / snooze / archive hover-revealed.
 * Roy 2026-06-13: AMs want to clear marketing mail without opening
 * each one — hover, click, gone.
 */
function ThreadRowQuickActions({
  thread,
  isUnread,
  onMark,
}: {
  thread: ChatThreadSummary
  isUnread: boolean
  onMark: (action: MarkAction, payload?: { until?: string | null }) => void
}) {
  const locale = useLocale()
  const isSnoozed =
    thread.snoozedUntil != null &&
    new Date(thread.snoozedUntil).getTime() > Date.now()

  // 8 hours from now is the default snooze. Picking "later vandaag" is
  // the dominant case for the marketing-mail / "deal with this after
  // lunch" pattern; explicit until-picker stays a follow-up.
  function snoozeLater() {
    const until = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    onMark("snooze", { until })
  }

  // Row-level read/unread is communicated by the purple left-edge bar
  // alone (Roy 2026-06-16: "het vinkje in de linkerbalk mag WEG, alleen
  // read/unread onderscheid via paarse balk"). The mark-read affordance
  // lives in the chat-pane header instead. Star / snooze / archive stay
  // as hover-revealed quick actions so the row remains scannable.
  return (
    <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
      <RowActionButton
        icon={
          <Star
            className={cn(
              "h-3.5 w-3.5",
              thread.isStarred ? "fill-amber-400 text-amber-400" : "",
            )}
          />
        }
        label={thread.isStarred ? t("inbox.chat.unstar", locale) : t("inbox.chat.star", locale)}
        onClick={(e) => {
          e.stopPropagation()
          onMark(thread.isStarred ? "unstar" : "star")
        }}
        alwaysVisible={thread.isStarred}
      />
      <RowActionButton
        icon={
          <Clock3
            className={cn(
              "h-3.5 w-3.5",
              isSnoozed ? "text-sky-600 dark:text-sky-400" : "",
            )}
          />
        }
        label={isSnoozed ? t("inbox.chat.snooze_remove", locale) : t("inbox.chat.snooze_8h", locale)}
        onClick={(e) => {
          e.stopPropagation()
          if (isSnoozed) onMark("unsnooze")
          else snoozeLater()
        }}
        alwaysVisible={isSnoozed}
      />
      <RowActionButton
        icon={<Archive className="h-3.5 w-3.5" />}
        label={thread.isArchived ? t("inbox.chat.back_to_inbox", locale) : t("inbox.chat.archive", locale)}
        onClick={(e) => {
          e.stopPropagation()
          onMark(thread.isArchived ? "unarchive" : "archive")
        }}
        alwaysVisible={false}
      />
    </div>
  )
}

function RowActionButton({
  icon,
  label,
  onClick,
  alwaysVisible,
}: {
  icon: React.ReactNode
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  alwaysVisible: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-all",
        alwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      {icon}
    </button>
  )
}

/**
 * Email-thread row body. Layout:
 *   [SourceIcon] [Sender name · time]                              [unread chip]
 *   [Subject in bold / larger]
 *   [client name OR latest-preview]
 *
 * Subject is the dominant signal so it sits on its own line at a
 * slightly heavier weight than the rest of the row. Unread rows get
 * `font-bold` on the subject + `text-foreground` on the sender so
 * they stand out against the read tail of the inbox.
 */
function EmailListRowBody({
  thread,
  isUnread,
}: {
  thread: ChatThreadSummary
  isUnread: boolean
}) {
  const locale = useLocale()
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <SourceIcon thread={thread} />
          <span
            className={cn(
              "text-xs truncate",
              isUnread ? "text-foreground font-semibold" : "text-muted-foreground/80",
            )}
          >
            {thread.primaryName}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50 shrink-0">
            · {fmtRelative(thread.latestAt)}
          </span>
        </div>
        {/* Only show a count chip when there are multiple unread messages —
            single unread is already communicated by bold + purple bar, so
            a "1" badge is just noise. Muted gray instead of bright purple
            (Roy 2026-06-16). */}
        {thread.unreadCount > 1 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-muted text-muted-foreground text-[10px] font-medium tabular-nums shrink-0">
            {thread.unreadCount}
          </span>
        )}
      </div>
      <p
        className={cn(
          "text-[13px] leading-snug truncate",
          isUnread
            ? "font-bold text-foreground"
            : "font-medium text-foreground/85",
        )}
      >
        {thread.latestSubject || thread.latestPreview || (
          <span className="italic text-muted-foreground/60">{t("inbox.chat.no_subject", locale)}</span>
        )}
      </p>
      {thread.clientName && (
        <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
          {thread.clientName}
        </p>
      )}
    </div>
  )
}

/**
 * WhatsApp / Slack row body. Sender name leads (short messages don't
 * need a subject line) followed by a one-line body preview - the same
 * format the rest of the inbox already uses for chat threads.
 */
function ChatListRowBody({
  thread,
  isUnread,
}: {
  thread: ChatThreadSummary
  isUnread: boolean
}) {
  const locale = useLocale()
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <SourceIcon thread={thread} />
          <span
            className={cn(
              "text-sm truncate",
              isUnread ? "font-bold text-foreground" : "font-medium text-foreground/85",
            )}
          >
            {thread.primaryName}
          </span>
        </div>
        {/* Only show a count chip when there are multiple unread messages —
            single unread is already communicated by bold + purple bar, so
            a "1" badge is just noise. Muted gray instead of bright purple
            (Roy 2026-06-16). */}
        {thread.unreadCount > 1 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-muted text-muted-foreground text-[10px] font-medium tabular-nums">
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
          isUnread ? "text-foreground/85" : "text-muted-foreground/80",
        )}
      >
        {thread.latestPreview || <span className="italic">{t("inbox.chat.no_preview", locale)}</span>}
      </p>
      <p className="font-mono text-[10px] tabular-nums text-muted-foreground/40 mt-0.5">
        {fmtRelative(thread.latestAt)}
      </p>
    </div>
  )
}

/** Tri-state header checkbox. "some" shows a half-fill so the user knows
 *  not every visible thread is selected, mirroring the Updates pattern. */
function SelectAllCheckbox({
  state,
  onClick,
}: {
  state: "none" | "some" | "all"
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === "all" ? true : state === "some" ? "mixed" : false}
      onClick={onClick}
      className={cn(
        "h-4 w-4 shrink-0 rounded border-2 inline-flex items-center justify-center transition-all",
        state === "all"
          ? "bg-primary border-primary text-primary-foreground"
          : state === "some"
            ? "bg-primary/30 border-primary"
            : "border-muted-foreground/40 hover:border-foreground",
      )}
      title={
        state === "all"
          ? "Deselect all"
          : state === "some"
            ? "Select all"
            : "Select all"
      }
    >
      {state === "all" && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      {state === "some" && (
        <span className="block h-0.5 w-2 bg-primary-foreground rounded-sm" />
      )}
    </button>
  )
}

/**
 * Floating bulk action bar - appears when 1+ threads are selected. Same
 * shape as the Updates BulkActionBar so the inbox-wide pattern stays
 * consistent: pill-shaped, fixed bottom-center, single-purpose buttons with
 * tinted hover states.
 */
function ChatBulkActionBar({
  count,
  onClear,
  onMark,
}: {
  count: number
  onClear: () => void
  onMark: (action: MarkAction) => void
}) {
  const locale = useLocale()
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-xl border border-border bg-popover shadow-lg px-2 py-1.5">
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} {t("inbox.chat.selected_suffix", locale)}
      </span>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      {/* h-9 rounded-md chip chrome per the Hub button rules (CLAUDE.md): a
          floating bulk bar keeps its pill shell but its actions match the rest
          of the Hub. */}
      <button
        type="button"
        onClick={() => onMark("mark_read")}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        title={t("inbox.chat.mark_read_title", locale)}
      >
        <CheckCheck className="h-3.5 w-3.5" />
        {t("inbox.chat.mark_read", locale)}
      </button>
      <button
        type="button"
        onClick={() => onMark("mark_unread")}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
        title={t("inbox.chat.mark_unread_title", locale)}
      >
        <MailOpen className="h-3.5 w-3.5" />
        {t("inbox.chat.mark_unread", locale)}
      </button>
      <span className="h-5 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={t("inbox.chat.clear_selection", locale)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// --- Thread view (right pane) --------------------------------------------

/** Pedro-draft prefill button - fetches the client's current `client_pedro`
 *  insight on click and inserts the `conclusion` into the reply textarea.
 *  Appends to the existing draft when the textarea isn't empty, so the AM
 *  can keep what they already wrote.
 *
 *  Renders only for client-facing replies (skipped for internal notes and
 *  when the thread has no linked client). When Pedro has nothing for this
 *  client the button stays present but disabled with a tooltip - the
 *  absence is informative ("Pedro has no draft yet"), not a UI gap. */
function PedroDraftButton({
  clientId,
  onInsert,
  disabled,
}: {
  clientId: string
  onInsert: (text: string) => void
  disabled?: boolean
}) {
  const locale = useLocale()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/pedro-insights`)
      if (!res.ok) throw new Error("Pedro draft niet beschikbaar")
      const data = (await res.json()) as {
        insights?: { client_pedro?: { body?: string } }
      }
      const raw = data.insights?.client_pedro?.body
      if (!raw) {
        setError("Pedro heeft nog geen concept voor deze klant")
        return
      }
      let conclusion: string | null = null
      try {
        const parsed = JSON.parse(raw) as { conclusion?: string }
        conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion.trim() : null
      } catch {
        // Body wasn't JSON - fall back to using the raw text.
        conclusion = raw.trim()
      }
      if (!conclusion) {
        setError("Geen bruikbaar concept gevonden")
        return
      }
      onInsert(conclusion)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kon Pedro draft niet laden")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={load}
        disabled={disabled || loading}
        title={t("inbox.chat.pedro_draft_title", locale)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium",
          "border border-border bg-card text-muted-foreground",
          "hover:bg-muted hover:text-foreground transition-colors",
          "disabled:opacity-50 disabled:cursor-not-allowed",
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        {t("inbox.chat.pedro_draft", locale)}
      </button>
      {error && (
        <span className="text-[11px] text-muted-foreground/70">{error}</span>
      )}
    </div>
  )
}

/** Per-note mention state: which internal notes (by Trengo message id) carry a
 *  mention for me, whether each is ticked off, and the toggle. Drives the
 *  on-note "done" checkbox in the Mentioned view. */
type NoteMentions = { done: Record<string, boolean>; toggle: (noteMsgId: string) => void }

/** Renders the selected thread's messages + composer in a self-contained
 *  card. Pass `thread=null` to show the "Select a conversation" placeholder.
 *  `mergedLeftEdge` drops the left border-radius so this panel can sit
 *  flush against the ThreadList on the 50/50 docked-detail layout. */
export function ThreadView({
  thread,
  onReplied,
  onPickup,
  users,
  onMakeTaskFromMessage,
  onMarkThread,
  inboxZero,
  mergedLeftEdge,
  mentioned,
  noteMentions,
  onResolvedState,
}: {
  thread: ChatThreadSummary | null
  onReplied: () => void
  /** Pick up the ticket (New -> Opgepakt) when the composer is opened. */
  onPickup?: () => void
  users?: InboxUser[]
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  /** Mark-read/unread toggle. Lives on the open-conversation header
   *  (Roy 2026-06-12) instead of the list-row affordance it used to be -
   *  the action lives where the user is actually reading. */
  onMarkThread?: (thread: ChatThreadSummary, action: MarkAction, payload?: { until?: string | null }) => void
  /** True when the user just cleared the inbox via mark-read and no
   *  more unread threads remain - swaps the neutral "Select a
   *  conversation" placeholder for a celebratory all-caught-up state. */
  inboxZero?: boolean
  mergedLeftEdge?: boolean
  /** Opened from the Mentioned view - load the FULL conversation (bypass the
   *  channel-subscription filter) so the user sees every message + note around
   *  the mention, even on a line they don't subscribe to. */
  mentioned?: boolean
  /** Per-note mention state for the on-note "done" checkbox (Mentioned view). */
  noteMentions?: NoteMentions
  /** Reports the freshly-loaded ticket triage state so the header can show the
   *  accurate Open/Assigned/Closed even for stub (unsubscribed-channel) rows. */
  onResolvedState?: (state: { isArchived: boolean; isAssigned: boolean }) => void
}) {
  const locale = useLocale()
  const wrapperRadius = mergedLeftEdge ? "rounded-r-xl rounded-l-none border-l-0" : "rounded-xl"
  if (!thread) {
    if (inboxZero) {
      return (
        <div className={cn("h-full border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-3 text-center px-6", wrapperRadius)}>
          <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCheck className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("inbox.chat.caught_up_title", locale)}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{t("inbox.chat.caught_up_sub", locale)}</p>
          </div>
        </div>
      )
    }
    return (
      <div className={cn("h-full border border-border bg-card shadow-sm flex items-center justify-center text-sm text-muted-foreground/60", wrapperRadius)}>
        {t("inbox.chat.select_conversation", locale)}
      </div>
    )
  }

  // Resilience: a render error in the thread (bad message payload, etc.) must
  // not white-screen the whole inbox. Reset when the open thread changes so
  // navigating away from a broken thread recovers. Roy 2026-07-20.
  return (
    <ErrorBoundary label="this conversation" resetKey={thread.threadKey}>
      <ThreadMessages thread={thread} onReplied={onReplied} onPickup={onPickup} users={users} onMakeTaskFromMessage={onMakeTaskFromMessage} onMarkThread={onMarkThread} mergedLeftEdge={mergedLeftEdge} mentioned={mentioned} noteMentions={noteMentions} onResolvedState={onResolvedState} />
    </ErrorBoundary>
  )
}

type ComposerMode = "reply" | "internal"

/** WhatsApp Business template surfaced in the picker. Mirrors the subset of
 *  Trengo's `/wa_templates` response we care about. `message` carries the
 *  source body with `{{1}}{{2}}…` placeholders the AM fills in. */
type WaTemplate = {
  id: number
  title: string
  slug: string
  message: string
  language: string
  channel_id: number
  status: string
  components: Array<{ id: number; type: string; sub_type: string | null; value: string | null }>
}

/** WhatsApp composer mode. Inside the 24h window the AM picks; outside the
 *  window we force "template" because Meta forbids free-text outbound. */
type WaMode = "default" | "template"

/** Attachment that's been uploaded to Trengo's draft store but not yet sent.
 *  Lifecycle: file picked → uploaded → chip shown → included in send →
 *  cleared on success. Mirrors the subset of Trengo's response we actually
 *  need in the UI (id for sending, full_url + is_image for preview, names
 *  for display). */
type PendingAttachment = {
  id: number
  clientName: string
  fullUrl: string
  mimeType: string | null
  isImage: boolean
}

function ThreadMessages({
  thread,
  onReplied,
  onPickup,
  users,
  onMakeTaskFromMessage,
  onMarkThread,
  mergedLeftEdge,
  mentioned,
  noteMentions,
  onResolvedState,
}: {
  thread: ChatThreadSummary
  onReplied: () => void
  onPickup?: () => void
  users?: InboxUser[]
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  onMarkThread?: (thread: ChatThreadSummary, action: MarkAction, payload?: { until?: string | null }) => void
  mergedLeftEdge?: boolean
  mentioned?: boolean
  noteMentions?: NoteMentions
  onResolvedState?: (state: { isArchived: boolean; isAssigned: boolean }) => void
}) {
  const queryClient = useQueryClient()
  const locale = useLocale()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // The single scroll viewport that holds BOTH the messages and the composer
  // (Trengo-style: the composer is inline at the end of the stream, not a fixed
  // footer, so scrolling up reveals history and the composer scrolls away).
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [reply, setReply] = useState("")
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply")
  // Email composer collapses by default per thread (Roy 2026-06-12).
  // Email threads carry long quoted history + signature blocks - having
  // the composer always-open eats the conversation's vertical space and
  // makes scrolling the actual messages painful. WhatsApp / Slack keep
  // the composer always-open since their messages are short and the
  // textarea is the main affordance. Reset to closed on every thread
  // switch via the effect below.
  const [emailComposerOpen, setEmailComposerOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState<"trengo" | "slack" | null>(null)
  // Attachments uploaded for this draft. Each entry holds the Trengo
  // attachment id needed at send-time plus the metadata needed to render a
  // preview chip. Cleared on send success and on thread switch.
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  // Hub user display names → @-mentions in message bodies render blue.
  const mentionNames = useMemo(
    () =>
      (users ?? [])
        .map((u) => u.name)
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0),
    [users],
  )
  // WhatsApp composer state: only active when channelKind === "whatsapp".
  // Stored as user PREFERENCE - initial default is "default" (free text).
  // Window-closed → render-time override forces Template (Meta requirement);
  // never written back into state, so opening the window again snaps back
  // to whatever the user actually picked. Per Roy: "Als het Conversation
  // Window open is, moet die altijd standaard op default staan."
  const [userWaMode, setUserWaMode] = useState<WaMode>("default")
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)
  const [templateParams, setTemplateParams] = useState<string[]>([])
  // Email composer state - only active when channelKind === "email". Lifted
  // here (rather than inside EmailComposer) so sendReply can grab everything
  // on submit without an editor ref dance.
  const [emailSubject, setEmailSubject] = useState("")
  const [emailCc, setEmailCc] = useState<string[]>([])
  const [emailBcc, setEmailBcc] = useState<string[]>([])
  const [emailHtml, setEmailHtml] = useState("")
  // Raw channel signature HTML, reported up by the EmailComposer. Kept out of
  // `emailHtml` (which stays message-only so the send gate reads the typed
  // message) and appended to the outgoing mail in sendReply. Roy 2026-07-27.
  const [emailSignature, setEmailSignature] = useState<string | null>(null)
  // Editable From (which email channel we send on) + To recipients + compose
  // mode. Default From = the thread's channel; default To = the thread contact.
  // Changing From/To, or forwarding, sends as a NEW email (Trengo can't move a
  // reply to another channel/recipient). Roy 2026-07-28.
  const [emailFromChannelId, setEmailFromChannelId] = useState<number | null>(null)
  const [emailTo, setEmailTo] = useState<string[]>([])
  const [emailMode, setEmailMode] = useState<"reply" | "forward">("reply")
  // Bumped to force the (uncontrolled TipTap) EmailComposer to remount so a
  // forward's pre-filled quoted body actually lands in the editor.
  const [emailComposeNonce, setEmailComposeNonce] = useState(0)
  // The AM's selectable outbound email channels for the From dropdown.
  const emailChannelsQuery = useQuery<{ channels: Array<{ id: number; type: string; name: string }> }>({
    queryKey: ["trengo-email-channels"],
    queryFn: () => fetch("/api/integrations/trengo/channels").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  })
  const emailChannels = useMemo(
    () =>
      (emailChannelsQuery.data?.channels ?? [])
        .filter((c) => c.type === "Email")
        .map((c) => ({ id: c.id, name: c.name })),
    [emailChannelsQuery.data],
  )
  // @-mention picker state (only active in internal-note mode).
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionHighlight, setMentionHighlight] = useState(0)

  const messagesQuery = useQuery<{
    messages: ChatMessage[]
    state?: { isArchived: boolean; isAssigned: boolean }
  }>({
    queryKey: ["inbox-thread", thread.threadKey, mentioned ? "mentioned" : "normal"],
    queryFn: () =>
      fetch(
        `/api/inbox/threads/${encodeURIComponent(thread.threadKey)}${mentioned ? "?mentioned=1" : ""}`,
      ).then((r) => r.json()),
    // Mirror the thread-list polling cadence so an open thread also picks up
    // newly-delivered Trengo messages without needing a manual refresh.
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
  })
  // Report the freshly-loaded ticket triage state up so the header shows the
  // right Open/Assigned/Closed even when the row came from a stub (a mention on
  // a channel we don't subscribe to). Roy 2026-07-16.
  const resolvedState = messagesQuery.data?.state
  useEffect(() => {
    if (resolvedState) onResolvedState?.(resolvedState)
  }, [resolvedState?.isArchived, resolvedState?.isAssigned, onResolvedState])

  const messages = useMemo(
    () => messagesQuery.data?.messages ?? [],
    [messagesQuery.data?.messages],
  )

  // Reset the editable From/To/mode whenever the thread switches: From back to
  // the thread's own channel, To cleared (re-seeded below), mode back to reply.
  useEffect(() => {
    setEmailFromChannelId(thread.trengoChannelId ?? null)
    setEmailTo([])
    setEmailMode("reply")
  }, [thread.threadKey, thread.trengoChannelId])

  // The thread contact's email = the most recent inbound email's From address.
  // Drives the default To + the "did the AM change the recipient?" check.
  const defaultContactEmail = useMemo(
    () =>
      [...messages].reverse().find((m) => m.authorKind !== "rl_team" && m.emailFromAddress)
        ?.emailFromAddress ?? null,
    [messages],
  )

  // Seed the default To once messages load. Reply mode only, and only while To
  // is still empty for this thread, so we never stomp a manual edit or a
  // forward's deliberately-cleared recipient. Roy 2026-07-28.
  const emailToSeededRef = useRef<string | null>(null)
  useEffect(() => {
    if (emailMode !== "reply") return
    if (emailToSeededRef.current === thread.threadKey) return
    if (defaultContactEmail) {
      setEmailTo([defaultContactEmail])
      emailToSeededRef.current = thread.threadKey
    }
  }, [defaultContactEmail, emailMode, thread.threadKey])

  // Stick-to-bottom: keep the stream pinned to the latest message (+ inline
  // composer) so opening a thread lands you on the last email, not halfway up.
  // Email cards render in iframes whose height is measured ASYNC (on load +
  // image loads + a 4s poll), so a single scroll-on-open fires before the
  // iframe grows and ends up short. We instead re-pin whenever the content
  // height changes via a ResizeObserver — until the user deliberately scrolls
  // up. Roy 2026-07-28.
  const stickBottomRef = useRef(true)

  // Reset to "stick" on every thread switch.
  useEffect(() => {
    stickBottomRef.current = true
  }, [thread.threadKey])

  // Pin now, and keep pinning as the content grows (observe the scroll
  // container's children — observing the fixed-height viewport itself would
  // never fire on inner growth). Re-observes when the message set / composer
  // state changes.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pin = () => {
      if (stickBottomRef.current) el.scrollTop = el.scrollHeight
    }
    pin()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(pin)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [thread.threadKey, messages.length, emailComposerOpen])

  // Track whether the user is at the bottom: scrolling up releases the pin,
  // returning to the bottom re-arms it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  // In-memory per-thread draft cache. Keyed by threadKey, holds the slice
  // of composer state that should survive switching back and forth between
  // threads. Lives in a ref so updates don't re-render; this isn't
  // displayed state, just a stash. Cleared per-entry on send success.
  // Attachments are NOT persisted - the underlying Trengo draft attachment
  // ids are session-bound and we'd risk sending stale references; pasting
  // / re-attaching when returning to a thread is the right tradeoff.
  const draftsRef = useRef(
    new Map<
      string,
      {
        reply: string
        composerMode: ComposerMode
        userWaMode: WaMode
        selectedTemplateId: number | null
        templateParams: string[]
        emailSubject: string
        emailCc: string[]
        emailBcc: string[]
        emailHtml: string
      }
    >(),
  )
  const prevThreadKeyRef = useRef<string>(thread.threadKey)

  // Mirror current state into a ref so the thread-switch effect can save
  // the OLD thread's draft without depending on every state value (which
  // would cause the effect to fire on every keystroke).
  const stateSnapshotRef = useRef({
    reply,
    composerMode,
    userWaMode,
    selectedTemplateId,
    templateParams,
    emailSubject,
    emailCc,
    emailBcc,
    emailHtml,
  })
  stateSnapshotRef.current = {
    reply,
    composerMode,
    userWaMode,
    selectedTemplateId,
    templateParams,
    emailSubject,
    emailCc,
    emailBcc,
    emailHtml,
  }

  // Switch threads: save the previous thread's draft, restore the new one
  // (defaults if no entry). Transient state (errors, mentions, attachments,
  // upload progress) is always reset - those don't make sense to carry
  // across threads.
  useEffect(() => {
    const oldKey = prevThreadKeyRef.current
    const newKey = thread.threadKey
    if (oldKey !== newKey) {
      draftsRef.current.set(oldKey, { ...stateSnapshotRef.current })
    }
    const draft = draftsRef.current.get(newKey)
    setReply(draft?.reply ?? "")
    setComposerMode(draft?.composerMode ?? "reply")
    setUserWaMode(draft?.userWaMode ?? "default")
    setSelectedTemplateId(draft?.selectedTemplateId ?? null)
    setTemplateParams(draft?.templateParams ?? [])
    setEmailSubject(draft?.emailSubject ?? "")
    setEmailCc(draft?.emailCc ?? [])
    setEmailBcc(draft?.emailBcc ?? [])
    setEmailHtml(draft?.emailHtml ?? "")
    setSendError(null)
    setNeedsConnect(null)
    setMentionStart(null)
    setMentionQuery("")
    setAttachments([])
    setUploadError(null)
    setIsDragOver(false)
    // Collapse the email composer on every thread switch - "give me back
    // the room to read first" (Roy 2026-06-12). WhatsApp/Slack composer
    // state is governed elsewhere and isn't email-specific so it's left
    // alone here.
    setEmailComposerOpen(false)
    prevThreadKeyRef.current = newKey
  }, [thread.threadKey])

  // Internal-note mode is Trengo-only (Slack has no native internal-note
  // concept). Switching to a Slack thread auto-flips the composer back
  // to Reply so we don't show a disabled mode switch.
  useEffect(() => {
    if (thread.source !== "trengo" && composerMode !== "reply") {
      setComposerMode("reply")
    }
  }, [thread.source, composerMode])

  const replyable = thread.source === "trengo" || thread.source === "slack"
  const supportsInternalNote = thread.source === "trengo"
  const isInternal = composerMode === "internal"

  // Trengo workspace users for the @-mention picker. Loaded only in internal-
  // note mode. Picking one inserts `@Full Name`; the send path rewrites that to
  // the Trengo handle so it becomes a real Trengo mention (+ notification). Roy
  // 2026-07-16: "als ik @ doe wil ik trengo users kunnen inladen". Falls back
  // to Hub users if the Trengo list is unavailable.
  const trengoUsersQuery = useQuery<{
    users: Array<{ id: number; name: string | null; email: string | null }>
  }>({
    queryKey: ["inbox-trengo-users"],
    queryFn: () => fetch("/api/inbox/trengo-users").then((r) => r.json()),
    enabled: supportsInternalNote,
    staleTime: 5 * 60 * 1000,
  })
  const mentionSource: Array<{ id: string; name: string | null; email: string }> = (() => {
    const t = trengoUsersQuery.data?.users
    if (t && t.length > 0) {
      return t.map((u) => ({ id: `trengo:${u.id}`, name: u.name, email: u.email ?? "" }))
    }
    return (users ?? []).map((u) => ({ id: u.id, name: u.name, email: u.email }))
  })()

  // Filter the team list by the current @-mention query, excluding nobody
  // by default (the chat-pane doesn't know who the actor is in this scope).
  const mentionMatches = (() => {
    if (mentionStart == null) return []
    const q = mentionQuery.trim().toLowerCase()
    return mentionSource
      .filter((u) => {
        if (!q) return true
        const haystack = `${u.name ?? ""} ${u.email}`.toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, 8)
  })()

  // Resolved mentions in the current reply - exactly the set of users that
  // will receive an Update + push notification when the AM hits Send. Mirror
  // of the server-side fanOutMentionsForInternalNote regex + lookup so what
  // the AM sees here matches what actually gets fanned out. Live-updates as
  // they type so they get instant visual confirmation that the right people
  // are tagged. Author-self is excluded (the server skips them too).
  const resolvedMentions = useMemo(() => {
    if (!isInternal || !users || users.length === 0 || !reply) return []
    return resolveMentionsAgainstUsers(reply, users)
  }, [reply, users, isInternal])

  function syncMentionState(value: string, caret: number) {
    if (!isInternal) {
      // Mention picker only fires inside internal notes - a stray @-mention
      // in a client-visible reply would just confuse them.
      setMentionStart(null)
      setMentionQuery("")
      return
    }
    let i = caret - 1
    while (i >= 0 && /[A-Za-zÀ-ÖØ-öø-ÿ.\-' ]/.test(value[i])) i--
    if (i >= 0 && value[i] === "@") {
      const prev = i === 0 ? " " : value[i - 1]
      if (/\s|^/.test(prev) || i === 0) {
        const q = value.slice(i + 1, caret)
        if (q.split(/\s+/).length <= 2) {
          setMentionStart(i)
          setMentionQuery(q)
          return
        }
      }
    }
    setMentionStart(null)
    setMentionQuery("")
  }

  function applyMention(user: { name: string | null; email: string }) {
    if (mentionStart == null) return
    const ta = textareaRef.current
    if (!ta) return
    // Full name when the user has one - unique identifies them when the
    // team has duplicate first names (e.g. two Roys), and matches what
    // shows up in the resolved-mentions chip strip so the AM can visually
    // confirm the right person was tagged. Falls back to the email-local
    // part if no name is set.
    const fullName = (user.name ?? user.email.split("@")[0]).trim()
    const before = reply.slice(0, mentionStart)
    const after = reply.slice(ta.selectionStart)
    const insertion = `@${fullName} `
    const next = before + insertion + after
    setReply(next)
    setMentionStart(null)
    setMentionQuery("")
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  // Trengo is the only source where attachments work - Slack outbound here
  // doesn't have an upload endpoint wired (different platform contract; we
  // can add it in a later phase if needed).
  const supportsAttachments = thread.source === "trengo"

  // Channel-kind shortcuts so the JSX below stays readable.
  const isEmail = thread.source === "trengo" && thread.channelKind === "email"

  // --- WhatsApp-specific composer state -----------------------------------
  // The 24h Meta session window opens whenever the contact sends us a message
  // and stays open for 24h. Outside the window, we can only send pre-approved
  // templates. We derive open/closed from the latest non-team message in the
  // thread (mirrors the existing automation path in send-trengo-message).
  const isWhatsApp = thread.source === "trengo" && thread.channelKind === "whatsapp"

  const latestInboundIso = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.authorKind && m.authorKind !== "rl_team") return m.at
    }
    return null
  }, [messages])

  const windowOpen = useMemo(() => {
    if (!isWhatsApp) return true // non-WA threads have no window concept
    if (!latestInboundIso) return false
    const ms = Date.now() - new Date(latestInboundIso).getTime()
    return ms < 24 * 60 * 60 * 1000
  }, [isWhatsApp, latestInboundIso])

  const hoursRemaining = useMemo(() => {
    if (!isWhatsApp || !windowOpen || !latestInboundIso) return 0
    const closesAt = new Date(latestInboundIso).getTime() + 24 * 60 * 60 * 1000
    const ms = closesAt - Date.now()
    return Math.max(0, Math.ceil(ms / (60 * 60 * 1000)))
  }, [isWhatsApp, windowOpen, latestInboundIso])

  // Effective WhatsApp mode: render-time override that forces Template when
  // the window is closed (Meta requirement) but preserves the user's
  // preference in `userWaMode` so reopening the window snaps back to their
  // last choice (Default by default). Internal-note mode also forces
  // Default - Trengo templates can't be sent as internal notes.
  const waMode: WaMode =
    isInternal ? "default" : isWhatsApp && !windowOpen ? "template" : userWaMode

  // Templates list: lazy-loaded the moment the user arrives on a WA thread
  // (cheap - server-side cached for 5 min). Always-fetch is simpler than
  // gating on waMode === "template" and avoids a flash-of-empty when the
  // user toggles modes. Disabled for non-WA threads.
  const templatesQuery = useQuery<{ templates: WaTemplate[] }>({
    queryKey: ["wa-templates", thread.trengoChannelId],
    queryFn: () =>
      fetch(`/api/inbox/wa-templates?channelId=${thread.trengoChannelId}`).then((r) => r.json()),
    enabled: isWhatsApp && !!thread.trengoChannelId,
    staleTime: 5 * 60 * 1000,
  })
  const templates = useMemo(
    () => templatesQuery.data?.templates ?? [],
    [templatesQuery.data?.templates],
  )
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  )

  // Pick template handler - recomputes the variable input array sized to the
  // template's `{{N}}` count so the UI surfaces the right number of fields.
  function pickTemplate(t: WaTemplate | null) {
    setSelectedTemplateId(t?.id ?? null)
    if (!t) {
      setTemplateParams([])
      return
    }
    const count = countTemplateVariables(t.message)
    setTemplateParams(new Array(count).fill(""))
  }

  function setTemplateParam(idx: number, value: string) {
    setTemplateParams((prev) => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }

  // --- end WhatsApp -------------------------------------------------------

  /**
   * Upload one or more files to the Trengo draft store via our proxy. Each
   * file uploads independently so a slow large file doesn't block the small
   * ones; failures don't abort the rest. The resulting Trengo attachment ids
   * are appended to local state and become part of the next send payload.
   */
  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    setUploadError(null)
    // Track concurrent uploads so the Send button stays disabled until every
    // attachment has resolved (otherwise a fast typist could send before the
    // upload finishes and the message would go without the file).
    setUploadingCount((c) => c + files.length)
    await Promise.all(
      files.map(async (file) => {
        try {
          const fd = new FormData()
          fd.append("file", file, file.name)
          const res = await fetch(`/api/inbox/${thread.latestEventId}/attachments`, {
            method: "POST",
            body: fd,
          })
          const data = (await res.json().catch(() => ({}))) as {
            id?: number
            client_name?: string
            full_url?: string
            mime_type?: string
            is_image?: boolean
            needsConnect?: "trengo" | "slack"
            error?: string
          }
          if (!res.ok || typeof data.id !== "number") {
            if (data.needsConnect) setNeedsConnect(data.needsConnect)
            setUploadError(data.error ?? `Upload failed (${res.status})`)
            return
          }
          setAttachments((prev) => [
            ...prev,
            {
              id: data.id!,
              clientName: data.client_name ?? file.name,
              fullUrl: data.full_url ?? "",
              mimeType: data.mime_type ?? file.type ?? null,
              isImage: data.is_image === true || file.type.startsWith("image/"),
            },
          ])
        } catch (e) {
          setUploadError(e instanceof Error ? e.message : "Upload failed")
        } finally {
          setUploadingCount((c) => Math.max(0, c - 1))
        }
      }),
    )
  }

  function removeAttachment(id: number) {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  function onPickFile() {
    fileInputRef.current?.click()
  }

  /** Pull image files out of a paste event and pipe them into the upload
   *  flow. Returns true if at least one image was found, so callers can
   *  preventDefault to suppress the noisy "image as data URL" paste fallback
   *  the browser would otherwise insert. Non-image clipboard contents (text)
   *  fall through unchanged. */
  function tryPasteImages(items: DataTransferItemList | null | undefined): boolean {
    if (!supportsAttachments) return false
    if (!items) return false
    const files: File[] = []
    for (const item of Array.from(items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length === 0) return false
    uploadFiles(files)
    return true
  }

  // True when the WhatsApp template mode is active AND ready to send (template
  // picked, every variable filled). Used both to disable Send and to drive
  // the send branch.
  const templateReady =
    isWhatsApp &&
    waMode === "template" &&
    selectedTemplate != null &&
    templateParams.every((p) => p.trim().length > 0)

  // Email composer is active for email channels when not in internal-note
  // mode. Internal notes fall back to the basic textarea (Trengo internal
  // notes don't carry email fields).
  const isEmailMode = isEmail && !isInternal
  const emailHtmlEmpty = useMemo(
    () => isHtmlEffectivelyEmpty(emailHtml),
    [emailHtml],
  )
  const emailHtmlReady = !emailHtmlEmpty || attachments.length > 0

  async function sendReply() {
    const trimmed = reply.trim()
    const sendingTemplate = isWhatsApp && waMode === "template"
    const sendingEmail = isEmailMode

    if (sendingTemplate) {
      if (!templateReady) return
    } else if (sendingEmail) {
      if (!emailHtmlReady) return
    } else {
      // Attachments-only sends are allowed (e.g. dropping a PDF without a
      // caption). Empty + no attachments → no-op.
      if (!trimmed && attachments.length === 0) return
    }
    if (uploadingCount > 0) return // wait for in-flight uploads
    setSending(true)
    setSendError(null)
    setNeedsConnect(null)
    try {
      // Append the channel signature (kept out of the editor) below the typed
      // message so the sent mail carries it exactly as Trengo defined it. Two
      // <br> for natural spacing; omitted when there's no signature.
      const fullHtml = sendingEmail ? composeEmailHtml(emailHtml, emailSignature) : ""
      // Route email to a NEW email (fresh thread) when forwarding, when the From
      // channel differs from the thread's, or when the To was changed from the
      // thread contact — a Trengo reply can't express any of those. Otherwise
      // it threads via /reply. Roy 2026-07-28.
      // "To changed" only counts when the AM actually typed a recipient that
      // differs from the thread contact. An empty To (or one that matches the
      // contact) threads via /reply, which doesn't need an address - Trengo
      // knows the ticket's contact. This avoids routing a normal reply to the
      // new-email path (which requires a recipient) on threads where we can't
      // derive the contact's address.
      const toMatchesContact =
        emailTo.length === 1 &&
        defaultContactEmail != null &&
        emailTo[0].trim().toLowerCase() === defaultContactEmail.trim().toLowerCase()
      const toChanged = emailTo.length > 0 && !toMatchesContact
      const sendAsNewEmail =
        sendingEmail &&
        (emailMode === "forward" ||
          emailFromChannelId !== thread.trengoChannelId ||
          toChanged)

      let url = `/api/inbox/${thread.latestEventId}/reply`
      let payload: Record<string, unknown>
      if (sendingTemplate && selectedTemplate) {
        payload = {
          internalNote: isInternal,
          template: {
            name: selectedTemplate.slug || selectedTemplate.title,
            language: selectedTemplate.language,
            params: templateParams,
            body: selectedTemplate.message,
          },
        }
        // Templates can't carry text or attachments - Trengo / Meta limit.
      } else if (sendingEmail && sendAsNewEmail) {
        url = `/api/inbox/${thread.latestEventId}/send-email`
        payload = {
          fromChannelId: emailFromChannelId,
          to: emailTo,
          cc: emailCc,
          bcc: emailBcc,
          subject: emailSubject || undefined,
          html: fullHtml,
        }
      } else if (sendingEmail) {
        // Plain-text fallback derived from the HTML so email clients that strip
        // HTML still see something readable.
        payload = {
          internalNote: isInternal,
          message: htmlToPlain(fullHtml),
          attachmentIds: attachments.map((a) => a.id),
          // Metadata so the sent-message mirror row can render the media
          // instantly, before the live Trengo re-fetch backfills it. Roy 2026-07-30.
          attachmentsMeta: attachments.map((a) => ({
            url: a.fullUrl,
            name: a.clientName,
            mime: a.mimeType,
          })),
          email: {
            subject: emailSubject || undefined,
            cc: emailCc,
            bcc: emailBcc,
            html: fullHtml,
          },
        }
      } else {
        payload = {
          internalNote: isInternal,
          message: trimmed,
          attachmentIds: attachments.map((a) => a.id),
          attachmentsMeta: attachments.map((a) => ({
            url: a.fullUrl,
            name: a.clientName,
            mime: a.mimeType,
          })),
        }
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        needsConnect?: "trengo" | "slack"
        error?: string
      }
      if (!res.ok) {
        if (data.needsConnect) setNeedsConnect(data.needsConnect)
        else setSendError(data.error ?? "Reply failed")
        return
      }
      setReply("")
      setAttachments([])
      setMentionStart(null)
      setMentionQuery("")
      setSelectedTemplateId(null)
      setTemplateParams([])
      setEmailSubject("")
      setEmailCc([])
      setEmailBcc([])
      setEmailHtml("")
      // Reset the editable From/To/mode back to this thread's defaults.
      setEmailMode("reply")
      setEmailFromChannelId(thread.trengoChannelId ?? null)
      setEmailTo(defaultContactEmail ? [defaultContactEmail] : [])
      emailToSeededRef.current = thread.threadKey
      // Drop the saved draft for this thread - the message is sent, no
      // reason to restore it next time the user navigates back.
      draftsRef.current.delete(thread.threadKey)
      await queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      onReplied()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Reply failed")
    } finally {
      setSending(false)
    }
  }

  // Forward this email: switch to email-reply mode, clear the recipient, set a
  // "Fwd: …" subject, and pre-fill the editor with the original quoted below.
  // Bump the compose nonce so the (uncontrolled) TipTap editor remounts and
  // actually picks up the quoted body. Roy 2026-07-28.
  function startForward(msg: ChatMessage) {
    setComposerMode("reply")
    setEmailMode("forward")
    setEmailTo([])
    emailToSeededRef.current = thread.threadKey // don't auto-seed To back in
    const base = (msg.emailSubject ?? thread.latestSubject ?? "")
      .replace(/^\s*(re|fwd?)\s*:\s*/i, "")
      .trim()
    setEmailSubject(base ? `Fwd: ${base}` : "Fwd:")
    setEmailHtml(buildForwardedHtml(msg))
    setEmailComposeNonce((n) => n + 1)
  }

  return (
    <div
      className={cn(
        "h-full border border-border bg-card shadow-sm flex flex-col overflow-hidden",
        mergedLeftEdge ? "rounded-r-xl rounded-l-none border-l-0" : "rounded-xl",
      )}
    >
      {/* Header — 187N Chats style: avatar badge + name + channel badge, with a
          mono "client · via channel · N messages" meta line under it. */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 bg-muted/20 shrink-0">
        <div className="min-w-0 flex-1">
          {/* Title row: source icon inline next to the name, the channel
              badge, and (for unlinked Trengo threads) the Link-to-client
              chip — all on one line so the header stays compact. The
              "via channel · N messages" meta sits underneath. Roy 2026-07-28. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <SourceIcon thread={thread} />
            <div className="min-w-0 flex-1">
              <EditableContactName
                key={thread.threadKey}
                displayName={thread.primaryName}
                editable={thread.source === "trengo"}
                onSave={async (next) => {
                  const res = await fetch(
                    `/api/inbox/threads/${encodeURIComponent(thread.threadKey)}/contact`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: next }),
                    },
                  )
                  if (!res.ok) {
                    const data = (await res.json().catch(() => ({}))) as { error?: string }
                    throw new Error(data.error ?? `Update failed (${res.status})`)
                  }
                  // Refetch threads + thread messages so the new name surfaces
                  // in the list and the bubble author labels.
                  queryClient.invalidateQueries({ queryKey: ["inbox-threads"] })
                  queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
                }}
              />
            </div>
            {/* Channel medium (EMAIL / WhatsApp) is already conveyed by the
                source icon to the left of the name, so the text badge was
                redundant - dropped. Link-to-client moved to the bottom action
                bar to keep the header clean. Roy 2026-07-28. */}
          </div>
          {(thread.clientName || thread.channelName) && (
            <p className="text-[11px] text-muted-foreground/70 truncate">
              {thread.clientName
                ? thread.channelName
                  ? `${thread.clientName} · ${t("inbox.chat.via", locale)} ${thread.channelName}`
                  : thread.clientName
                : `${t("inbox.chat.via", locale)} ${thread.channelName}`}
              {thread.totalCount > 0 && (
                <span className="ml-1.5 font-mono text-muted-foreground/50 tabular-nums">
                  · {thread.totalCount}{" "}
                  {thread.totalCount === 1 ? t("inbox.chat.message", locale) : t("inbox.chat.messages", locale)}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Quick "Generate update" - only when the thread is linked to a
              Hub client. Opens the existing weekly-update dialog scoped
              to this client so the AM can fire off a short data-driven
              check-in without leaving the conversation. Roy 2026-06-09:
              the dialog already picks Trengo channel + handles WA / email
              routing, so threading from the Client Inbox is just a matter
              of passing the right mondayItemId. (Adaptive 7/14/30-day
              window selection is on the follow-up list - current MVP
              reuses the same 7-day cadence the dialog already does.) */}
          {thread.clientId && thread.clientName && (
            <ClientUpdateButton
              mondayItemId={thread.clientId}
              clientName={thread.clientName}
            />
          )}
          {/* Mark-read checkbox. Explicit checkbox affordance instead of a
              toggling icon - same visual square at all times, just
              filled/empty so the AM can tell at a glance whether this
              thread is "done" (read) without having to read the tooltip.
              Roy 2026-06-15: icon-toggle was unpredictable, especially on
              email rows where "afvinken" should look like an actual
              checkbox. */}
          {onMarkThread && (
            <ReadCheckbox
              isUnread={thread.unreadCount > 0}
              onToggle={() =>
                onMarkThread(
                  thread,
                  thread.unreadCount > 0 ? "mark_read" : "mark_unread",
                )
              }
            />
          )}
        </div>
      </div>

      {/* Messages. `overflow-x-hidden` + `min-w-0` stop a wide child (an
          email card, a long unbreakable token) from forcing the whole
          detail pane to scroll sideways. The inner `max-w-4xl mx-auto`
          caps the reading column so the conversation stays comfortable on
          wide monitors instead of stretching edge-to-edge - Roy 2026-07-15
          "chat box ineens heel erg breed". */}
      <div ref={scrollRef} className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto bg-muted/50">
        <div className={cn("mx-auto w-full min-w-0 space-y-3 px-4 py-3", isEmail ? "max-w-3xl" : "max-w-4xl")}>
          {messagesQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 text-center py-8">
              {t("inbox.chat.no_messages", locale)}
            </p>
          ) : (
            <ThreadMessagesList
              messages={messages}
              isEmailThread={isEmail}
              clientId={thread.clientId}
              mentionNames={mentionNames}
              noteMentions={noteMentions}
              onMakeTaskFromMessage={onMakeTaskFromMessage}
              onForwardMessage={isEmail ? startForward : undefined}
            />
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* The EXPANDED composer lives INSIDE the scroll viewport (after the
            messages) so it scrolls with the stream - scroll up and it slides
            away to reveal history. The COLLAPSED "Reply…" bar is instead PINNED
            as a footer below the scroll (rendered after the viewport closes) so
            there's always a one-click way to start a reply. Roy 2026-07-26. */}

      {/* Reply box. Drag-drop handlers moved up here from the textarea row
          so dropping ANYWHERE in the composer area uploads the file -
          particularly useful for email mode (no visible textarea) and
          template mode (textarea hidden). */}
      {replyable && (!isEmail || emailComposerOpen) && (
        <div
          className={cn(
            // Inline in the scroll stream (not a fixed footer): natural height,
            // scrolls with the messages. Send is reached by scrolling the stream
            // down; scrolling up slides the whole composer away. Roy 2026-07-26.
            "relative border-t border-border p-3 transition-colors",
            isInternal ? "bg-amber-500/5" : "bg-muted/20",
            isDragOver &&
              supportsAttachments &&
              "ring-2 ring-inset ring-primary/40 bg-primary/[0.04]",
          )}
          onDragOver={(e) => {
            if (!supportsAttachments) return
            if (!e.dataTransfer?.types?.includes("Files")) return
            e.preventDefault()
            setIsDragOver(true)
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the actual wrapper (not when dragging
            // between children - those bubble dragenter/leave constantly).
            if (e.currentTarget === e.target) setIsDragOver(false)
          }}
          onDrop={(e) => {
            if (!supportsAttachments) return
            const files = e.dataTransfer?.files
            if (!files || files.length === 0) return
            e.preventDefault()
            setIsDragOver(false)
            uploadFiles(files)
          }}
        >
          {/* Reply / Internal note toggle. Internal note posts as a Trengo
              `internal_note: true` (team-only bubble) AND fans out @-mention
              notifications to tagged teammates. Slack threads hide the
              toggle entirely - Slack has no native internal-note concept.
              Email mode also gets a collapse-X here so the AM can hand
              the viewport back to the conversation without sending. */}
          {(supportsInternalNote || isEmail) && (
            <div className="flex items-center justify-between gap-2 mb-3">
              {supportsInternalNote ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setComposerMode("reply")}
                    aria-pressed={composerMode === "reply"}
                    className={cn("chip", composerMode === "reply" && "active")}
                  >
                    {t("inbox.chat.reply", locale)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerMode("internal")}
                    aria-pressed={composerMode === "internal"}
                    // Internal note keeps the amber (warning) tone so it never
                    // reads like a client-facing reply. Amber is allowed for
                    // semantic signals per the 187N brand rules.
                    className={cn(
                      "chip",
                      composerMode === "internal" &&
                        "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                    )}
                    title={t("inbox.chat.internal_title", locale)}
                  >
                    {t("inbox.chat.tab_internal", locale)}
                  </button>
                </div>
              ) : (
                <span />
              )}
              {isEmail && (
                <DismissButton
                  size="xs"
                  label={t("inbox.chat.composer_close", locale)}
                  onClick={() => setEmailComposerOpen(false)}
                />
              )}
            </div>
          )}
          {needsConnect && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
              {t("inbox.chat.connect_prefix", locale)}{needsConnect}{t("inbox.chat.connect_suffix", locale)}{" "}
              <Link href="/settings?tab=me" className="underline font-medium">
                {t("inbox.chat.go_to_account", locale)}
              </Link>
            </div>
          )}
          {/* WhatsApp 24h window banner + Default/Template mode selector.
              Banner is informational only; mode selector is hidden when
              Internal note is active (templates can't be internal notes). */}
          {isWhatsApp && !isInternal && (
            <WhatsAppWindowBanner
              windowOpen={windowOpen}
              hoursRemaining={hoursRemaining}
              mode={waMode}
              onModeChange={setUserWaMode}
            />
          )}
          {isWhatsApp && waMode === "template" && !isInternal && (
            <WhatsAppTemplateControls
              templates={templates}
              loading={templatesQuery.isLoading}
              error={templatesQuery.error instanceof Error ? templatesQuery.error.message : null}
              selectedTemplate={selectedTemplate}
              params={templateParams}
              onPick={pickTemplate}
              onParamChange={setTemplateParam}
            />
          )}
          {sendError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
              {sendError}
            </div>
          )}
          {uploadError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
              {uploadError}
            </div>
          )}
          {/* Attachment chips strip - sits above the textarea so the user can
              see exactly what they're about to send. Each chip shows an icon
              (image preview thumbnail or generic file icon), filename, and
              an × to remove before sending. */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} onRemove={() => removeAttachment(a.id)} />
              ))}
            </div>
          )}
          {uploadingCount > 0 && (
            <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading {uploadingCount} file{uploadingCount === 1 ? "" : "s"}…
            </div>
          )}
          {/* Resolved-mentions strip - only in internal-note mode. Shows
              every teammate the @-mention parser will fan out to when the
              AM hits Send. Mirrors the server-side regex + lookup so what
              you see here is exactly who'll get a notification. Empty
              strip when no resolved mentions, but a hint stays visible
              while in internal mode so the AM knows the affordance exists. */}
          {isInternal && (
            <MentionPreviewStrip
              resolved={resolvedMentions}
              hasUnresolved={hasUnresolvedMention(reply, users ?? [])}
            />
          )}
          {/* Light markdown toolbar - WhatsApp default-mode only. WA supports
              bold (*x*), italic (_x_), strikethrough (~x~). Email gets full
              rich text in Fase 3. */}
          {isWhatsApp && waMode === "default" && !isInternal && (
            <WhatsAppMarkdownToolbar
              textareaRef={textareaRef}
              value={reply}
              onChange={setReply}
            />
          )}
          {/* Email composer block: rich-text editor with header (From/To/
              Subject/CC/BCC) and signature auto-injection. Replaces the
              textarea+paperclip row entirely on email channels (paperclip
              is rendered inline below the editor). Internal note mode falls
              back to the basic textarea even on email - Trengo internal
              notes don't carry email_message fields anyway. */}
          {isEmailMode && (
            <>
              <EmailComposer
                // Remount on thread switch AND on forward (nonce) so the TipTap
                // editor picks up the newly-restored draft / forwarded body.
                // Without this, parent setting `emailHtml` wouldn't propagate
                // into the editor's internal state (TipTap is uncontrolled).
                key={`${thread.threadKey}:${emailComposeNonce}`}
                fromChannelId={emailFromChannelId}
                onFromChannelChange={setEmailFromChannelId}
                emailChannels={emailChannels}
                threadKey={thread.threadKey}
                to={emailTo}
                onToChange={setEmailTo}
                mode={emailMode}
                subject={emailSubject}
                onSubjectChange={setEmailSubject}
                cc={emailCc}
                onCcChange={setEmailCc}
                bcc={emailBcc}
                onBccChange={setEmailBcc}
                htmlBody={emailHtml}
                onHtmlBodyChange={setEmailHtml}
                onSignatureChange={setEmailSignature}
                onPasteFiles={(files) => uploadFiles(files)}
                disabled={sending || uploadingCount > 0}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                {supportsAttachments && (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files) uploadFiles(e.target.files)
                        e.target.value = ""
                      }}
                    />
                    <button
                      type="button"
                      onClick={onPickFile}
                      disabled={sending}
                      title={t("inbox.chat.attach", locale)}
                      aria-label={t("inbox.chat.attach", locale)}
                      className="h-10 w-10 inline-flex items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                  </>
                )}
                <Button
                  onClick={sendReply}
                  disabled={!emailHtmlReady || sending || uploadingCount > 0}
                  className="h-10 px-5 text-sm font-medium gap-2"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      {t("inbox.chat.send_email", locale)}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
          {/* Template-mode replaces the textarea with a Send-only bar - the
              composer's "input" is the variable list above. Default mode
              keeps the existing textarea + paperclip + Send row. */}
          {!isEmailMode && isWhatsApp && waMode === "template" && !isInternal ? (
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={sendReply}
                disabled={!templateReady || sending}
                className="h-10 px-5 text-sm font-medium gap-2"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {t("inbox.chat.send_template", locale)}
                  </>
                )}
              </Button>
            </div>
          ) : !isEmailMode ? (
          <>
          {/* Pedro draft chip - only for client-facing replies on a linked
              client. Renders just above the textarea so the AM sees it
              before they start typing. Click = append Pedro's current
              conclusion to the draft (or set it when the textarea is
              empty). Roy 2026-06-09. */}
          {!isInternal && thread.clientId && (
            <div className="mb-1.5">
              <PedroDraftButton
                clientId={thread.clientId}
                disabled={sending}
                onInsert={(text) => {
                  setReply((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text))
                  // Focus the textarea so the AM can keep editing.
                  setTimeout(() => textareaRef.current?.focus(), 0)
                }}
              />
            </div>
          )}
          <div className="relative flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value)
                syncMentionState(e.target.value, e.target.selectionStart ?? 0)
              }}
              onKeyUp={(e) => {
                const ta = e.currentTarget
                syncMentionState(ta.value, ta.selectionStart ?? 0)
              }}
              // Engaging the reply box picks up the ticket (New -> Opgepakt),
              // idempotent so re-focusing is a no-op. Roy 2026-07-26.
              onFocus={() => onPickup?.()}
              onClick={(e) => {
                const ta = e.currentTarget
                syncMentionState(ta.value, ta.selectionStart ?? 0)
              }}
              placeholder={
                isInternal
                  ? t("inbox.chat.internal_placeholder", locale)
                  : t("inbox.chat.reply_placeholder", locale, { source: thread.source })
              }
              rows={3}
              disabled={sending}
              className={cn(
                "flex-1 resize-none rounded-2xl border bg-transparent px-3.5 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                isInternal
                  ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 focus-visible:border-amber-500/60"
                  : "border-input bg-background focus-visible:border-ring",
              )}
              onKeyDown={(e) => {
                if (mentionStart != null && mentionMatches.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault()
                    setMentionHighlight((h) => Math.min(mentionMatches.length - 1, h + 1))
                    return
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault()
                    setMentionHighlight((h) => Math.max(0, h - 1))
                    return
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault()
                    applyMention(mentionMatches[mentionHighlight])
                    return
                  }
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setMentionStart(null)
                    setMentionQuery("")
                    return
                  }
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  sendReply()
                }
              }}
              onPaste={(e) => {
                if (tryPasteImages(e.clipboardData?.items)) e.preventDefault()
              }}
            />
            {supportsAttachments && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) uploadFiles(e.target.files)
                    // Allow re-picking the same file later by resetting value.
                    e.target.value = ""
                  }}
                />
                <button
                  type="button"
                  onClick={onPickFile}
                  disabled={sending}
                  title={t("inbox.chat.attach", locale)}
                  aria-label={t("inbox.chat.attach", locale)}
                  className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
              </>
            )}
            <Button
              onClick={sendReply}
              disabled={
                (!reply.trim() && attachments.length === 0) ||
                sending ||
                uploadingCount > 0
              }
              size="icon"
              title={t("inbox.chat.send", locale)}
              aria-label={t("inbox.chat.send", locale)}
              className={cn(
                "h-10 w-10 shrink-0",
                isInternal && "bg-amber-500 hover:bg-amber-600 text-amber-950",
              )}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>

            {mentionStart != null && mentionMatches.length > 0 && (
              <div className="absolute bottom-full mb-1 left-0 right-12 z-10 rounded-md border border-border bg-popover shadow-lg py-1 text-xs">
                {mentionMatches.map((u, i) => {
                  const active = i === mentionHighlight
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        applyMention(u)
                      }}
                      onMouseEnter={() => setMentionHighlight(i)}
                      className={cn(
                        "w-full text-left px-3 py-1.5 flex items-center gap-2",
                        active ? "bg-muted/80" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="h-5 w-5 shrink-0 rounded-full bg-muted inline-flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
                        {(u.name?.trim()[0] ?? u.email[0] ?? "?").toUpperCase()}
                      </span>
                      <span className="flex-1 truncate">
                        <span className="font-medium text-foreground/90">
                          {u.name ?? u.email}
                        </span>
                        {u.name && (
                          <span className="text-muted-foreground/50 ml-1.5 text-[10px]">
                            {u.email}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          </>
          ) : null}
        </div>
      )}
      </div>

      {/* Pinned collapsed "Reply…" bar — a fixed footer below the scroll
          viewport so there's always a one-click way into the composer. Only for
          email in its collapsed state; clicking it expands the full composer
          INSIDE the scroll (above), and the bar disappears. Roy 2026-07-26. */}
      {replyable && isEmail && !emailComposerOpen && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-3">
          <button
            type="button"
            onClick={() => {
              // Opening the reply = taking the ticket: New -> Opgepakt now.
              onPickup?.()
              setEmailComposerOpen(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-full border border-border bg-muted/30 py-1.5 pl-4 pr-1.5 text-left text-sm text-muted-foreground/70 transition-colors hover:border-foreground/20 hover:bg-muted/50"
          >
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground/45" />
            <span className="flex-1 truncate">{t("inbox.chat.reply", locale)}…</span>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Send className="h-3.5 w-3.5" />
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

// --- WhatsApp composer pieces -------------------------------------------

/** Top-of-composer banner that shows the current 24h Meta session window
 *  state plus the Default/Template mode selector. Inside the window the AM
 *  picks freely; outside the window the selector is locked to Template
 *  (Meta forbids free text). The locked state is conveyed by greying out
 *  the Default option + a tooltip rather than hiding the toggle entirely
 *  - keeps the AM aware that the choice exists and why it's unavailable. */
function WhatsAppWindowBanner({
  windowOpen,
  hoursRemaining,
  mode,
  onModeChange,
}: {
  windowOpen: boolean
  hoursRemaining: number
  mode: WaMode
  onModeChange: (mode: WaMode) => void
}) {
  const locale = useLocale()
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-2.5 mb-3 flex items-center justify-between gap-3 text-xs",
        windowOpen
          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300",
      )}
    >
      <span className="inline-flex items-center gap-2 min-w-0">
        {windowOpen ? (
          <>
            <Clock3 className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">
              {t("inbox.chat.window_open", locale, { h: hoursRemaining })}
            </span>
          </>
        ) : (
          <>
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">
              {t("inbox.chat.window_closed", locale)}
            </span>
          </>
        )}
      </span>
      {/* 187N chip toggle - same vocabulary as the Reply / Internal note
          switch above so the composer reads as one system. */}
      <span className="inline-flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => windowOpen && onModeChange("default")}
          disabled={!windowOpen}
          className={cn("chip", mode === "default" && "active", !windowOpen && "opacity-40 cursor-not-allowed")}
          title={!windowOpen ? t("inbox.chat.freetext_disabled", locale) : t("inbox.chat.default_message", locale)}
        >
          {t("inbox.chat.default", locale)}
        </button>
        <button
          type="button"
          onClick={() => onModeChange("template")}
          className={cn("chip", mode === "template" && "active")}
          title={t("inbox.chat.template_send_title", locale)}
        >
          {t("inbox.chat.template", locale)}
        </button>
      </span>
    </div>
  )
}

/** Template picker dropdown + variable input fields. Shown only in Template
 *  mode. The picker lists every approved template for this channel
 *  alphabetically; selecting one renders text inputs sized to the template's
 *  `{{N}}` variable count, plus a live preview of the rendered message
 *  underneath. The Send button (rendered separately by the parent) only
 *  enables once every variable is filled. */
function WhatsAppTemplateControls({
  templates,
  loading,
  error,
  selectedTemplate,
  params,
  onPick,
  onParamChange,
}: {
  templates: WaTemplate[]
  loading: boolean
  error: string | null
  selectedTemplate: WaTemplate | null
  params: string[]
  onPick: (t: WaTemplate | null) => void
  onParamChange: (idx: number, value: string) => void
}) {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const triggerLabel = selectedTemplate
    ? `${selectedTemplate.title}${selectedTemplate.language ? ` (${selectedTemplate.language})` : ""}`
    : loading
      ? t("inbox.chat.loading_templates", locale)
      : templates.length === 0
        ? t("inbox.chat.no_templates", locale)
        : t("inbox.chat.select_template", locale)

  return (
    <div className="rounded-md border border-border/60 bg-background p-2.5 mb-2 space-y-2">
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        {t("inbox.chat.wa_template", locale)}
      </label>
      {/* 187N dropdown (was a bare OS <select>: off-theme + it didn't reflect
          the picked template). Trigger shows the selection explicitly; the list
          opens upward since the composer sits at the bottom. Roy 2026-07-30. */}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={loading || templates.length === 0}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 text-xs transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !selectedTemplate && "text-muted-foreground/60")}>
            {triggerLabel}
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-180")} />
        </button>
        {open && templates.length > 0 && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-30 mb-1 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          >
            {templates.map((tpl) => {
              const active = selectedTemplate?.id === tpl.id
              return (
                <button
                  key={tpl.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onPick(tpl)
                    setOpen(false)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tpl.title}
                    {tpl.language ? ` (${tpl.language})` : ""}
                  </span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
      {error && (
        <p className="text-[11px] text-destructive">{t("inbox.chat.templates_load_failed", locale)}{error}</p>
      )}
      {selectedTemplate && (
        <>
          {params.length > 0 && (
            <div className="space-y-1.5">
              {params.map((value, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="w-12 text-[10px] font-mono text-muted-foreground shrink-0">
                    {`{{${idx + 1}}}`}
                  </span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onParamChange(idx, e.target.value)}
                    placeholder={t("inbox.chat.variable", locale, { n: idx + 1 })}
                    className="flex-1 h-7 px-2 rounded-md border border-input bg-background text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
              {t("inbox.chat.preview", locale)}
            </p>
            <p className="text-xs whitespace-pre-wrap leading-relaxed">
              {renderTemplate(selectedTemplate.message, params)}
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/** Lightweight markdown toolbar - three buttons that wrap the textarea's
 *  current selection in WhatsApp's supported markup. Bold (*x*), italic
 *  (_x_), strikethrough (~x~). When no selection, inserts paired markers at
 *  the caret so the user types between them. */
function WhatsAppMarkdownToolbar({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
}) {
  function wrap(marker: string) {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart ?? 0
    const end = ta.selectionEnd ?? 0
    const before = value.slice(0, start)
    const sel = value.slice(start, end)
    const after = value.slice(end)
    const next = `${before}${marker}${sel}${marker}${after}`
    onChange(next)
    requestAnimationFrame(() => {
      ta.focus()
      const cursor = sel.length > 0 ? end + marker.length * 2 : start + marker.length
      ta.setSelectionRange(cursor, cursor)
    })
  }
  const locale = useLocale()
  const btnCls =
    "h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
  return (
    <div className="inline-flex items-center gap-0.5 mb-1.5">
      <button type="button" onClick={() => wrap("*")} title={t("inbox.chat.bold", locale)} className={btnCls}>
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => wrap("_")} title={t("inbox.chat.italic", locale)} className={btnCls}>
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => wrap("~")} title={t("inbox.chat.strikethrough", locale)} className={btnCls}>
        <Strikethrough className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Strip HTML to plain text for the email-message fallback field. Cheap
 *  best-effort approach: parse via DOMParser and pull `textContent`,
 *  collapsing whitespace. Trengo derives its own plain-text rendering at
 *  send time too, so this is purely a defensive fallback for clients that
 *  ignore the HTML payload. */
function htmlToPlain(html: string): string {
  if (typeof window === "undefined") return html
  try {
    const doc = new DOMParser().parseFromString(html, "text/html")
    // Replace block-ish elements with newlines so paragraphs don't collapse
    // into one wall of text.
    doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"))
    doc.querySelectorAll("p, div, li").forEach((el) => {
      el.append(document.createTextNode("\n"))
    })
    const text = doc.body?.textContent ?? ""
    return text.replace(/\n{3,}/g, "\n\n").trim()
  } catch {
    return html.replace(/<[^>]+>/g, "")
  }
}

/** Join the AM's typed message HTML with the channel signature block. The
 *  signature is kept out of the editor (rendered as a read-only preview) so
 *  the send gate reads the typed message only; here we stitch them back
 *  together for the outgoing mail. Two <br> give natural spacing; when there's
 *  no signature the message is returned untouched. */
function composeEmailHtml(messageHtml: string, signature: string | null): string {
  if (!signature) return messageHtml
  return `${messageHtml}<br><br>${signature}`
}

/** Escape the 5 HTML-significant chars for safe interpolation into markup. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Build the initial editor HTML for a Forward: two blank lines for the AM's
 *  note, a `---------- Forwarded message ----------` header block, then the
 *  original email quoted in a blockquote (its rich HTML when we have it, else
 *  the plain body with line breaks preserved). Roy 2026-07-28. */
function buildForwardedHtml(msg: ChatMessage): string {
  const from = msg.emailFromAddress
    ? `${msg.authorName} <${msg.emailFromAddress}>`
    : msg.authorName
  const original =
    msg.bodyHtml && msg.bodyHtml.includes("<")
      ? msg.bodyHtml
      : escapeHtmlText(msg.body).replace(/\r\n|\r|\n/g, "<br>")
  const headerLines = [
    `From: ${escapeHtmlText(from)}`,
    `Date: ${escapeHtmlText(fmtTime(msg.at))}`,
    msg.emailSubject ? `Subject: ${escapeHtmlText(msg.emailSubject)}` : null,
  ]
    .filter(Boolean)
    .join("<br>")
  return (
    `<p></p><p></p>` +
    `<p>---------- Forwarded message ----------</p>` +
    `<p>${headerLines}</p>` +
    `<blockquote>${original}</blockquote>`
  )
}

/** Empty-html check that ignores TipTap's "empty doc" representations
 *  (`<p></p>`, `<p><br></p>`) and pure-whitespace bodies. Used to gate the
 *  email Send button so an "empty" reply with just signature whitespace
 *  doesn't fire. */
function isHtmlEffectivelyEmpty(html: string): boolean {
  if (!html) return true
  const stripped = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim()
  return stripped.length === 0
}

/** Count distinct `{{N}}` placeholders in a template's source body. Returns
 *  the maximum N found (so a template using `{{1}}` and `{{3}}` reports 3
 *  variables, the convention Trengo and Meta both follow). */
function countTemplateVariables(message: string): number {
  let max = 0
  const re = /\{\{(\d+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max
}

/** Substitute the template's `{{N}}` placeholders with the user-supplied
 *  values for the live preview underneath the variable inputs. */
function renderTemplate(message: string, params: string[]): string {
  return message.replace(/\{\{(\d+)\}\}/g, (_, idx) => {
    const i = parseInt(idx, 10) - 1
    return params[i]?.trim().length ? params[i] : `{{${idx}}}`
  })
}

// --- Pieces --------------------------------------------------------------

/** Resolved-mentions strip rendered above the textarea in internal-note
 *  mode. Each chip = one teammate who WILL receive an inbox Update + push
 *  notification when the AM hits Send. Mirrors the server-side fan-out
 *  resolution exactly - the visual is the contract.
 *
 *  States:
 *    - 0 resolved + has-unresolved typing → amber "no match" hint so the
 *      AM knows their @typing isn't matching anyone yet
 *    - 0 resolved + no @ typed → muted "Type @ to mention a teammate" hint
 *    - 1+ resolved → primary-tinted pills with full names */
function MentionPreviewStrip({
  resolved,
  hasUnresolved,
}: {
  resolved: InboxUser[]
  hasUnresolved: boolean
}) {
  const locale = useLocale()
  if (resolved.length === 0 && !hasUnresolved) {
    return (
      <p className="text-[11px] text-muted-foreground/70 mb-2 inline-flex items-center gap-1">
        <span className="opacity-70">{t("inbox.chat.mention_hint_pre", locale)}</span>
        <span className="font-mono px-1 py-0.5 rounded bg-muted text-foreground/80">@</span>
        <span className="opacity-70">{t("inbox.chat.mention_hint_post", locale)}</span>
      </p>
    )
  }
  return (
    <div className="mb-2 flex items-center flex-wrap gap-1.5">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mr-1">
        {t("inbox.chat.will_notify", locale)}
      </span>
      {resolved.map((u) => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 text-primary dark:text-primary px-2 py-0.5 text-[11px] font-semibold"
          title={u.email}
        >
          <span className="h-4 w-4 inline-flex items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold">
            {(u.name?.trim()[0] ?? u.email[0] ?? "?").toUpperCase()}
          </span>
          @{u.name ?? u.email.split("@")[0]}
        </span>
      ))}
      {hasUnresolved && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[11px] font-medium"
          title={t("inbox.chat.mention_unmatched", locale)}
        >
          {t("inbox.chat.unmatched_mention", locale)}
        </span>
      )}
    </div>
  )
}

/** Returns true when the body contains an `@<name>` that didn't resolve
 *  to any teammate - used to surface the "unmatched" warning chip so the
 *  AM doesn't accidentally ship an internal note thinking they tagged
 *  someone who's actually not in the system. */
function hasUnresolvedMention(body: string, users: InboxUser[]): boolean {
  if (!body || users.length === 0) return false
  const captures = extractMentionCaptures(body)
  if (captures.length === 0) return false
  for (const cap of captures) {
    if (!matchUserByPrefix(cap, users)) return true
  }
  return false
}

/** Greedy capture of every `@<word>(\s+<word>)*` token in the body.
 *  Stops on punctuation, newline, or end. Returns the captured names
 *  (without the leading `@`). Allows lowercase secondary words to support
 *  Dutch tussenvoegsel ("Roel van der Harst"). */
function extractMentionCaptures(body: string): string[] {
  return Array.from(
    body.matchAll(/@([A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+){0,5})/g),
  ).map((m) => m[1].trim())
}

/** Try to match a captured mention text against the users list using the
 *  longest-prefix strategy: try the full capture first, then drop one
 *  trailing word at a time, then finally try first-name-only as a last
 *  resort. Returns the matched user or null. Case-insensitive. */
function matchUserByPrefix(capture: string, users: InboxUser[]): InboxUser | null {
  const tokens = capture.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  for (let i = tokens.length; i >= 1; i--) {
    const candidate = tokens.slice(0, i).join(" ").toLowerCase()
    const user = users.find((u) => (u.name ?? "").toLowerCase() === candidate)
    if (user) return user
  }
  // Last resort: first-name-only match (supports `@Roel` when the user's
  // full name is "Roel van der Harst" - same UX as the picker's quick
  // pick). Only when capture is a single word; multi-word captures should
  // hit a full-name match above.
  if (tokens.length === 1) {
    const single = tokens[0].toLowerCase()
    const user = users.find((u) => {
      const name = (u.name ?? "").toLowerCase()
      return name.split(/\s+/)[0] === single
    })
    if (user) return user
  }
  return null
}

/** Resolve every @-capture in the body to a user, deduped. Used by the
 *  preview chip strip so what the AM sees matches what the server's
 *  fanOutMentionsForInternalNote will fan out to. */
function resolveMentionsAgainstUsers(body: string, users: InboxUser[]): InboxUser[] {
  const captures = extractMentionCaptures(body)
  const hits = new Map<string, InboxUser>()
  for (const cap of captures) {
    const u = matchUserByPrefix(cap, users)
    if (u) hits.set(u.id, u)
  }
  return Array.from(hits.values())
}

/** Inline picker for assigning an unlinked Trengo thread to a Hub client.
 *  Renders as a small "Link to client …" affordance under the conversation
 *  header; expands to a search-as-you-type list of clients on click. The
 *  link is appended (not replaces) - `clients.trengo_contact_ids` is a
 *  TEXT[] so a single client can be reachable on multiple Trengo contacts.
 *
 *  Conflict handling: if the contact is already linked to a different
 *  client, the API returns 409 with the existing client's name; the picker
 *  surfaces that as an inline error. */
/** Client-search popover for attaching a Trengo thread to a Hub client.
 *  Generic: the caller supplies `onSelect(clientId)` to do the actual link
 *  (single thread in the chat pane, or all selected threads from the bulk
 *  action bar). Trigger label + styling are overridable so it fits both the
 *  `chip` chrome and the bulk-bar chip. Roy 2026-07-29. */
export function LinkToClientPicker({
  onSelect,
  label = "Link to client…",
  openUp = false,
  triggerClassName,
}: {
  onSelect: (clientId: string) => Promise<void>
  label?: string
  /** Open the dropdown upward (used at the bottom of the pane / bulk bar). */
  openUp?: boolean
  triggerClassName?: string
}) {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const clientsQuery = useQuery<Array<{ monday_item_id: string; name: string }>>({
    queryKey: ["inbox-link-clients"],
    queryFn: () => fetch("/api/clients/search").then((r) => r.json()),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  })

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const filtered = (clientsQuery.data ?? []).filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  async function pick(clientId: string) {
    setSubmitting(true)
    setError(null)
    try {
      await onSelect(clientId)
      setOpen(false)
      setQuery("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={triggerClassName ?? "chip"}>
          <Link2 className="h-3.5 w-3.5" />
          {label}
        </button>
      ) : (
        // Absolute overlay so opening the picker doesn't stretch its row.
        // Opens upward in the bottom composer bar (no room below). Roy 2026-07-28.
        <div
          className={cn(
            "absolute left-0 z-20 rounded-md border border-border bg-popover shadow-md p-2 w-[280px] max-w-[80vw]",
            openUp ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("inbox.chat.search_clients", locale)}
            autoFocus
            className="w-full h-7 px-2 mb-1.5 rounded border border-input bg-background text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          {error && (
            <p className="text-[11px] text-destructive mb-1.5 px-1">{error}</p>
          )}
          <div className="max-h-[260px] overflow-y-auto space-y-0.5">
            {clientsQuery.isLoading ? (
              <p className="text-[11px] text-muted-foreground px-1.5 py-1">{t("inbox.chat.loading", locale)}</p>
            ) : filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-1.5 py-1">{t("inbox.chat.no_matches", locale)}</p>
            ) : (
              filtered.slice(0, 50).map((c) => (
                <button
                  key={c.monday_item_id}
                  type="button"
                  onClick={() => pick(c.monday_item_id)}
                  disabled={submitting}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-muted disabled:opacity-50 truncate"
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline-editable contact name for the conversation header. Click the
 *  bold name to switch to an input; Enter or blur saves; Escape cancels.
 *  Used to give a real name to "Unknown"/phone-number contacts so the
 *  thread list and message bubbles label them properly going forward.
 *
 *  Save is propagated to Trengo via PATCH /contacts/{id} so the change
 *  sticks across surfaces (Trengo web UI, future inbound webhooks). The
 *  optimistic local override hides the prop value until the parent's
 *  refetch comes back with the new name; on failure the override clears
 *  and an inline error is shown briefly. */
function EditableContactName({
  displayName,
  editable,
  onSave,
}: {
  displayName: string
  editable: boolean
  onSave: (next: string) => Promise<void>
}) {
  const locale = useLocale()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(displayName)
  const [optimistic, setOptimistic] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync optimistic name back to underlying prop once the refetch confirms
  // the change (prop matches optimistic override).
  useEffect(() => {
    if (optimistic && optimistic === displayName) setOptimistic(null)
  }, [optimistic, displayName])

  // Reset draft when entering edit mode so we always start from the latest.
  useEffect(() => {
    if (editing) {
      setDraft(optimistic ?? displayName)
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing, optimistic, displayName])

  async function commit() {
    const next = draft.trim()
    if (!next || next === (optimistic ?? displayName)) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    setOptimistic(next)
    try {
      await onSave(next)
      setEditing(false)
    } catch (e) {
      setOptimistic(null)
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const shown = optimistic ?? displayName

  if (!editable) {
    return <p className="text-sm font-semibold truncate">{shown}</p>
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            setEditing(false)
            setError(null)
          }
        }}
        onBlur={commit}
        disabled={saving}
        className="text-sm font-semibold bg-background border border-input rounded-md px-2 py-0.5 min-w-0 max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        setError(null)
        setEditing(true)
      }}
      title={error ?? t("inbox.chat.edit_contact", locale)}
      className={cn(
        "text-sm font-semibold truncate text-left rounded px-1 -mx-1 hover:bg-muted transition-colors max-w-full",
        error && "ring-1 ring-destructive/40",
      )}
    >
      {shown}
    </button>
  )
}

/** Compact preview chip for an attachment that's been uploaded but not sent
 *  yet. Image attachments get a tiny thumbnail (the Trengo presigned S3 URL
 *  is loaded directly - no Hub-side proxy needed since it's already
 *  authenticated via signature). Non-images get a generic file icon.
 *  The remove button drops the chip locally; the underlying Trengo draft
 *  attachment record stays (orphan cleanup is out of scope for Phase 1). */
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment
  onRemove: () => void
}) {
  const locale = useLocale()
  return (
    <div className="group inline-flex items-center gap-1.5 rounded-md border border-border bg-background pl-1 pr-1.5 py-1 max-w-[220px]">
      {attachment.isImage && attachment.fullUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.fullUrl}
          alt=""
          className="h-6 w-6 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded bg-muted text-muted-foreground">
          {attachment.mimeType?.startsWith("image/") ? (
            <ImageIcon className="h-3.5 w-3.5" />
          ) : (
            <FileText className="h-3.5 w-3.5" />
          )}
        </span>
      )}
      <span className="text-[11px] text-foreground/80 truncate flex-1 min-w-0">
        {attachment.clientName}
      </span>
      <DismissButton size="xs" onClick={onRemove} label={t("inbox.chat.remove_attachment", locale)} stopPropagation={false} />
    </div>
  )
}

/**
 * Renders the messages inside a single thread. For non-email threads
 * (WhatsApp / Slack) it's just a flat list - those messages are tiny
 * so showing all of them is fine. For email threads it adopts the
 * Gmail collapse pattern (Roy 2026-06-13):
 *
 *   - 1-3 messages       → all expanded
 *   - 4 messages         → first expanded, last 2 expanded, middle
 *                          collapsed into a single button
 *   - 5+ messages        → first expanded, last 2 expanded, middle
 *                          messages (2 ... N-2) hidden behind a
 *                          "Show N earlier messages" button
 *
 * The button reveals the middle stack and stays out of the way after.
 * Internal team notes (yellow) always render fully so the AM doesn't
 * miss a flag inside a long quoted thread.
 */
/** 187N day divider between message groups: a mono micro-caps label centred
 *  between two hairlines ("TODAY", "YESTERDAY", "24 JUL"). Roy 2026-07-24. */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1 bg-border/60" />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/45">{label}</span>
      <span className="h-px flex-1 bg-border/60" />
    </div>
  )
}

function dayDividerLabel(iso: string): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(new Date()) - startOf(d)) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" })
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function ThreadMessagesList({
  messages,
  isEmailThread,
  clientId,
  mentionNames = [],
  noteMentions,
  onMakeTaskFromMessage,
  onForwardMessage,
}: {
  messages: ChatMessage[]
  isEmailThread: boolean
  clientId: string | null
  /** Hub user display names, so @-mentions in message bodies render blue. */
  mentionNames?: string[]
  noteMentions?: NoteMentions
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  /** Forward this email message: opens the composer in forward mode with the
   *  original quoted below. Email threads only. */
  onForwardMessage?: (msg: ChatMessage) => void
}) {
  // Which older email messages the user has folded open. The latest message +
  // any internal note are always open; everything else starts collapsed.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Reset the fold state whenever the thread changes - the parent re-mounts on
  // thread switch by virtue of the messages array identity changing, but the
  // reset is explicit so it survives refetches inside the same thread.
  const firstMessageId = messages[0]?.id ?? null
  useEffect(() => {
    setExpandedIds(new Set())
  }, [firstMessageId])

  function makeTask(msg: ChatMessage) {
    if (!onMakeTaskFromMessage || !clientId) return undefined
    return () => {
      const preview = msg.body.trim().replace(/\s+/g, " ")
      const title = preview.length > 80 ? preview.slice(0, 77) + "…" : preview || "Follow up"
      onMakeTaskFromMessage({
        clientId,
        title,
        body: preview.length > 80 ? msg.body : undefined,
      })
    }
  }

  // Non-email threads (WhatsApp / Slack): flat bubble list with a day divider
  // whenever the calendar day changes (187N Chats "TODAY ·" separator).
  if (!isEmailThread) {
    let prevDay: string | null = null
    return (
      <>
        {messages.map((msg) => {
          const day = dayDividerLabel(msg.at)
          const showDivider = day !== prevDay
          prevDay = day
          return (
            <Fragment key={msg.id}>
              {showDivider && <DayDivider label={day} />}
              <MessageBubble
                msg={msg}
                isEmailThread={isEmailThread}
                mentionNames={mentionNames}
                noteMentions={noteMentions}
                onMakeTask={makeTask(msg)}
                onForward={onForwardMessage ? () => onForwardMessage(msg) : undefined}
              />
            </Fragment>
          )
        })}
      </>
    )
  }

  // Email thread — Trengo pattern: the LATEST message is fully expanded, every
  // older message is a one-line row you fold open with the chevron. Internal
  // notes always stay expanded (never hide a team flag). No per-message
  // max-height, so the whole thread rides the single scrollbar. Roy 2026-07-26.
  const lastId = messages[messages.length - 1]?.id ?? null
  return (
    <>
      {messages.map((msg) => {
        const alwaysOpen = msg.id === lastId || msg.isInternal === true
        const open = alwaysOpen || expandedIds.has(msg.id)
        if (!open) {
          return <CollapsedEmailRow key={msg.id} msg={msg} onExpand={() => toggleExpanded(msg.id)} />
        }
        return (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isEmailThread
            mentionNames={mentionNames}
            noteMentions={noteMentions}
            onMakeTask={makeTask(msg)}
            onForward={onForwardMessage ? () => onForwardMessage(msg) : undefined}
            // Older expanded emails get a collapse chevron to fold them back;
            // the latest + internal notes stay open (no chevron).
            onCollapse={alwaysOpen ? undefined : () => toggleExpanded(msg.id)}
          />
        )
      })}
    </>
  )
}

/** Collapsed email row (Trengo pattern): one line — avatar + sender + preview
 *  snippet + relative time + a chevron. Clicking anywhere folds it open into
 *  the full EmailMessageCard. */
function CollapsedEmailRow({ msg, onExpand }: { msg: ChatMessage; onExpand: () => void }) {
  const isUs = msg.authorKind === "rl_team"
  const preview = (msg.body || msg.emailSubject || "").trim().replace(/\s+/g, " ")
  return (
    <button
      type="button"
      onClick={onExpand}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:border-foreground/25"
    >
      <UserAvatar
        name={msg.authorName}
        avatarUrl={msg.authorAvatarUrl}
        className="size-8 shrink-0"
        fallbackClassName={cn(
          "text-xs font-semibold",
          isUs ? "bg-primary/15 text-primary" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        )}
      />
      <span className="max-w-[9rem] shrink-0 truncate text-[13px] font-semibold text-foreground/90">
        {msg.authorName}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground/70">{preview || "…"}</span>
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/50">{fmtRelative(msg.at)}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground/60" />
    </button>
  )
}

/** Render a message body with @-mentions coloured blue (incl. the "@"),
 *  Trengo-style. Matches known Hub user names precisely so "@Roy Vosters"
 *  lights up as one token without eating the words that follow it; falls
 *  back to a leading "@Name" heuristic when no name list is available. */
function renderMentions(text: string, names: string[]): React.ReactNode {
  if (!text) return text
  const cls = "font-medium text-blue-500 dark:text-blue-400"
  const known = names.filter((n) => n && n.trim().length > 0)
  if (known.length > 0) {
    const escaped = known
      .map((n) => n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .sort((a, b) => b.length - a.length)
    const re = new RegExp(`@(?:${escaped.join("|")})`, "g")
    const out: React.ReactNode[] = []
    let last = 0
    let m: RegExpExecArray | null
    let i = 0
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push(text.slice(last, m.index))
      out.push(
        <span key={i++} className={cls}>
          {m[0]}
        </span>,
      )
      last = m.index + m[0].length
    }
    if (out.length === 0) return text
    if (last < text.length) out.push(text.slice(last))
    return out
  }
  // No name list: colour a leading "@FirstName [LastName]" (1-2 capitalised
  // words) so mentions still read as mentions.
  const m = text.match(/^@[\p{Lu}][\p{L}'’-]*(?:\s[\p{Lu}][\p{L}'’-]*)?/u)
  if (!m) return text
  return [
    <span key="m" className={cls}>
      {m[0]}
    </span>,
    text.slice(m[0].length),
  ]
}

/** Every attachment is fetched through the Hub's server-side proxy (keeps the
 *  Trengo token off the client, dodges CORS/CSP + signed-URL expiry). */
function mediaProxyUrl(url: string): string {
  return `/api/inbox/media?url=${encodeURIComponent(url)}`
}

/** Inline media/file rendering for a chat message — photos, videos, voice
 *  memos, and generic files, replacing Trengo's "Image"/"Video" placeholder
 *  text. Roy 2026-07-30. */
function MessageAttachments({
  attachments,
  tone,
}: {
  attachments: ChatAttachment[]
  /** Match the surrounding bubble so the file chip stays legible. */
  tone: "light" | "dark"
}) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {attachments.map((a, i) => {
        const src = mediaProxyUrl(a.url)
        const label = a.name?.trim() || "Bestand"
        if (a.kind === "image") {
          return (
            <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={label}
                loading="lazy"
                className="max-h-72 max-w-full rounded-lg border border-border/60 object-cover"
              />
            </a>
          )
        }
        if (a.kind === "video") {
          return (
            <video
              key={i}
              src={src}
              controls
              preload="metadata"
              className="max-h-72 max-w-full rounded-lg border border-border/60"
            />
          )
        }
        if (a.kind === "audio") {
          return <audio key={i} src={src} controls preload="metadata" className="w-full max-w-[300px]" />
        }
        return (
          <a
            key={i}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            download={label}
            className={cn(
              "inline-flex max-w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
              tone === "dark"
                ? "border-primary-foreground/25 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
                : "border-border bg-muted/50 text-foreground hover:bg-muted",
            )}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </a>
        )
      })}
    </div>
  )
}

function MessageBubble({
  msg,
  isEmailThread,
  mentionNames = [],
  noteMentions,
  onMakeTask,
  onForward,
  onCollapse,
}: {
  msg: ChatMessage
  mentionNames?: string[]
  noteMentions?: NoteMentions
  /** Forward this email (email card header button). */
  onForward?: () => void
  /** When set, the email card shows a collapse chevron to fold it back into a
   *  one-line row (older messages in a Trengo-style email thread). */
  onCollapse?: () => void
  /** When the parent thread is an email channel, every message renders
   *  in the Gmail-style EmailMessageCard layout (full-width card,
   *  prominent sender header, iframe body if HTML is available, paragraph-
   *  preserving plain text otherwise). Chat bubbles are for WhatsApp /
   *  Slack only - emails need to look like emails, not WhatsApp chat
   *  (Roy 2026-06-13). Internal team notes always stay on the bubble
   *  path so the yellow team-only signal is preserved. */
  isEmailThread?: boolean
  /** When defined, a hover-revealed "Make task" button appears next to the
   *  bubble. Closes the Phase D loop: any inbox message can become an
   *  actionable task in one click. Hidden when the thread isn't linked to
   *  a client yet (we'd have no place to attach the task to). */
  onMakeTask?: () => void
}) {
  const locale = useLocale()
  const isUs = msg.authorKind === "rl_team"
  const isInternal = msg.isInternal === true
  // Email rendering branch - any message in an email thread (or any
  // message that carries an HTML body, e.g. a forwarded HTML chunk in
  // a different channel) renders as a full-width email card. Internal
  // team notes stay on the bubble path so the yellow team-only signal
  // is preserved.
  if ((isEmailThread || msg.bodyHtml) && !isInternal) {
    return (
      <div className="group flex items-stretch gap-2">
        {isUs && onMakeTask && (
          <MakeTaskInlineButton onClick={onMakeTask} />
        )}
        <EmailMessageCard msg={msg} isUs={isUs} onForward={onForward} onCollapse={onCollapse} />
        {!isUs && onMakeTask && (
          <MakeTaskInlineButton onClick={onMakeTask} />
        )}
      </div>
    )
  }
  // Internal team notes: Monday-style attributed row. The creator's photo
  // sits on the LEFT so anyone reading the thread sees at a glance "this is
  // a team note Roy made" - the whole point of an internal note is who
  // flagged what. Amber tint keeps the team-only signal. Automated Trengo
  // notes (AI Summary / AI Note / Trengo) get a Sparkles system avatar instead
  // of contact initials so they never read as if the customer wrote them
  // (Roy 2026-07-16).
  if (isInternal) {
    const isBotNote = /^(AI Summary|AI Note|Trengo)$/i.test(msg.authorName.trim())
    // Does this note carry an @-mention for the current user? If so it gets a
    // prominent on-note checkbox to tick off just this notification (never the
    // ticket). Keyed by the note's Trengo message id. Roy 2026-07-16.
    const noteMsgId = msg.sourceMsgId?.match(/^trengo:msg:(\d+)$/)?.[1] ?? null
    const hasMention =
      noteMsgId != null && noteMentions != null && noteMsgId in noteMentions.done
    const mentionDone = hasMention ? noteMentions!.done[noteMsgId!] : false
    return (
      <div className="group flex items-start gap-3">
        {isBotNote ? (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/25 text-amber-600 dark:text-amber-400">
            <Sparkles className="h-4 w-4" />
          </div>
        ) : (
          <UserAvatar
            name={msg.authorName}
            avatarUrl={msg.authorAvatarUrl}
            className="mt-0.5 shrink-0"
          />
        )}
        {/* Full-width amber card with a left accent bar so an internal note
            never gets lost between big email cards - Roy 2026-07-16: "maak hem
            groter en opvallender." */}
        <div
          className={cn(
            "min-w-0 flex-1 rounded-xl border border-amber-400/50 border-l-4 border-l-amber-500 bg-amber-400/[0.18] px-4 py-3 text-foreground shadow-sm transition-opacity",
            mentionDone && "opacity-60",
          )}
        >
          <div className="mb-1.5 flex items-center gap-2">
            {hasMention ? (
              // The current user is tagged → interactive check to tick off their
              // own notification (full opacity = "this one's for me"). On the
              // LEFT of the note, Trengo-style. Roy 2026-07-30.
              <button
                type="button"
                role="checkbox"
                aria-checked={mentionDone}
                onClick={() => noteMentions!.toggle(noteMsgId!)}
                title={mentionDone ? t("inbox.chat.mention_unresolve_title", locale) : t("inbox.chat.mention_check_title", locale)}
                aria-label={mentionDone ? t("inbox.chat.mention_done_aria", locale) : t("inbox.chat.mention_check_title", locale)}
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 shadow-sm transition-colors",
                  mentionDone
                    ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600"
                    : "border-amber-500/60 bg-card text-transparent hover:border-emerald-500 hover:text-emerald-500/50",
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </button>
            ) : msg.noteMention ? (
              // Someone else is tagged → read-only, FADED indicator so you can
              // still see whether they've handled it (green = done). Roy 2026-07-30.
              <span
                aria-label={`${msg.noteMention.names.join(", ")} — ${msg.noteMention.allDone ? "afgehandeld" : "nog open"}`}
                title={`${msg.noteMention.names.join(", ")} — ${msg.noteMention.allDone ? "afgehandeld" : "nog open"}`}
                className={cn(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 opacity-45",
                  msg.noteMention.allDone
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-amber-500/50 bg-card text-transparent",
                )}
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              </span>
            ) : null}
            <span className="text-sm font-semibold">{msg.authorName}</span>
            <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {t("inbox.chat.tab_internal", locale)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
              {fmtTime(msg.at)}
            </span>
          </div>
          {msg.body && (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
              {renderMentions(msg.body, mentionNames)}
            </p>
          )}
          <MessageAttachments attachments={msg.attachments} tone="light" />
        </div>
        {onMakeTask && <MakeTaskInlineButton onClick={onMakeTask} />}
      </div>
    )
  }

  // Regular WhatsApp / Slack chat bubbles (customer-visible).
  return (
    <div className={cn("group flex items-center gap-2", isUs ? "justify-end" : "justify-start")}>
      {/* On outgoing bubbles the make-task button sits on the LEFT of the
          bubble so it doesn't shove off-screen on narrow viewports. */}
      {isUs && onMakeTask && (
        <MakeTaskInlineButton onClick={onMakeTask} />
      )}
      <div
        className={cn(
          // 187N chat bubble: rounded with a small tail corner (bottom-right for
          // our sends, bottom-left for theirs), soft shadow. Roy 2026-07-24.
          "min-w-0 max-w-[75%] rounded-2xl px-3.5 py-2.5",
          isInternal
            ? "rounded-bl-md border border-amber-500/30 bg-amber-500/15 text-foreground shadow-sm"
            : isUs
              ? "rounded-br-md bg-primary text-primary-foreground shadow-md shadow-primary/30"
              : "rounded-bl-md border border-border bg-card shadow-sm",
        )}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold">{msg.authorName}</span>
          {isInternal && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-400">
              {t("inbox.chat.internal_badge", locale)}
            </span>
          )}
          <span
            className={cn(
              "font-mono text-[10px] tabular-nums",
              isInternal
                ? "text-muted-foreground/60"
                : isUs
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground/60",
            )}
          >
            {fmtTime(msg.at)}
          </span>
        </div>
        {msg.body && (
          <p className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed">{renderMentions(msg.body, mentionNames)}</p>
        )}
        <MessageAttachments attachments={msg.attachments} tone={isUs ? "dark" : "light"} />
      </div>
      {!isUs && onMakeTask && (
        <MakeTaskInlineButton onClick={onMakeTask} />
      )}
    </div>
  )
}

/**
 * Full-width email card with a sandboxed iframe body. Renders the raw
 * HTML the way an email client would - paragraphs, images, links -
 * instead of the stripped plain-text bubble. Roy 2026-06-13: emails
 * need to look like emails, not WhatsApp chat. Gmail-style header
 * (avatar circle + sender name in bold + to-line below + date right-
 * aligned) sits above the body; the body itself uses the iframe
 * render path when bodyHtml is present, and falls back to paragraph-
 * preserving plain text otherwise so even legacy rows ingested
 * before the body_html column existed don't render as one wall.
 *
 * Iframe safety: `sandbox="allow-same-origin"` (no allow-scripts).
 * Scripts inside the email are blocked; same-origin is set so the
 * parent can read `contentDocument` to measure the rendered height
 * and resize the iframe to fit. External resources (images, fonts,
 * etc.) load straight from the email's own URLs - we don't proxy.
 */
function EmailMessageCard({
  msg,
  isUs,
  onForward,
  onCollapse,
}: {
  msg: ChatMessage
  isUs: boolean
  onForward?: () => void
  onCollapse?: () => void
}) {
  const locale = useLocale()
  const [height, setHeight] = useState<number>(140)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  function measure() {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc) return
      const h = doc.documentElement.scrollHeight
      if (h > 0 && Math.abs(h - height) > 4) setHeight(h)
    } catch {
      // Same-origin access blocked by some browsers when iframe is
      // sandboxed without allow-same-origin. Fall back to current
      // height; the user can still scroll inside the iframe.
    }
  }

  // Re-measure on load + after every image inside the iframe resolves.
  // Email bodies routinely load 5-15 external images, each of which
  // pushes the content height. Without this, the iframe stays sized
  // for the empty layout and the bottom 80% of the mail is hidden
  // behind a scroll bar inside the iframe. Roy 2026-06-13.
  function handleLoad() {
    measure()
    const iframe = iframeRef.current
    if (!iframe) return
    let cancelled = false
    try {
      const doc = iframe.contentDocument
      if (!doc) return
      const images = Array.from(doc.querySelectorAll("img"))
      for (const img of images) {
        if (img.complete) continue
        img.addEventListener("load", measure, { once: true })
        img.addEventListener("error", measure, { once: true })
      }
      // Polling backup for things that don't fire image-load
      // (background-images via inline CSS, web fonts shifting
      // baselines). 4 seconds is enough for the dominant case;
      // longer-running async stays scrollable in-iframe.
      const timer = setInterval(() => {
        if (cancelled) return
        measure()
      }, 200)
      setTimeout(() => {
        cancelled = true
        clearInterval(timer)
      }, 4000)
    } catch {
      // Same-origin access denied - polling alone won't help. Skip.
    }
  }

  // Wrap the email body in a minimal document shell so emails that
  // expect viewport-rules / image-max-width behave reasonably inside
  // the constrained iframe. Inline styles cap images at 100% width and
  // give body sensible system fonts so plaintext-ish wrappers don't
  // look ridiculous either.
  const srcDoc = msg.bodyHtml
    ? `<!doctype html>
<html><head><meta charset="utf-8">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    color: #1a1a1a;
    line-height: 1.55;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    padding: 14px 16px;
  }
  p { margin: 0 0 10px; }
  img { max-width: 100% !important; height: auto !important; }
  a { color: #6d28d9; }
  table { max-width: 100% !important; }
  blockquote { border-left: 3px solid #e4e4e7; padding-left: 12px; color: #525252; margin: 8px 0 8px 4px; }
</style>
</head><body>${msg.bodyHtml}</body></html>`
    : null

  return (
    <div className="flex-1 min-w-0 rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
      {/* Subject bar - prominent at the top of the card so the AM sees
          "Bevestiging van je reservering ONUTYA" before anything else.
          Hidden when Trengo didn't ship a subject (legacy rows + non-
          email channels that slipped through). */}
      {msg.emailSubject && (
        <div className="px-4 pt-3.5 pb-2 bg-card">
          <h3 className="text-sm font-semibold text-foreground leading-snug break-words">
            {msg.emailSubject}
          </h3>
        </div>
      )}
      {/* Email header — full-width, neutral background. Roy 2026-06-13:
          "geen WhatsApp-bubble-uitlijning". Avatar circle + author block
          on the left, timestamp on the right. */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border/40 bg-muted/20">
        {/* Photo of the sender (your face on mails you sent) with a
            colour-coded initial fallback: ours = purple, customer = green. */}
        <UserAvatar
          name={msg.authorName}
          avatarUrl={msg.authorAvatarUrl}
          className="size-9 shrink-0"
          fallbackClassName={cn(
            "text-sm font-semibold",
            isUs
              ? "bg-primary/15 text-primary"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {msg.authorName}
            </span>
            {isUs && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {t("inbox.chat.sent", locale)}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground/70 truncate">
            {msg.emailFromAddress ? (
              <>
                <span className="font-mono">{msg.emailFromAddress}</span>
                {" · "}
                {isUs ? "from you" : "to you"}
              </>
            ) : (
              isUs ? "From you" : "To you"
            )}
          </div>
        </div>
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60 shrink-0 mt-0.5">
          {fmtTime(msg.at)}
        </span>
        {/* Forward — opens the composer in forward mode with this email quoted
            below. Roy 2026-07-28. */}
        {onForward && (
          <button
            type="button"
            onClick={onForward}
            aria-label="Forward"
            title="Forward"
            className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground/70"
          >
            <Forward className="h-4 w-4" />
          </button>
        )}
        {/* Collapse chevron — folds an older email back into its one-line row.
            Only on foldable (older) emails; the latest stays open. */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse"
            className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-foreground/70"
          >
            <ChevronDown className="h-4 w-4 rotate-180" />
          </button>
        )}
      </div>
      {/* Body — iframe when we have the raw HTML (real email layout
          with images + tables + links), otherwise paragraph-preserving
          plain text in a styled prose block so older rows still read
          properly. */}
      {srcDoc ? (
        <iframe
          ref={iframeRef}
          title={`Email from ${msg.authorName}`}
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-popups"
          onLoad={handleLoad}
          style={{ width: "100%", height, border: "none", display: "block", background: "#fff" }}
        />
      ) : (
        <div className="px-4 py-3.5 bg-background text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {msg.body || (
            <span className="italic text-muted-foreground/60">No body content.</span>
          )}
        </div>
      )}
      {msg.attachments.length > 0 && (
        <div className="border-t border-border/40 px-4 py-3">
          <MessageAttachments attachments={msg.attachments} tone="light" />
        </div>
      )}
    </div>
  )
}

/** Hover-revealed pill button next to each chat bubble. Pre-fills the
 *  composer with this message's body so the AM only has to confirm + pick
 *  a due date. Subtle by default; sharpens on hover/focus. */
function MakeTaskInlineButton({ onClick }: { onClick: () => void }) {
  const locale = useLocale()
  return (
    <button
      type="button"
      onClick={onClick}
      title={t("inbox.chat.make_task", locale)}
      aria-label={t("inbox.chat.make_task", locale)}
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-7 px-2 inline-flex items-center gap-1 rounded-md border border-border bg-popover text-[11px] font-medium text-muted-foreground hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-500/40 shadow-sm shrink-0"
    >
      <ListTodo className="h-3.5 w-3.5" />
      {t("inbox.card.kind.task", locale)}
    </button>
  )
}

/** Prominent emerald "afvink" button in the chat-pane header, matching
 *  the internal inbox's Done action (inbox-list-row.tsx ~L475). Always
 *  shows the green check — unread threads make the button solid so the
 *  AM has an obvious "wegwerken"-target; read threads dim it to a muted
 *  outline so it's still clickable to mark-back-as-unread without
 *  dominating the header. Roy 2026-06-16: empty box was confusing, the
 *  channel rows lost their inline check button so this is now the only
 *  surface for the action. */
function ReadCheckbox({
  isUnread,
  onToggle,
}: {
  isUnread: boolean
  onToggle: () => void
}) {
  const locale = useLocale()
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!isUnread}
      onClick={onToggle}
      title={isUnread ? t("inbox.chat.mark_read_msg", locale) : t("inbox.chat.mark_unread_msg", locale)}
      aria-label={isUnread ? t("inbox.chat.mark_read_msg", locale) : t("inbox.chat.mark_unread_msg", locale)}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded-md border-2 transition-colors shrink-0 shadow-sm",
        isUnread
          ? "border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 hover:border-emerald-500 hover:bg-emerald-500/20 dark:text-emerald-400",
      )}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </button>
  )
}

/** Channel icon for Client Inbox rows. For Trengo we differentiate WhatsApp
 *  (brand-green logo) vs email (blue mail) vs other Trengo channels (cyan
 *  chat) so it's instantly clear which medium a thread came in on - Roy's
 *  spec. Slack and Monday keep their existing single-icon treatment. */
export function SourceIcon({ thread }: { thread: ChatThreadSummary }) {
  if (thread.source === "trengo") {
    if (thread.channelKind === "whatsapp") {
      return (
        <Image
          src="/logos/brands/whatsapp.svg"
          alt=""
          width={14}
          height={14}
          className="h-3.5 w-3.5 shrink-0 object-contain"
          unoptimized
        />
      )
    }
    if (thread.channelKind === "email") {
      return <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
    }
    return <MessageSquare className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
  }
  if (thread.source === "slack")
    return <Hash className="h-3.5 w-3.5 text-purple-500 shrink-0" />
  if (thread.source === "monday")
    return <LayoutGrid className="h-3.5 w-3.5 text-orange-500 shrink-0" />
  return null
}

/** Compact text badge showing the channel medium. Sits next to the icon in
 *  the row + header so users can see "WhatsApp" / "Email" without hovering. */
export function ChannelBadge({ thread }: { thread: ChatThreadSummary }) {
  if (thread.source !== "trengo" || !thread.channelKind || thread.channelKind === "other") {
    return null
  }
  const label = thread.channelKind === "whatsapp" ? "WhatsApp" : "Email"
  // 187N mono micro-caps tag. Tone still colours the text (WhatsApp = green
  // "live", email = purple "brand") but the leading status dot is dropped -
  // it didn't align cleanly next to the channel icon + title. Roy 2026-07-28.
  const tone = thread.channelKind === "whatsapp" ? "live" : "brand"
  return (
    <span className={`st-label ${tone} shrink-0`}>
      {label}
    </span>
  )
}

// --- Date helpers --------------------------------------------------------

export function fmtRelative(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return "now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.round(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Per-scope localStorage-backed filter state. Mirrors the `usePersistedState`
 *  pattern used in inbox-view.tsx (kept inline here so chat-pane stays
 *  self-contained - when there's a third caller this should become a shared
 *  hook in src/lib). Falls back to "all" if storage is blocked or the
 *  persisted JSON is corrupt. */
function usePersistedChatFilter(scope: ChatScope): [ChatFilter, (v: ChatFilter) => void] {
  // v3 key - "Read" filter removed entirely, default flipped back to
  // "unread" so the AM lands on what still needs action. Bumping resets
  // returning users carrying a stale "read" choice from v2.
  const key = `inbox.chatFilter.v3.${scope}`
  const [value, setValue] = useState<ChatFilter>("unread")
  const hydratedRef = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) {
        const parsed = JSON.parse(raw) as ChatFilter
        if (parsed === "all" || parsed === "unread") {
          setValue(parsed)
        }
      }
    } catch {
      // bad JSON or storage unavailable - stick with the default
    }
    hydratedRef.current = true
  }, [key])

  useEffect(() => {
    if (!hydratedRef.current) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore - full storage shouldn't break the UI
    }
  }, [key, value])

  return [value, setValue]
}

/**
 * Diagnostic banner - Roy 2026-06-09: surfaces "as whom does this user
 * actually send in Trengo" + "which channels are they subscribed to".
 *
 * Three problem states get a visible warning row above the thread list:
 *   1. Personal Trengo token not connected → can't send as self. Clear
 *      CTA to /account.
 *   2. Token connected but Trengo /me 401/4xx → token was revoked or
 *      pasted wrong. Same CTA: re-connect.
 *   3. Channel subscriptions missing email entries → explains the
 *      "I see no emails in my inbox" complaint. CTA to /account to
 *      pick the right channels.
 *
 * Healthy state shows a subtle "Sending as <name>" pill so the user
 * knows their identity is wired through. No banner when both halves
 * (token + channels) are fully healthy.
 */
function TrengoIdentityBanner() {
  const locale = useLocale()
  const { data } = useQuery<TrengoIdentity>({
    queryKey: ["trengo-identity"],
    queryFn: () => fetch("/api/inbox/trengo-identity").then((r) => r.json()),
    // Identity rarely changes mid-session; once a minute is plenty.
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
  })

  if (!data) return null

  // --- Problem states (red/amber banners) ---------------------------------

  if (!data.connected) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500" />
        <div className="flex-1">
          <p className="font-medium text-amber-700 dark:text-amber-400">
            {t("inbox.chat.trengo_not_connected_title", locale)}
          </p>
          <p className="text-muted-foreground/80 mt-0.5">
            {t("inbox.chat.trengo_not_connected_body", locale)}{" "}
            <Link href="/account" className="text-primary underline hover:no-underline">
              {t("inbox.chat.trengo_connect_cta", locale)}
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  if (data.error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-500" />
        <div className="flex-1">
          <p className="font-medium text-red-700 dark:text-red-400">
            {t("inbox.chat.trengo_token_broken_title", locale)}
          </p>
          <p className="text-muted-foreground/80 mt-0.5">
            {data.error}.{" "}
            <Link href="/account" className="text-primary underline hover:no-underline">
              {t("inbox.chat.trengo_refresh_cta", locale)}
            </Link>
            .
          </p>
        </div>
      </div>
    )
  }

  // --- Channel coverage warning (mild, doesn't block sends) ---------------
  // Roy 2026-06-09: the green "Verstuurt vanuit Trengo als <name>" pill was
  // removed - once Trengo is wired, no news is good news. Only the
  // actionable missing-channel warning survives so the "where are my emails?"
  // failure mode still has a CTA.

  const missingChannelTypes: string[] = []
  if (!data.hasEmail) missingChannelTypes.push("Email")
  if (!data.hasWhatsapp) missingChannelTypes.push("WhatsApp")

  if (missingChannelTypes.length === 0) return null

  return (
    <Link
      href="/account"
      className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400 hover:underline"
      title={t("inbox.chat.channel_warning", locale, { types: missingChannelTypes.join(" + ") })}
    >
      <AlertTriangle className="h-3 w-3" />
      {t("inbox.chat.channel_missing_link", locale, { types: missingChannelTypes.join(" / ") })}
    </Link>
  )
}
