"use client"

import { useState, useEffect, useRef, useMemo } from "react"
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
} from "lucide-react"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { Button } from "@/components/ui/button"
import { DismissButton } from "@/components/ui/dismiss-button"
import { cn } from "@/lib/utils"
import { TopTabs, type TopTab } from "@/components/ui/top-tabs"
import type { ChatScope, ChatThreadSummary, ChatMessage } from "@/lib/inbox/fetchers"
import type { InboxUser } from "./inbox-view"
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

type MarkAction = "mark_read" | "mark_unread"
// Roy 2026-06-09: "Read" filter dropped. The Client Inbox AM only ever
// wants "what's still red" (unread) and "everything" - a Read-only
// filter was never the anchor view. Same minimalism as the Updates
// strip in inbox-view.
type ChatFilter = "all" | "unread"

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
  const tabCounts = useMemo(() => {
    let unread = 0
    for (const t of threads) if (t.unreadCount > 0) unread += 1
    return { all: threads.length, unread }
  }, [threads])

  const filteredThreads = useMemo(() => {
    const base = filter === "all" ? threads : threads.filter((t) => t.unreadCount > 0)
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

  /** Optimistically flip a thread's unread state and PATCH the server.
   *  On failure we invalidate so the server's authoritative state wins.
   *  When the user marks the currently-open thread as read, also advance
   *  to the next unread thread (or land on the inbox-zero empty state
   *  if there is none) - Roy 2026-06-12. */
  function markThread(thread: ChatThreadSummary, action: MarkAction) {
    const optimisticUnread = action === "mark_read" ? 0 : Math.max(thread.unreadCount, 1)
    queryClient.setQueryData<{ threads: ChatThreadSummary[] }>(
      ["inbox-threads", scope],
      (prev) => {
        if (!prev) return prev
        return {
          threads: prev.threads.map((t) =>
            t.threadKey === thread.threadKey ? { ...t, unreadCount: optimisticUnread } : t,
          ),
        }
      },
    )

    // Advance when the user closed the OPEN ticket via mark-read. Bulk
    // marks and list-row clicks (if either is ever re-added) deliberately
    // skip this so they don't yank the selection out from under the user.
    if (
      action === "mark_read" &&
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
      body: JSON.stringify({ action }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${action} failed (${res.status})`)
        queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
        queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      })
      .catch((e) => {
        console.error("Failed to update thread read state", e)
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
    // RIGHT (scan-everything fallback) - mirrors the Tasks + Updates
    // strips so the chip positions feel consistent across tabs.
    { id: "unread", label: "Unread", icon: Mail, count: tabCounts.unread },
    { id: "all", label: "All conversations", icon: LayoutList, count: tabCounts.all },
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
          "grid grid-cols-1 h-[calc(100vh-280px)] min-h-[500px]",
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
  onMarkThread: (thread: ChatThreadSummary, action: MarkAction) => void
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
  if (loading) {
    return (
      <div className={cn("border border-border bg-card shadow-sm flex items-center justify-center py-12", wrapperClass)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (threads.length === 0) {
    // Filtered-empty messaging shifts based on which tab the user is on so
    // "0 unread" doesn't look like a sync failure when they're on Unread mode.
    const baseCopy =
      scope === "external" ? "client conversations" : "team conversations"
    const empty =
      filter === "unread"
        ? `No unread ${baseCopy}.`
        : scope === "external"
          ? "No client conversations yet."
          : "No team conversations yet."
    const sub =
      filter === "all"
        ? scope === "external"
          ? "Trengo messages will appear here once webhooks fire."
          : "Slack messages will appear here once webhooks fire."
        : "Try switching tabs to see other conversations."
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
              {selectedKeys.size} selected
            </span>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {threads.length} {threads.length === 1 ? "conversation" : "conversations"}
            </span>
          )}
        </div>
        {anySelected && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
          >
            Clear
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
              onMark={(action) => onMarkThread(thread, action)}
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
  onMark: (action: MarkAction) => void
}) {
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
          title={isChecked ? "Deselect" : "Select for bulk action"}
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
      </div>
    </div>
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
          <span className="text-[10px] text-muted-foreground/60 shrink-0">
            · {fmtRelative(thread.latestAt)}
          </span>
        </div>
        {thread.unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums shrink-0">
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
          <span className="italic text-muted-foreground/60">No subject</span>
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
        {thread.unreadCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
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
        {thread.latestPreview || <span className="italic">No preview</span>}
      </p>
      <p className="text-[10px] text-muted-foreground/50 mt-0.5">
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
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-full border border-border bg-popover shadow-lg px-2 py-1.5">
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={() => onMark("mark_read")}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
        title="Mark selected conversations as read"
      >
        <CheckCheck className="h-3.5 w-3.5" />
        Mark read
      </button>
      <button
        type="button"
        onClick={() => onMark("mark_unread")}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-primary/10 hover:text-primary transition-colors"
        title="Mark selected conversations as unread"
      >
        <MailOpen className="h-3.5 w-3.5" />
        Mark unread
      </button>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title="Clear selection"
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
        title="Voeg Pedro's huidige concept-bericht toe aan de reply"
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
        Pedro draft
      </button>
      {error && (
        <span className="text-[11px] text-muted-foreground/70">{error}</span>
      )}
    </div>
  )
}

/** Renders the selected thread's messages + composer in a self-contained
 *  card. Pass `thread=null` to show the "Select a conversation" placeholder.
 *  `mergedLeftEdge` drops the left border-radius so this panel can sit
 *  flush against the ThreadList on the 50/50 docked-detail layout. */
export function ThreadView({
  thread,
  onReplied,
  users,
  onMakeTaskFromMessage,
  onMarkThread,
  inboxZero,
  mergedLeftEdge,
}: {
  thread: ChatThreadSummary | null
  onReplied: () => void
  users?: InboxUser[]
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  /** Mark-read/unread toggle. Lives on the open-conversation header
   *  (Roy 2026-06-12) instead of the list-row affordance it used to be -
   *  the action lives where the user is actually reading. */
  onMarkThread?: (thread: ChatThreadSummary, action: MarkAction) => void
  /** True when the user just cleared the inbox via mark-read and no
   *  more unread threads remain - swaps the neutral "Select a
   *  conversation" placeholder for a celebratory all-caught-up state. */
  inboxZero?: boolean
  mergedLeftEdge?: boolean
}) {
  const wrapperRadius = mergedLeftEdge ? "rounded-r-xl rounded-l-none border-l-0" : "rounded-xl"
  if (!thread) {
    if (inboxZero) {
      return (
        <div className={cn("h-full border border-border bg-card shadow-sm flex flex-col items-center justify-center gap-3 text-center px-6", wrapperRadius)}>
          <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
            <CheckCheck className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Je inbox is volledig up-to-date</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Alle tickets bijgewerkt. Lekker bezig.</p>
          </div>
        </div>
      )
    }
    return (
      <div className={cn("h-full border border-border bg-card shadow-sm flex items-center justify-center text-sm text-muted-foreground/60", wrapperRadius)}>
        Select a conversation
      </div>
    )
  }

  return <ThreadMessages thread={thread} onReplied={onReplied} users={users} onMakeTaskFromMessage={onMakeTaskFromMessage} onMarkThread={onMarkThread} mergedLeftEdge={mergedLeftEdge} />
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
  users,
  onMakeTaskFromMessage,
  onMarkThread,
  mergedLeftEdge,
}: {
  thread: ChatThreadSummary
  onReplied: () => void
  users?: InboxUser[]
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
  onMarkThread?: (thread: ChatThreadSummary, action: MarkAction) => void
  mergedLeftEdge?: boolean
}) {
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
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
  // @-mention picker state (only active in internal-note mode).
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionHighlight, setMentionHighlight] = useState(0)

  const messagesQuery = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ["inbox-thread", thread.threadKey],
    queryFn: () =>
      fetch(`/api/inbox/threads/${encodeURIComponent(thread.threadKey)}`).then((r) =>
        r.json(),
      ),
    // Mirror the thread-list polling cadence so an open thread also picks up
    // newly-delivered Trengo messages without needing a manual refresh.
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
  })

  const messages = useMemo(
    () => messagesQuery.data?.messages ?? [],
    [messagesQuery.data?.messages],
  )

  // Scroll to bottom on load + on new message arrivals.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [thread.threadKey, messages.length])

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

  // Filter the team list by the current @-mention query, excluding nobody
  // by default (the chat-pane doesn't know who the actor is in this scope).
  const mentionMatches = (() => {
    if (!users || mentionStart == null) return []
    const q = mentionQuery.trim().toLowerCase()
    return users
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

  function applyMention(user: InboxUser) {
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
      const payload: Record<string, unknown> = {
        internalNote: isInternal,
      }
      if (sendingTemplate && selectedTemplate) {
        payload.template = {
          name: selectedTemplate.slug || selectedTemplate.title,
          language: selectedTemplate.language,
          params: templateParams,
          body: selectedTemplate.message,
        }
        // Templates can't carry text or attachments - Trengo / Meta limit.
      } else if (sendingEmail) {
        // Plain-text fallback derived from the HTML so email clients that
        // strip HTML still see something readable. Trengo also generates
        // its own plain text but having a hand-derived one in `message`
        // costs nothing.
        const plain = htmlToPlain(emailHtml)
        payload.message = plain
        payload.attachmentIds = attachments.map((a) => a.id)
        payload.email = {
          subject: emailSubject || undefined,
          cc: emailCc,
          bcc: emailBcc,
          html: emailHtml,
        }
      } else {
        payload.message = trimmed
        payload.attachmentIds = attachments.map((a) => a.id)
      }
      const res = await fetch(`/api/inbox/${thread.latestEventId}/reply`, {
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

  return (
    <div
      className={cn(
        "h-full border border-border bg-card shadow-sm flex flex-col overflow-hidden",
        mergedLeftEdge ? "rounded-r-xl rounded-l-none border-l-0" : "rounded-xl",
      )}
    >
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center justify-between gap-3 bg-muted/20 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <SourceIcon thread={thread} />
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
            <ChannelBadge thread={thread} />
          </div>
          {(thread.clientName || thread.channelName) && (
            <p className="text-[11px] text-muted-foreground/70 truncate">
              {thread.clientName
                ? thread.channelName
                  ? `${thread.clientName} · via ${thread.channelName}`
                  : thread.clientName
                : `via ${thread.channelName}`}
              {thread.totalCount > 0 && (
                <span className="ml-1.5 text-muted-foreground/50 tabular-nums">
                  · {thread.totalCount}{" "}
                  {thread.totalCount === 1 ? "message" : "messages"}
                </span>
              )}
            </p>
          )}
          {/* Unlinked threads (Trengo contact has no matching Hub client)
              get an inline "Link to client" picker so the AM can attach
              the conversation without leaving the inbox. Hidden once a
              link exists or for non-Trengo sources. */}
          {!thread.clientName && thread.source === "trengo" && (
            <LinkToClientPicker
              threadKey={thread.threadKey}
              onLinked={() => {
                queryClient.invalidateQueries({ queryKey: ["inbox-threads"] })
                queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
              }}
            />
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
          {/* Mark-read toggle. Same chrome as the Internal Tasks "done"
              action (ActionIconButton success-tone) so the inbox feels
              uniform - per Roy 2026-06-12: "in dezelfde stijl als de
              internal inbox, dezelfde kleur als het huidige vinkje".
              Only renders when the parent passes onMarkThread (i.e.
              ChatPane mode, not the docked-detail variant which has
              its own surface for the action). */}
          {onMarkThread && (
            <ActionIconButton
              tone="success"
              label={
                thread.unreadCount > 0
                  ? "Markeer als gelezen"
                  : "Markeer als ongelezen"
              }
              icon={
                thread.unreadCount > 0 ? (
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                ) : (
                  <Mail className="h-4 w-4" />
                )
              }
              onClick={() =>
                onMarkThread(
                  thread,
                  thread.unreadCount > 0 ? "mark_read" : "mark_unread",
                )
              }
            />
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-background/40">
        {messagesQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No messages in this thread.
          </p>
        ) : (
          <ThreadMessagesList
            messages={messages}
            isEmailThread={isEmail}
            clientId={thread.clientId}
            onMakeTaskFromMessage={onMakeTaskFromMessage}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Email composer rail. When closed, the chat pane gets the full
          vertical space back so the conversation is actually readable -
          for a quoted-history-laden email thread the always-on composer
          ate half the viewport. Tap "Reply" to expand into the full
          composer below. Roy 2026-06-12. */}
      {replyable && isEmail && !emailComposerOpen && (
        <div className="border-t border-border bg-muted/20 px-3 py-2 shrink-0 flex items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={() => setEmailComposerOpen(true)}
            className="gap-1.5"
          >
            <Mail className="h-3.5 w-3.5" />
            Reply
          </Button>
        </div>
      )}

      {/* Reply box. Drag-drop handlers moved up here from the textarea row
          so dropping ANYWHERE in the composer area uploads the file -
          particularly useful for email mode (no visible textarea) and
          template mode (textarea hidden). */}
      {replyable && (!isEmail || emailComposerOpen) && (
        <div
          className={cn(
            "border-t border-border p-3 transition-colors shrink-0 relative",
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
                <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setComposerMode("reply")}
                    className={cn(
                      "px-4 h-8 rounded-md text-xs font-medium transition-colors",
                      composerMode === "reply"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposerMode("internal")}
                    className={cn(
                      "px-4 h-8 rounded-md text-xs font-medium transition-colors",
                      composerMode === "internal"
                        ? "bg-amber-500 text-amber-950 shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                    title="Team-only note - invisible to the client; @-mention to ping a teammate"
                  >
                    Internal note
                  </button>
                </div>
              ) : (
                <span />
              )}
              {isEmail && (
                <DismissButton
                  size="xs"
                  label="Sluit composer"
                  onClick={() => setEmailComposerOpen(false)}
                />
              )}
            </div>
          )}
          {needsConnect && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
              Connect your {needsConnect} account first.{" "}
              <Link href="/settings?tab=me" className="underline font-medium">
                Go to My Account
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
                // Remount on thread switch so the TipTap editor picks up the
                // newly-restored draft body. Without this, parent setting
                // `emailHtml` from the draft cache wouldn't propagate into
                // the editor's internal state (TipTap is uncontrolled).
                key={thread.threadKey}
                channelId={thread.trengoChannelId}
                threadKey={thread.threadKey}
                toDisplay={thread.primaryName}
                subject={emailSubject}
                onSubjectChange={setEmailSubject}
                cc={emailCc}
                onCcChange={setEmailCc}
                bcc={emailBcc}
                onBccChange={setEmailBcc}
                htmlBody={emailHtml}
                onHtmlBodyChange={setEmailHtml}
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
                      title="Attach files"
                      aria-label="Attach files"
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
                      Send email
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
                    Send template
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
              onClick={(e) => {
                const ta = e.currentTarget
                syncMentionState(ta.value, ta.selectionStart ?? 0)
              }}
              placeholder={
                isInternal
                  ? "Internal note - team only. Use @ to mention a teammate."
                  : `Reply via ${thread.source} as you`
              }
              rows={6}
              disabled={sending}
              className={cn(
                "flex-1 rounded-lg border bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 resize-none",
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
                  title="Attach files"
                  aria-label="Attach files"
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
              className={cn(
                "h-10 px-5 text-sm font-medium gap-2",
                isInternal && "bg-amber-500 hover:bg-amber-600 text-amber-950",
              )}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Send
                </>
              )}
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
              Conversation window open · closes in {hoursRemaining}h
            </span>
          </>
        ) : (
          <>
            <ShieldAlert className="h-4 w-4 shrink-0" />
            <span className="truncate font-medium">
              Window closed · only WhatsApp templates can be sent
            </span>
          </>
        )}
      </span>
      <span className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shrink-0 shadow-sm">
        <button
          type="button"
          onClick={() => windowOpen && onModeChange("default")}
          disabled={!windowOpen}
          className={cn(
            "px-3 h-7 rounded text-xs font-medium transition-colors",
            mode === "default"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
            !windowOpen && "opacity-40 cursor-not-allowed",
          )}
          title={!windowOpen ? "Free-text disabled outside the 24h window" : "Default message"}
        >
          Default
        </button>
        <button
          type="button"
          onClick={() => onModeChange("template")}
          className={cn(
            "px-3 h-7 rounded text-xs font-medium transition-colors",
            mode === "template"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
          title="Send a pre-approved WhatsApp Business template"
        >
          Template
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
  return (
    <div className="rounded-md border border-border/60 bg-background p-2.5 mb-2 space-y-2">
      <label className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
        WhatsApp template
      </label>
      <div className="relative">
        <select
          value={selectedTemplate?.id ?? ""}
          onChange={(e) => {
            const id = parseInt(e.target.value, 10)
            const t = templates.find((x) => x.id === id) ?? null
            onPick(t)
          }}
          disabled={loading || templates.length === 0}
          className="w-full h-8 pl-2.5 pr-7 rounded-md border border-input bg-background text-xs appearance-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
        >
          <option value="">
            {loading
              ? "Loading templates…"
              : templates.length === 0
                ? "No approved templates for this channel"
                : "Select a template…"}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
              {t.language ? ` (${t.language})` : ""}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
      {error && (
        <p className="text-[11px] text-destructive">Failed to load templates: {error}</p>
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
                    placeholder={`Variable ${idx + 1}`}
                    className="flex-1 h-7 px-2 rounded-md border border-input bg-background text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                </div>
              ))}
            </div>
          )}
          <div className="rounded-md border border-border/40 bg-muted/30 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
              Preview
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
  const btnCls =
    "h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
  return (
    <div className="inline-flex items-center gap-0.5 mb-1.5">
      <button type="button" onClick={() => wrap("*")} title="Bold (*x*)" className={btnCls}>
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => wrap("_")} title="Italic (_x_)" className={btnCls}>
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => wrap("~")} title="Strikethrough (~x~)" className={btnCls}>
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
  if (resolved.length === 0 && !hasUnresolved) {
    return (
      <p className="text-[11px] text-muted-foreground/70 mb-2 inline-flex items-center gap-1">
        <span className="opacity-70">Type</span>
        <span className="font-mono px-1 py-0.5 rounded bg-muted text-foreground/80">@</span>
        <span className="opacity-70">to mention a teammate. They&apos;ll get an Update + push notification.</span>
      </p>
    )
  }
  return (
    <div className="mb-2 flex items-center flex-wrap gap-1.5">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mr-1">
        Will notify
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
          title="Couldn't match this @-mention to a teammate. Try typing the full name or pick from the suggestions."
        >
          ⚠ unmatched mention
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
function LinkToClientPicker({
  threadKey,
  onLinked,
}: {
  threadKey: string
  onLinked: () => void
}) {
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

  async function link(clientId: string) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/inbox/threads/${encodeURIComponent(threadKey)}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        existingClientName?: string
      }
      if (!res.ok) {
        setError(data.error ?? `Link failed (${res.status})`)
        return
      }
      setOpen(false)
      setQuery("")
      onLinked()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div ref={containerRef} className="relative mt-1.5">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[11px] font-medium hover:bg-amber-500/10"
        >
          Link to client…
        </button>
      ) : (
        <div className="rounded-md border border-border bg-popover shadow-md p-2 w-[280px] max-w-full">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            autoFocus
            className="w-full h-7 px-2 mb-1.5 rounded border border-input bg-background text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          {error && (
            <p className="text-[11px] text-destructive mb-1.5 px-1">{error}</p>
          )}
          <div className="max-h-[260px] overflow-y-auto space-y-0.5">
            {clientsQuery.isLoading ? (
              <p className="text-[11px] text-muted-foreground px-1.5 py-1">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-1.5 py-1">No matches</p>
            ) : (
              filtered.slice(0, 50).map((c) => (
                <button
                  key={c.monday_item_id}
                  type="button"
                  onClick={() => link(c.monday_item_id)}
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
      title={error ?? "Click to edit contact name"}
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
      <DismissButton size="xs" onClick={onRemove} label="Remove attachment" stopPropagation={false} />
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
function ThreadMessagesList({
  messages,
  isEmailThread,
  clientId,
  onMakeTaskFromMessage,
}: {
  messages: ChatMessage[]
  isEmailThread: boolean
  clientId: string | null
  onMakeTaskFromMessage?: (args: { clientId: string; title: string; body?: string }) => void
}) {
  const [middleExpanded, setMiddleExpanded] = useState(false)

  // Reset the middle-collapsed state whenever the thread changes -
  // the parent re-mounts ThreadMessagesList per thread switch by
  // virtue of the messages array identity changing, but the user-
  // intent reset is explicit so it survives query refetches inside
  // the same thread (which preserve identity in some edge cases).
  const firstMessageId = messages[0]?.id ?? null
  useEffect(() => {
    setMiddleExpanded(false)
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

  // Flat list for non-email threads + short email threads.
  if (!isEmailThread || messages.length <= 3) {
    return (
      <>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isEmailThread={isEmailThread}
            onMakeTask={makeTask(msg)}
          />
        ))}
      </>
    )
  }

  // Gmail-style collapse: first + last 2 expanded, middle behind a
  // toggle. Internal notes inside the middle always render so the
  // AM doesn't miss a flag (Trengo internal_note has the yellow tint
  // the rest of the Hub uses for team-only annotations).
  const first = messages[0]
  const tail = messages.slice(-2)
  const middle = messages.slice(1, -2)
  const middleInternal = middle.filter((m) => m.isInternal === true)
  const collapsedMiddle = middle.filter((m) => m.isInternal !== true)

  return (
    <>
      <MessageBubble
        msg={first}
        isEmailThread={isEmailThread}
        onMakeTask={makeTask(first)}
      />
      {!middleExpanded && collapsedMiddle.length > 0 && (
        <button
          type="button"
          onClick={() => setMiddleExpanded(true)}
          className="w-full px-4 py-2 rounded-lg border border-dashed border-border bg-muted/30 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          Show {collapsedMiddle.length} earlier message
          {collapsedMiddle.length === 1 ? "" : "s"}
        </button>
      )}
      {/* Internal notes always visible - never collapse a team flag. */}
      {!middleExpanded &&
        middleInternal.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isEmailThread={isEmailThread}
            onMakeTask={makeTask(msg)}
          />
        ))}
      {middleExpanded &&
        middle.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isEmailThread={isEmailThread}
            onMakeTask={makeTask(msg)}
          />
        ))}
      {tail.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          isEmailThread={isEmailThread}
          onMakeTask={makeTask(msg)}
        />
      ))}
    </>
  )
}

function MessageBubble({
  msg,
  isEmailThread,
  onMakeTask,
}: {
  msg: ChatMessage
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
        <EmailMessageCard msg={msg} isUs={isUs} />
        {!isUs && onMakeTask && (
          <MakeTaskInlineButton onClick={onMakeTask} />
        )}
      </div>
    )
  }
  // Internal notes get a distinct yellow tint regardless of author -
  // signals "team-only annotation, not part of the customer-visible
  // conversation." Same convention Trengo uses on their own UI.
  return (
    <div className={cn("group flex items-center gap-2", isUs ? "justify-end" : "justify-start")}>
      {/* On outgoing bubbles the make-task button sits on the LEFT of the
          bubble so it doesn't shove off-screen on narrow viewports. */}
      {isUs && onMakeTask && (
        <MakeTaskInlineButton onClick={onMakeTask} />
      )}
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2",
          isInternal
            ? "bg-amber-500/15 border border-amber-500/30 text-foreground"
            : isUs
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border/40",
        )}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold">{msg.authorName}</span>
          {isInternal && (
            <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-400">
              Internal
            </span>
          )}
          <span
            className={cn(
              "text-[10px] tabular-nums",
              isInternal
                ? "text-muted-foreground/70"
                : isUs
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground/70",
            )}
          >
            {fmtTime(msg.at)}
          </span>
        </div>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.body}</p>
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
}: {
  msg: ChatMessage
  isUs: boolean
}) {
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

  // Avatar - circle with the first letter of the sender's name. Color
  // varies by author kind so RL outgoing mails read as ours and
  // inbound as the customer's. Same convention Gmail uses when the
  // sender has no Gravatar.
  const avatarInitial = (msg.authorName ?? "?").trim().charAt(0).toUpperCase() || "?"

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
    padding: 14px 16px;
  }
  img { max-width: 100% !important; height: auto !important; }
  a { color: #6d28d9; }
  table { max-width: 100% !important; }
  blockquote { border-left: 3px solid #e4e4e7; padding-left: 12px; color: #525252; margin-left: 0; }
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
        <div className="px-4 pt-3 pb-1.5 bg-card">
          <h3 className="text-sm font-semibold text-foreground leading-snug break-words">
            {msg.emailSubject}
          </h3>
        </div>
      )}
      {/* Email header — full-width, neutral background. Roy 2026-06-13:
          "geen WhatsApp-bubble-uitlijning". Avatar circle + author block
          on the left, timestamp on the right. */}
      <div className="flex items-start gap-3 px-4 py-3 border-b border-border/40 bg-muted/20">
        <div
          className={cn(
            "h-9 w-9 shrink-0 rounded-full inline-flex items-center justify-center text-sm font-semibold",
            isUs
              ? "bg-primary/15 text-primary"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {avatarInitial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground truncate">
              {msg.authorName}
            </span>
            {isUs && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Sent
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
        <span className="text-[11px] tabular-nums text-muted-foreground/70 shrink-0 mt-0.5">
          {fmtTime(msg.at)}
        </span>
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
        <div className="px-4 py-3 bg-background text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
          {msg.body || (
            <span className="italic text-muted-foreground/60">No body content.</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Hover-revealed pill button next to each chat bubble. Pre-fills the
 *  composer with this message's body so the AM only has to confirm + pick
 *  a due date. Subtle by default; sharpens on hover/focus. */
function MakeTaskInlineButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Create task from this message"
      aria-label="Create task from this message"
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity h-7 px-2 inline-flex items-center gap-1 rounded-md border border-border bg-popover text-[11px] font-medium text-muted-foreground hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400 hover:border-violet-500/40 shadow-sm shrink-0"
    >
      <ListTodo className="h-3.5 w-3.5" />
      Task
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
  const tone =
    thread.channelKind === "whatsapp"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${tone}`}>
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
            Trengo niet gekoppeld
          </p>
          <p className="text-muted-foreground/80 mt-0.5">
            Je persoonlijke Trengo API token is niet ingesteld. Zonder dat kunnen Hub-sends niet als jou worden verstuurd.{" "}
            <Link href="/account" className="text-primary underline hover:no-underline">
              Koppel Trengo in /account
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
            Trengo token werkt niet
          </p>
          <p className="text-muted-foreground/80 mt-0.5">
            {data.error}.{" "}
            <Link href="/account" className="text-primary underline hover:no-underline">
              Vernieuw je token in /account
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
      title={`Geen ${missingChannelTypes.join(" + ")}-channel(s) geabonneerd - daarom mis je ze in de inbox`}
    >
      <AlertTriangle className="h-3 w-3" />
      Geen {missingChannelTypes.join(" / ")} channels - koppel ze in /account
    </Link>
  )
}
