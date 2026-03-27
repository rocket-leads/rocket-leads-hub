"use client"

import { useState } from "react"
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
  email: <Mail className="h-4 w-4" />,
  chat: <MessageCircle className="h-4 w-4" />,
  whatsapp: <MessageCircle className="h-4 w-4" />,
  voice: <Phone className="h-4 w-4" />,
}

function channelIcon(type: string | undefined) {
  return CHANNEL_ICON[type ?? ""] ?? <MessageCircle className="h-4 w-4" />
}

function fmtDate(str: string) {
  return new Date(str).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  })
}

function stripHtml(html: string): string {
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
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  if (query.isLoading) {
    return (
      <div className="space-y-2 pt-3 pl-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <p className="pt-3 pl-4 text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Failed to load messages."}
      </p>
    )
  }

  const messages = query.data
  if (messages.length === 0) {
    return <p className="pt-3 pl-4 text-sm text-muted-foreground">No messages in this conversation.</p>
  }

  return (
    <div className="pt-3 space-y-2 border-t mt-3">
      {messages.map((msg) => {
        const isAgent = msg.author_type === "User"
        return (
          <div
            key={msg.id}
            className={`flex gap-3 ${isAgent ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                isAgent
                  ? "bg-primary/10 text-foreground ml-auto"
                  : "bg-muted text-foreground"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-xs">
                  {msg.author?.name ?? (isAgent ? "Agent" : "Contact")}
                </span>
                <span className="text-xs text-muted-foreground">{fmtDate(msg.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words">{stripHtml(msg.body)}</p>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="mt-2 space-y-1">
                  {msg.attachments.map((att, i) => (
                    <a
                      key={i}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-xs text-primary hover:underline"
                    >
                      📎 {att.name}
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

function ConversationRow({ conv, mondayItemId }: { conv: TrengoConversation; mondayItemId: string }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="mt-0.5 text-muted-foreground shrink-0">
          {channelIcon(conv.channel?.type)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">
              {conv.subject || conv.channel?.name || "Conversation"}
            </span>
            <Badge
              variant="outline"
              className={
                conv.status === "open"
                  ? "bg-green-500/20 text-green-400 border-green-500/30 text-xs"
                  : "bg-muted text-muted-foreground text-xs"
              }
            >
              {conv.status}
            </Badge>
            {conv.assignee && (
              <span className="text-xs text-muted-foreground">→ {conv.assignee.name}</span>
            )}
          </div>
          {conv.last_message && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {stripHtml(conv.last_message.body)}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(conv.created_at)}</p>
        </div>
        <span className="shrink-0 text-muted-foreground mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <MessageThread mondayItemId={mondayItemId} conversationId={conv.id} />
        </div>
      )}
    </div>
  )
}

export function CommunicationTab({ mondayItemId, trengoContactId }: Props) {
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
    staleTime: 5 * 60 * 1000,
  })

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
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load conversations."}
        </CardContent>
      </Card>
    )
  }

  const conversations = query.data
  const open = conversations.filter((c) => c.status === "open")
  const closed = conversations.filter((c) => c.status === "closed")

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
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        {conversations.length} conversation{conversations.length !== 1 ? "s" : ""}
        {open.length > 0 && (
          <span className="ml-2 text-green-400">· {open.length} open</span>
        )}
      </div>

      {open.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Open</h3>
          {open.map((conv) => (
            <ConversationRow key={conv.id} conv={conv} mondayItemId={mondayItemId} />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Closed</h3>
          {closed.map((conv) => (
            <ConversationRow key={conv.id} conv={conv} mondayItemId={mondayItemId} />
          ))}
        </div>
      )}
    </div>
  )
}
