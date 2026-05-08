"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Send, MessageSquare, Hash, LayoutGrid, Inbox, Mail, StickyNote, Reply as ReplyIcon, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatScope, ChatThreadSummary, ChatMessage } from "@/lib/inbox/fetchers"
import type { InboxUser } from "./inbox-view"

type Props = {
  scope: ChatScope
  /** Hub team users — drives the @-mention autocomplete in the Comment
   *  composer. Optional for callers that don't surface internal notes. */
  users?: InboxUser[]
}

/**
 * Two-pane chat view for the Team Inbox / Client Inbox tabs.
 *
 * Left: list of threads grouped by thread_key (Trengo contact, Slack DM,
 * Slack channel, etc.), most-recently-active first. Click selects.
 *
 * Right: selected thread's messages in chronological order, plus a reply box
 * at the bottom. Reply uses the existing /api/inbox/[id]/reply endpoint —
 * we pass the thread's latest event id; the helper derives source +
 * thread metadata from there.
 */
export function ChatPane({ scope, users = [] }: Props) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ChatThreadSummary | null>(null)
  // Bulk-select: a Set of threadKeys the AM has checked. Mirrors the Tasks
  // tab pattern — hover-checkbox per row + floating bottom bar with batch
  // actions ("mark all read"). Auto-pruned when threads leave the visible set.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const threadsQuery = useQuery<{ threads: ChatThreadSummary[] }>({
    queryKey: ["inbox-threads", scope],
    queryFn: () => fetch(`/api/inbox/threads?scope=${scope}`).then((r) => r.json()),
    // Poll every 5s while the inbox tab is in focus so newly-arrived
    // messages bubble in without a manual refresh. React Query auto-pauses
    // refetching when the window blurs (refetchIntervalInBackground=false
    // is the default), so this isn't a constant network hammer.
    staleTime: 5 * 1000,
    refetchInterval: 5 * 1000,
  })

  const threads = threadsQuery.data?.threads ?? []

  /**
   * Mark a thread as read. Slack-default: fires the moment the user picks the
   * thread (no delay). We optimistically zero the row's `unreadCount` so the
   * left-pane badge clears immediately, then PATCH the server, then refresh
   * the sidebar inbox badge so the global count drops too. Failures revert.
   */
  function selectAndMarkRead(thread: ChatThreadSummary) {
    setSelected(thread)
    if (thread.unreadCount === 0) return

    // Optimistic local update on the threads list.
    queryClient.setQueryData<{ threads: ChatThreadSummary[] }>(
      ["inbox-threads", scope],
      (prev) => {
        if (!prev) return prev
        return {
          threads: prev.threads.map((t) =>
            t.threadKey === thread.threadKey ? { ...t, unreadCount: 0 } : t,
          ),
        }
      },
    )

    fetch(`/api/inbox/threads/${encodeURIComponent(thread.threadKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`mark_read failed (${res.status})`)
        // Refresh sidebar inbox badge — chats are part of the combined total.
        queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
        // Refresh the thread message list so the per-message status reflects
        // the new state (used by future internal-note rendering).
        queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      })
      .catch((e) => {
        console.error("Failed to mark thread read", e)
        // Revert optimistic update.
        queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
      })
  }

  // Auto-select the first thread when the list loads, so the empty right pane
  // doesn't sit there waiting for a click. Also marks it read so the badge
  // doesn't sit there showing unread for a thread the user is actively viewing.
  useEffect(() => {
    if (!selected && threads.length > 0) selectAndMarkRead(threads[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, threads])

  // Re-select the same thread by key when threads refresh, so the selection
  // survives query invalidations.
  useEffect(() => {
    if (selected && !threads.some((t) => t.threadKey === selected.threadKey)) {
      setSelected(threads[0] ?? null)
    }
  }, [selected, threads])

  // Auto-prune the bulk-select set when threads leave the visible list (a
  // ticket got claimed in Trengo, the user switched scope, etc.). Mirrors
  // the Tasks tab behaviour — without this the floating bar lies about the
  // count and operations would target ghost keys.
  useEffect(() => {
    const visible = new Set(threads.map((t) => t.threadKey))
    setSelectedKeys((prev) => {
      let dirty = false
      const next = new Set<string>()
      for (const key of prev) {
        if (visible.has(key)) next.add(key)
        else dirty = true
      }
      return dirty ? next : prev
    })
  }, [threads])

  function toggleSelectKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearBulkSelection() {
    setSelectedKeys(new Set())
  }

  /**
   * Bulk mark-read: fans out PATCH calls in parallel for the selected
   * threads. Optimistically zeros the unread counts in the cached threads
   * list so the rows clear immediately; the badge query is invalidated
   * once at the end so the sidebar drops to the new total in one tick.
   */
  async function bulkMarkRead() {
    const keys = Array.from(selectedKeys)
    if (keys.length === 0) return
    setBulkBusy(true)
    queryClient.setQueryData<{ threads: ChatThreadSummary[] }>(
      ["inbox-threads", scope],
      (prev) => {
        if (!prev) return prev
        return {
          threads: prev.threads.map((t) =>
            keys.includes(t.threadKey) ? { ...t, unreadCount: 0 } : t,
          ),
        }
      },
    )
    clearBulkSelection()
    try {
      await Promise.all(
        keys.map((key) =>
          fetch(`/api/inbox/threads/${encodeURIComponent(key)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "mark_read" }),
          }),
        ),
      )
      queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
    } catch (e) {
      console.error("Bulk mark-read failed", e)
      queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
    } finally {
      setBulkBusy(false)
    }
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
    if (selected) {
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", selected.threadKey] })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3 h-[640px] pb-20">
      <ThreadList
        threads={threads}
        loading={threadsQuery.isLoading}
        selectedKey={selected?.threadKey ?? null}
        onSelect={selectAndMarkRead}
        scope={scope}
        selectedKeys={selectedKeys}
        onToggleSelect={toggleSelectKey}
      />
      <ThreadView thread={selected} users={users} onReplied={refresh} />
      {selectedKeys.size > 0 && (
        <ChatBulkActionBar
          count={selectedKeys.size}
          busy={bulkBusy}
          onMarkRead={bulkMarkRead}
          onClear={clearBulkSelection}
        />
      )}
    </div>
  )
}

/**
 * Floating bottom bar that appears when 1+ threads are checked in the left
 * pane. Mirrors the Tasks tab BulkActionBar so the affordance feels the
 * same. Today only "mark all read" — the unassigned-only filter already
 * sweeps most noise; archive/delete come back if Roy hits a wall.
 */
function ChatBulkActionBar({
  count,
  busy,
  onMarkRead,
  onClear,
}: {
  count: number
  busy: boolean
  onMarkRead: () => void
  onClear: () => void
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 inline-flex items-center gap-1 rounded-full border border-border bg-popover shadow-lg px-2 py-1.5">
      <span className="text-xs font-medium px-2 tabular-nums">
        {count} selected
      </span>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onMarkRead}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-60"
        title="Mark selected threads as read"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Mark read
      </button>
      <span className="h-4 w-px bg-border/60" aria-hidden />
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        title="Clear selection"
      >
        <X className="h-3 w-3" />
        Clear
      </button>
    </div>
  )
}

// --- Thread list (left pane) ---------------------------------------------

function ThreadList({
  threads,
  loading,
  selectedKey,
  onSelect,
  scope,
  selectedKeys,
  onToggleSelect,
}: {
  threads: ChatThreadSummary[]
  loading: boolean
  selectedKey: string | null
  onSelect: (thread: ChatThreadSummary) => void
  scope: ChatScope
  selectedKeys: Set<string>
  onToggleSelect: (key: string) => void
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border/40 flex items-center justify-center py-12">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (threads.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/40 flex flex-col items-center justify-center py-12 px-4 text-center">
        <Inbox className="h-6 w-6 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground">
          {scope === "external"
            ? "No client conversations yet."
            : "No team conversations yet."}
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-1">
          {scope === "external"
            ? "Trengo messages will appear here once webhooks fire."
            : "Slack messages will appear here once webhooks fire."}
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border/40 overflow-y-auto">
      {threads.map((thread) => {
        const isSelected = thread.threadKey === selectedKey
        const isChecked = selectedKeys.has(thread.threadKey)
        return (
          <div
            key={thread.threadKey}
            className={cn(
              "group flex items-start gap-2 border-b border-border/40 last:border-b-0 px-3 py-3 cursor-pointer transition-colors",
              isSelected ? "bg-muted/60" : "hover:bg-muted/30",
              isChecked && "ring-1 ring-primary/40 bg-primary/[0.04]",
            )}
            onClick={() => onSelect(thread)}
          >
            {/* Hover-revealed bulk-select checkbox; pinned visible when
                checked so the AM can see what's in their batch. */}
            <button
              type="button"
              role="checkbox"
              aria-checked={isChecked}
              onClick={(e) => {
                e.stopPropagation()
                onToggleSelect(thread.threadKey)
              }}
              className={cn(
                "h-5 w-5 shrink-0 rounded border-2 inline-flex items-center justify-center mt-0.5 transition-all",
                isChecked
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:border-foreground hover:bg-muted/40",
              )}
              title={isChecked ? "Deselect" : "Select"}
            >
              {isChecked && <Check className="h-3 w-3" strokeWidth={3} />}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2 mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <SourceIcon thread={thread} />
                  <span className="text-sm font-medium truncate">{thread.primaryName}</span>
                  <ChannelBadge thread={thread} />
                </div>
                {thread.unreadCount > 0 && (
                  <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold tabular-nums">
                    {thread.unreadCount}
                  </span>
                )}
              </div>
              {(thread.clientName || thread.channelName) && (
                <p className="text-[10px] text-muted-foreground/70 truncate mb-1">
                  {thread.clientName ?? thread.channelName}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground/80 truncate leading-snug">
                {thread.latestPreview || <span className="italic">No preview</span>}
              </p>
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                {fmtRelative(thread.latestAt)}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Thread view (right pane) --------------------------------------------

function ThreadView({
  thread,
  users,
  onReplied,
}: {
  thread: ChatThreadSummary | null
  users: InboxUser[]
  onReplied: () => void
}) {
  if (!thread) {
    return (
      <div className="rounded-lg border border-border/40 flex items-center justify-center text-sm text-muted-foreground/60">
        Select a conversation
      </div>
    )
  }

  return <ThreadMessages thread={thread} users={users} onReplied={onReplied} />
}

type ComposerTab = "reply" | "comment"

function ThreadMessages({
  thread,
  users,
  onReplied,
}: {
  thread: ChatThreadSummary
  users: InboxUser[]
  onReplied: () => void
}) {
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  // Trengo-style: separate drafts per tab so switching back doesn't blow away
  // half-typed text. Slack and Trengo both behave this way; surprises hurt.
  const [composerTab, setComposerTab] = useState<ComposerTab>("reply")
  const [replyDraft, setReplyDraft] = useState("")
  const [commentDraft, setCommentDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState<"trengo" | "slack" | null>(null)
  // @-mention state for the Comment composer. We track which user IDs were
  // explicitly picked from the dropdown so the backend gets a trustworthy
  // list — typing "@" + raw text without picking doesn't notify anyone, by
  // design (avoids fuzzy false-positives spamming colleagues).
  const [mentionedIds, setMentionedIds] = useState<Set<string>>(new Set())
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const isComment = composerTab === "comment"
  const draft = isComment ? commentDraft : replyDraft
  const setDraft = isComment ? setCommentDraft : setReplyDraft

  // Filter the user list against the active @-query (case-insensitive prefix
  // match on name and email). Capped at 6 entries so the popup doesn't push
  // the textarea off-screen on small panes.
  const mentionMatches = useMemo(() => {
    if (mentionQuery == null) return []
    const q = mentionQuery.toLowerCase()
    return users
      .filter((u) => {
        const name = (u.name ?? "").toLowerCase()
        const email = u.email.toLowerCase()
        return name.includes(q) || email.includes(q)
      })
      .slice(0, 6)
  }, [users, mentionQuery])

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

  const messages = messagesQuery.data?.messages ?? []

  // Scroll to bottom on load + on new message arrivals.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }, [thread.threadKey, messages.length])

  // Reset both drafts + composer state when switching threads.
  useEffect(() => {
    setReplyDraft("")
    setCommentDraft("")
    setComposerTab("reply")
    setSendError(null)
    setNeedsConnect(null)
    setMentionedIds(new Set())
    setMentionQuery(null)
  }, [thread.threadKey])

  const replyable = thread.source === "trengo" || thread.source === "slack"
  // Internal notes route to Trengo's `internal_note: true` annotation; Slack
  // has no equivalent today (Phase E will add Hub-native team threads).
  const supportsComment = thread.source === "trengo"

  async function send() {
    const trimmed = draft.trim()
    if (!trimmed) return
    setSending(true)
    setSendError(null)
    setNeedsConnect(null)
    // Only forward mentions on the Comment tab; replies go to clients and
    // any "@..." in a reply is conversational, not a notification trigger.
    const mentionPayload = isComment ? Array.from(mentionedIds) : []
    try {
      const res = await fetch(`/api/inbox/${thread.latestEventId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          internalNote: isComment,
          mentionedUserIds: mentionPayload,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        needsConnect?: "trengo" | "slack"
        error?: string
      }
      if (!res.ok) {
        if (data.needsConnect) setNeedsConnect(data.needsConnect)
        else setSendError(data.error ?? (isComment ? "Comment failed" : "Reply failed"))
        return
      }
      setDraft("")
      setMentionedIds(new Set())
      setMentionQuery(null)
      await queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      onReplied()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Send failed")
    } finally {
      setSending(false)
    }
  }

  /**
   * Watch the comment textarea for an active @-trigger. We look at the text
   * left of the cursor and pull out the last `@<query>` chunk if there's
   * one with no whitespace inside. Empty query is fine (just `@`) — shows
   * the full user list. Anything else closes the popup.
   */
  function handleCommentChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setCommentDraft(value)
    const cursor = e.target.selectionStart ?? value.length
    const left = value.slice(0, cursor)
    const m = left.match(/(?:^|\s)@([\w.\-]*)$/)
    if (m) {
      setMentionQuery(m[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  function pickMention(user: InboxUser) {
    const ta = commentTextareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart ?? commentDraft.length
    const left = commentDraft.slice(0, cursor)
    const right = commentDraft.slice(cursor)
    const replaced = left.replace(/(?:^|\s)@([\w.\-]*)$/, (match) => {
      // Preserve any leading whitespace the regex captured.
      const lead = match.startsWith("@") ? "" : match[0]
      return `${lead}@${(user.name ?? user.email).replace(/\s+/g, "_")} `
    })
    const next = replaced + right
    setCommentDraft(next)
    setMentionedIds((prev) => {
      const n = new Set(prev)
      n.add(user.id)
      return n
    })
    setMentionQuery(null)
    // Restore caret position right after the inserted token.
    requestAnimationFrame(() => {
      const pos = replaced.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="rounded-lg border border-border/40 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <SourceIcon thread={thread} />
            <p className="text-sm font-semibold truncate">{thread.primaryName}</p>
            <ChannelBadge thread={thread} />
          </div>
          {(thread.clientName || thread.channelName) && (
            <p className="text-[11px] text-muted-foreground/70 truncate">
              {thread.clientName
                ? thread.channelName
                  ? `${thread.clientName} · via ${thread.channelName}`
                  : thread.clientName
                : `via ${thread.channelName}`}
            </p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground/60 tabular-nums shrink-0">
          {thread.totalCount} {thread.totalCount === 1 ? "message" : "messages"}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-muted/20">
        {messagesQuery.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground/60 text-center py-8">
            No messages in this thread.
          </p>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply / Comment composer — Trengo-style tabs. Reply goes to the
          customer; Comment is a team-only annotation rendered as a yellow
          bubble inline in the same thread. Drafts are kept per-tab so a
          half-typed reply doesn't vanish when the AM peeks at the comment
          tab. */}
      {replyable && (
        <div className="border-t border-border/40 bg-background">
          {/* Tab strip */}
          <div className="flex border-b border-border/40 px-2 pt-2 gap-1">
            <ComposerTabButton
              active={composerTab === "reply"}
              onClick={() => setComposerTab("reply")}
              icon={<ReplyIcon className="h-3.5 w-3.5" />}
              label="Reply"
              tone="reply"
            />
            {supportsComment && (
              <ComposerTabButton
                active={composerTab === "comment"}
                onClick={() => setComposerTab("comment")}
                icon={<StickyNote className="h-3.5 w-3.5" />}
                label="Comment"
                tone="comment"
              />
            )}
          </div>

          <div
            className={cn(
              "p-3 transition-colors",
              isComment && "bg-amber-50 dark:bg-amber-500/5",
            )}
          >
            {needsConnect && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
                Connect your {needsConnect} account first.{" "}
                <Link href="/account" className="underline font-medium">
                  Go to My Account
                </Link>
              </div>
            )}
            {sendError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
                {sendError}
              </div>
            )}
            {isComment && (
              <p className="text-[10px] uppercase tracking-widest text-amber-700 dark:text-amber-400/80 mb-1.5 font-medium">
                Internal note · only visible to your team
              </p>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={isComment ? commentTextareaRef : undefined}
                  value={draft}
                  onChange={isComment ? handleCommentChange : (e) => setDraft(e.target.value)}
                  placeholder={
                    isComment
                      ? "Add a note for your team — type @ to mention a colleague"
                      : `Reply via ${thread.source} as you`
                  }
                  rows={2}
                  disabled={sending}
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-3 resize-none",
                    isComment
                      ? "border-amber-300 bg-amber-100/40 dark:border-amber-500/40 dark:bg-amber-500/10 focus-visible:border-amber-500 focus-visible:ring-amber-500/30"
                      : "border-input bg-transparent dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50",
                  )}
                  onKeyDown={(e) => {
                    // Mention popup keyboard handling — arrow keys move the
                    // selection, Enter/Tab picks, Escape dismisses. We swallow
                    // those keys so they don't also fire send-on-Enter.
                    if (isComment && mentionQuery !== null && mentionMatches.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault()
                        setMentionIndex((i) => (i + 1) % mentionMatches.length)
                        return
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault()
                        setMentionIndex(
                          (i) => (i - 1 + mentionMatches.length) % mentionMatches.length,
                        )
                        return
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault()
                        pickMention(mentionMatches[mentionIndex])
                        return
                      }
                      if (e.key === "Escape") {
                        e.preventDefault()
                        setMentionQuery(null)
                        return
                      }
                    }
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      send()
                    }
                  }}
                />
                {isComment && mentionQuery !== null && mentionMatches.length > 0 && (
                  <div className="absolute left-0 bottom-full mb-1 z-30 w-64 max-w-full rounded-md border border-border bg-popover shadow-lg overflow-hidden">
                    {mentionMatches.map((u, i) => (
                      <button
                        key={u.id}
                        type="button"
                        onMouseDown={(e) => {
                          // Prevent textarea blur before our click handler runs.
                          e.preventDefault()
                          pickMention(u)
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-xs flex flex-col gap-0",
                          i === mentionIndex
                            ? "bg-primary/10 text-foreground"
                            : "hover:bg-muted/60",
                        )}
                      >
                        <span className="font-medium truncate">{u.name ?? u.email}</span>
                        {u.name && (
                          <span className="text-[10px] text-muted-foreground/70 truncate">
                            {u.email}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                size="sm"
                onClick={send}
                disabled={!draft.trim() || sending}
                className={cn(
                  isComment &&
                    "bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-500 dark:hover:bg-amber-600",
                )}
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tab button for the composer header. The "comment" tone uses a soft amber
 *  treatment to telegraph that switching to it changes the destination of
 *  the message — Trengo uses the same visual cue. */
function ComposerTabButton({
  active,
  onClick,
  icon,
  label,
  tone,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  tone: "reply" | "comment"
}) {
  const activeCls =
    tone === "comment"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
      : "bg-muted text-foreground"
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors",
        active
          ? `${activeCls} border-current`
          : "text-muted-foreground hover:text-foreground border-transparent",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// --- Pieces --------------------------------------------------------------

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUs = msg.authorKind === "rl_team"
  // Internal notes are always team-authored; render them with an amber bubble
  // (Trengo's convention) so the AM can tell at a glance which posts the
  // client can see and which are team-only chatter. Still right-aligned —
  // the author is "us" — but the colour swap makes it unmissable.
  const isInternal = msg.isInternal
  return (
    <div className={cn("flex gap-2", isUs ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2",
          isInternal
            ? "bg-amber-100 text-amber-950 border border-amber-300 dark:bg-amber-500/15 dark:text-amber-100 dark:border-amber-500/40"
            : isUs
              ? "bg-primary text-primary-foreground"
              : "bg-card border border-border/40",
        )}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold">{msg.authorName}</span>
          {isInternal && (
            <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-widest font-semibold text-amber-800 dark:text-amber-300/80">
              <StickyNote className="h-2.5 w-2.5" />
              Internal
            </span>
          )}
          <span
            className={cn(
              "text-[10px] tabular-nums",
              isInternal
                ? "text-amber-800/70 dark:text-amber-300/60"
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
    </div>
  )
}

/** Channel icon for Client Inbox rows. For Trengo we differentiate WhatsApp
 *  (brand-green logo) vs email (blue mail) vs other Trengo channels (cyan
 *  chat) so it's instantly clear which medium a thread came in on — Roy's
 *  spec. Slack and Monday keep their existing single-icon treatment. */
function SourceIcon({ thread }: { thread: ChatThreadSummary }) {
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
function ChannelBadge({ thread }: { thread: ChatThreadSummary }) {
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

function fmtRelative(iso: string): string {
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
