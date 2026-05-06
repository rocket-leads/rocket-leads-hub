"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Send, MessageSquare, Hash, LayoutGrid, Inbox, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ChatScope, ChatThreadSummary, ChatMessage } from "@/lib/inbox/fetchers"

type Props = {
  scope: ChatScope
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
export function ChatPane({ scope }: Props) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<ChatThreadSummary | null>(null)

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

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["inbox-threads", scope] })
    if (selected) {
      queryClient.invalidateQueries({ queryKey: ["inbox-thread", selected.threadKey] })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3 h-[640px]">
      <ThreadList
        threads={threads}
        loading={threadsQuery.isLoading}
        selectedKey={selected?.threadKey ?? null}
        onSelect={selectAndMarkRead}
        scope={scope}
      />
      <ThreadView thread={selected} onReplied={refresh} />
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
}: {
  threads: ChatThreadSummary[]
  loading: boolean
  selectedKey: string | null
  onSelect: (thread: ChatThreadSummary) => void
  scope: ChatScope
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
        return (
          <button
            key={thread.threadKey}
            type="button"
            onClick={() => onSelect(thread)}
            className={cn(
              "w-full text-left border-b border-border/40 last:border-b-0 px-3.5 py-3 transition-colors",
              isSelected
                ? "bg-muted/60"
                : "hover:bg-muted/30",
            )}
          >
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
          </button>
        )
      })}
    </div>
  )
}

// --- Thread view (right pane) --------------------------------------------

function ThreadView({
  thread,
  onReplied,
}: {
  thread: ChatThreadSummary | null
  onReplied: () => void
}) {
  if (!thread) {
    return (
      <div className="rounded-lg border border-border/40 flex items-center justify-center text-sm text-muted-foreground/60">
        Select a conversation
      </div>
    )
  }

  return <ThreadMessages thread={thread} onReplied={onReplied} />
}

function ThreadMessages({
  thread,
  onReplied,
}: {
  thread: ChatThreadSummary
  onReplied: () => void
}) {
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [reply, setReply] = useState("")
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState<"trengo" | "slack" | null>(null)

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

  // Reset reply state when switching threads.
  useEffect(() => {
    setReply("")
    setSendError(null)
    setNeedsConnect(null)
  }, [thread.threadKey])

  const replyable = thread.source === "trengo" || thread.source === "slack"

  async function sendReply() {
    if (!reply.trim()) return
    setSending(true)
    setSendError(null)
    setNeedsConnect(null)
    try {
      const res = await fetch(`/api/inbox/${thread.latestEventId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim() }),
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
      await queryClient.invalidateQueries({ queryKey: ["inbox-thread", thread.threadKey] })
      onReplied()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Reply failed")
    } finally {
      setSending(false)
    }
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

      {/* Reply box */}
      {replyable && (
        <div className="border-t border-border/40 p-3 bg-background">
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
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={`Reply via ${thread.source} as you`}
              rows={2}
              disabled={sending}
              className="flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  sendReply()
                }
              }}
            />
            <Button size="sm" onClick={sendReply} disabled={!reply.trim() || sending}>
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Pieces --------------------------------------------------------------

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUs = msg.authorKind === "rl_team"
  return (
    <div className={cn("flex gap-2", isUs ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[75%] rounded-2xl px-3 py-2",
          isUs
            ? "bg-primary text-primary-foreground"
            : "bg-card border border-border/40",
        )}
      >
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[11px] font-semibold">{msg.authorName}</span>
          <span className={cn(
            "text-[10px] tabular-nums",
            isUs ? "text-primary-foreground/70" : "text-muted-foreground/70",
          )}>
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
