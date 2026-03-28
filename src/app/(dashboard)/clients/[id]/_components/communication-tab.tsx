"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChevronDown, ChevronRight, Mail, MessageCircle, Phone } from "lucide-react"
import type { TrengoConversation, TrengoMessage } from "@/lib/trengo"

type Props = {
  mondayItemId: string
  trengoContactId: string | null
}

const CHANNEL_ICON: Record<string, React.ReactNode> = {
  email: <Mail className="h-3.5 w-3.5" />,
  chat: <MessageCircle className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
  voice: <Phone className="h-3.5 w-3.5" />,
}

function channelIcon(type: string | undefined) {
  return CHANNEL_ICON[type ?? ""] ?? <MessageCircle className="h-3.5 w-3.5" />
}

function fmtDate(str: string) {
  return new Date(str).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function fmtDateShort(str: string) {
  const d = new Date(str)
  const now = new Date()
  const isThisYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", ...(isThisYear ? {} : { year: "numeric" }),
  })
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
}

function MessageThread({ mondayItemId, conversationId }: { mondayItemId: string; conversationId: number }) {
  const query = useQuery<TrengoMessage[]>({
    queryKey: ["messages", mondayItemId, conversationId],
    queryFn: async () => {
      const r = await fetch(`/api/clients/${mondayItemId}/conversations/${conversationId}/messages`)
      if (!r.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`Server error ${r.status}`)
      }
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load messages")
      return data
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  })

  if (query.isLoading) {
    return (
      <div className="space-y-2 py-2 pl-6">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <p className="py-2 pl-6 text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Failed to load messages."}
      </p>
    )
  }

  const messages = query.data
  if (messages.length === 0) {
    return <p className="py-2 pl-6 text-sm text-muted-foreground">No messages in this thread.</p>
  }

  return (
    <div className="py-3 px-3 space-y-2">
      {messages.map((msg) => {
        const isAgent = msg.author_type === "User"
        return (
          <div key={msg.id} className={`flex ${isAgent ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-xl px-3.5 py-2 ${
              isAgent
                ? "bg-primary/10 rounded-tr-sm"
                : "bg-muted rounded-tl-sm"
            }`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[11px] font-semibold ${isAgent ? "text-primary" : "text-foreground"}`}>
                  {msg.author?.name ?? (isAgent ? "Agent" : "Contact")}
                </span>
                <span className="text-[11px] text-muted-foreground">{fmtDate(msg.created_at)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words">{stripHtml(msg.body)}</p>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  {msg.attachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-primary hover:underline"
                    >
                      {att.name}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ConversationMessage({ conv, mondayItemId }: { conv: TrengoConversation; mondayItemId: string }) {
  const [expanded, setExpanded] = useState(false)
  const lastMsg = conv.latest_message

  if (!lastMsg) return null

  const isOpen = conv.status?.toLowerCase() === "open" || conv.status?.toLowerCase() === "assigned"
  const isOutbound = lastMsg.type?.toUpperCase() === "OUTBOUND"

  return (
    <div>
      <button
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left rounded-lg hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 shrink-0 flex flex-col items-center gap-0.5">
          <span className="text-muted-foreground">{channelIcon(conv.channel?.type)}</span>
          <span className={`text-[9px] font-medium leading-none ${isOutbound ? "text-primary" : "text-emerald-500"}`}>
            {isOutbound ? "OUT" : "IN"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm whitespace-pre-wrap break-words">{stripHtml(lastMsg.message)}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground">{fmtDate(lastMsg.created_at)}</span>
            {conv.channel?.name && (
              <span className="text-xs text-muted-foreground/60">{conv.channel.name}</span>
            )}
            {conv.assignee && (
              <span className="text-xs text-muted-foreground/60">→ {conv.assignee.name}</span>
            )}
            {isOpen && (
              <Badge
                variant="outline"
                className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0"
              >
                open
              </Badge>
            )}
          </div>
        </div>
        <span className="shrink-0 text-muted-foreground mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <MessageThread mondayItemId={mondayItemId} conversationId={conv.id} />
      )}
    </div>
  )
}

function groupByDate(conversations: TrengoConversation[]): Map<string, TrengoConversation[]> {
  const groups = new Map<string, TrengoConversation[]>()
  for (const conv of conversations) {
    const dateStr = conv.latest_message?.created_at ?? conv.created_at
    const key = fmtDateShort(dateStr)
    const arr = groups.get(key) ?? []
    arr.push(conv)
    groups.set(key, arr)
  }
  return groups
}

export function CommunicationTab({ mondayItemId, trengoContactId }: Props) {
  const PAGE_SIZE = 25
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef<HTMLDivElement>(null)

  const query = useQuery<TrengoConversation[]>({
    queryKey: ["conversations", mondayItemId],
    queryFn: async () => {
      const p = new URLSearchParams({ trengoContactId: trengoContactId! })
      const r = await fetch(`/api/clients/${mondayItemId}/conversations?${p}`)
      if (!r.headers.get("content-type")?.includes("application/json")) {
        throw new Error(`Server error ${r.status}`)
      }
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load conversations")
      return data
    },
    enabled: !!trengoContactId,
    retry: false,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const conversations = useMemo(() => {
    if (!query.data) return []
    return query.data
      .filter((c) => c.latest_message)
      .sort((a, b) =>
        new Date(b.latest_message!.created_at).getTime() - new Date(a.latest_message!.created_at).getTime()
      )
  }, [query.data])

  const visibleConversations = conversations.slice(0, visibleCount)
  const hasMore = visibleCount < conversations.length
  const grouped = groupByDate(visibleConversations)

  useEffect(() => {
    const el = loaderRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, conversations.length))
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [conversations.length, visibleCount])

  if (!trengoContactId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No Trengo Contact ID linked in Monday.com for this client.
        </CardContent>
      </Card>
    )
  }

  if (query.isLoading) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground/60">Loading conversations for Contact ID: {trengoContactId}</p>
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm">
          <p className="text-destructive">{query.error instanceof Error ? query.error.message : "Failed to load conversations."}</p>
          <p className="text-muted-foreground/60 mt-2">Contact ID: {trengoContactId}</p>
        </CardContent>
      </Card>
    )
  }

  if (conversations.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No conversations found for this contact.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground">
        {conversations.length} message{conversations.length !== 1 ? "s" : ""}
        <span className="ml-2 text-muted-foreground/60">· Contact ID: {trengoContactId}</span>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([date, convs]) => (
          <div key={date}>
            <div className="sticky top-0 z-10 flex justify-center py-1">
              <span className="text-xs text-muted-foreground bg-background px-3 py-0.5 rounded-full border">
                {date}
              </span>
            </div>
            <div className="space-y-0.5">
              {convs.map((conv) => (
                <ConversationMessage key={conv.id} conv={conv} mondayItemId={mondayItemId} />
              ))}
            </div>
          </div>
        ))}

        {hasMore && (
          <div ref={loaderRef} className="flex justify-center py-4">
            <span className="text-xs text-muted-foreground">Loading more...</span>
          </div>
        )}
      </div>
    </div>
  )
}
