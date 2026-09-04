"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Sparkles,
  Plus,
  Send,
  Trash2,
  Loader2,
  Wrench,
  Check,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { cn } from "@/lib/utils"

type ToolEvent = { name: string; ok: boolean | null; summary?: string }
type ChatMessage = {
  role: "user" | "assistant"
  content: string
  tools?: ToolEvent[]
}
type ConversationRow = { id: string; title: string | null; updated_at: string }

const SUGGESTIONS = [
  "Wat is de CPL van onze slechtst presterende klant deze week?",
  "Voor Rocket Leads: waar ligt de bottleneck om ons dealtarget deze maand te halen?",
  "Welke klanten staan op de watch list en waarom?",
  "Wat kun je halen uit de salescalls van Anel?",
]

export function PedroChat({
  userName,
  canSeeFinance,
}: {
  userName: string | null
  canSeeFinance: boolean
}) {
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: conversations } = useQuery<ConversationRow[]>({
    queryKey: ["pedro-chat-conversations"],
    queryFn: async () => {
      const res = await fetch("/api/pedro/chat/conversations")
      if (!res.ok) return []
      const json = await res.json()
      return json.conversations ?? []
    },
    staleTime: 30_000,
  })

  // Auto-scroll to the latest content as it streams.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  const newChat = useCallback(() => {
    setActiveId(null)
    setMessages([])
    setError(null)
  }, [])

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id)
    setError(null)
    setMessages([])
    const res = await fetch(`/api/pedro/chat/conversations/${id}`)
    if (!res.ok) return
    const json = await res.json()
    type Row = { role: "user" | "assistant"; content: string; tool_calls: ToolEvent[] | null }
    setMessages(
      (json.messages ?? []).map((m: Row) => ({
        role: m.role,
        content: m.content,
        tools: m.tool_calls ?? undefined,
      })),
    )
  }, [])

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/pedro/chat/conversations/${id}`, { method: "DELETE" })
      qc.invalidateQueries({ queryKey: ["pedro-chat-conversations"] })
      if (id === activeId) newChat()
    },
    [qc, activeId, newChat],
  )

  const send = useCallback(
    async (text: string) => {
      const message = text.trim()
      if (!message || streaming) return
      setError(null)
      setInput("")
      setStreaming(true)
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "", tools: [] },
      ])

      // Mutate the last (assistant) message in place as the stream arrives.
      const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === "assistant") next[next.length - 1] = fn(last)
          return next
        })

      try {
        const res = await fetch("/api/pedro/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: activeId, message }),
        })
        if (!res.body) throw new Error("No response stream")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let createdConversationId: string | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split("\n\n")
          buffer = chunks.pop() ?? ""
          for (const chunk of chunks) {
            const line = chunk.trim()
            if (!line.startsWith("data:")) continue
            let evt: {
              type: string
              delta?: string
              name?: string
              phase?: string
              ok?: boolean
              summary?: string
              conversationId?: string
              message?: string
            }
            try {
              evt = JSON.parse(line.slice(5).trim())
            } catch {
              continue
            }
            if (evt.type === "meta" && evt.conversationId) {
              createdConversationId = evt.conversationId
              if (!activeId) setActiveId(evt.conversationId)
            } else if (evt.type === "text" && evt.delta) {
              patchAssistant((m) => ({ ...m, content: m.content + evt.delta }))
            } else if (evt.type === "tool") {
              if (evt.phase === "start" && evt.name) {
                patchAssistant((m) => ({
                  ...m,
                  tools: [...(m.tools ?? []), { name: evt.name!, ok: null }],
                }))
              } else if (evt.phase === "end" && evt.name) {
                patchAssistant((m) => {
                  const tools = [...(m.tools ?? [])]
                  // Update the last pending entry for this tool name.
                  for (let i = tools.length - 1; i >= 0; i--) {
                    if (tools[i].name === evt.name && tools[i].ok === null) {
                      tools[i] = { name: evt.name!, ok: evt.ok ?? false, summary: evt.summary }
                      break
                    }
                  }
                  return { ...m, tools }
                })
              }
            } else if (evt.type === "error" && evt.message) {
              setError(evt.message)
            }
          }
        }

        if (createdConversationId && !activeId) setActiveId(createdConversationId)
        qc.invalidateQueries({ queryKey: ["pedro-chat-conversations"] })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis")
      } finally {
        setStreaming(false)
      }
    },
    [activeId, streaming, qc],
  )

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      {/* Conversation rail */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col gap-2">
        <Button onClick={newChat} variant="outline" className="w-full justify-start gap-2">
          <Plus className="size-4" /> Nieuw gesprek
        </Button>
        <div className="flex-1 overflow-y-auto space-y-1 pr-1">
          {(conversations ?? []).map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/60",
                c.id === activeId && "bg-muted",
              )}
              onClick={() => openConversation(c.id)}
            >
              <span className="flex-1 truncate">{c.title ?? "Gesprek"}</span>
              <button
                type="button"
                aria-label="Verwijder gesprek"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                onClick={(e) => {
                  e.stopPropagation()
                  deleteConversation(c.id)
                }}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {(conversations ?? []).length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">Nog geen gesprekken.</p>
          )}
        </div>
      </aside>

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0 rounded-xl border bg-card/40">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {messages.length === 0 ? (
            <EmptyState userName={userName} canSeeFinance={canSeeFinance} onPick={send} />
          ) : (
            messages.map((m, i) => <MessageBubble key={i} message={m} streaming={streaming && i === messages.length - 1} />)
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4" /> {error}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <AutoTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder="Vraag Pedro iets over een klant of over Rocket Leads..."
              minRows={1}
              maxRows={8}
              disabled={streaming}
              className="flex-1"
            />
            <Button
              onClick={() => send(input)}
              disabled={streaming || !input.trim()}
              size="icon"
              aria-label="Verstuur"
            >
              {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  userName,
  canSeeFinance,
  onPick,
}: {
  userName: string | null
  canSeeFinance: boolean
  onPick: (text: string) => void
}) {
  const suggestions = canSeeFinance
    ? SUGGESTIONS
    : SUGGESTIONS.filter((s) => !/omzet|finance|factu|revenue|billing/i.test(s))
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-6 py-10">
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-6" />
        </div>
        <h1 className="font-heading text-xl font-semibold">
          Hoi{userName ? ` ${userName.split(" ")[0]}` : ""}, ik ben Pedro
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Vraag me alles over je klanten of over Rocket Leads. Ik haal de data live uit de Hub.
        </p>
      </div>
      <div className="grid gap-2 w-full max-w-lg">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-sm rounded-lg border px-3 py-2 hover:bg-muted/60 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-2", isUser && "flex flex-col items-end")}>
        {!isUser && message.tools && message.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.tools.map((t, i) => (
              <ToolChip key={i} tool={t} />
            ))}
          </div>
        )}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted/50",
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : message.content ? (
            <Markdown text={message.content} />
          ) : streaming ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Pedro denkt na...
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ToolChip({ tool }: { tool: ToolEvent }) {
  const label = TOOL_LABELS[tool.name] ?? tool.name
  return (
    <span
      title={tool.summary}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
        tool.ok === null && "text-muted-foreground",
        tool.ok === true && "text-emerald-600 border-emerald-600/30",
        tool.ok === false && "text-amber-600 border-amber-600/30",
      )}
    >
      {tool.ok === null ? (
        <Loader2 className="size-3 animate-spin" />
      ) : tool.ok ? (
        <Check className="size-3" />
      ) : (
        <Wrench className="size-3" />
      )}
      {label}
    </span>
  )
}

const TOOL_LABELS: Record<string, string> = {
  list_clients: "Klanten opzoeken",
  get_client_kpis: "KPIs ophalen",
  get_watchlist_status: "Watch list checken",
  get_meta_campaigns: "Meta campagnes",
  get_targets_funnel: "RL funnel",
  get_meta_targets: "RL ad spend",
  get_finance: "Finance",
  get_client_billing: "Facturatie",
  search_sales_calls: "Salescalls doorzoeken",
}

/**
 * Minimal markdown renderer, enough for Pedro's answers (paragraphs, bullet
 * + numbered lists, headings, bold, inline code). No external dependency.
 */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n")
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = () => {
    if (!list) return
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
    blocks.push(
      list.ordered ? (
        <ol key={blocks.length} className="list-decimal pl-5 space-y-0.5">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="list-disc pl-5 space-y-0.5">
          {items}
        </ul>
      ),
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (bullet) {
      if (!list || list.ordered) flushList()
      list = list ?? { ordered: false, items: [] }
      list.items.push(bullet[1])
    } else if (numbered) {
      if (!list || !list.ordered) flushList()
      list = list ?? { ordered: true, items: [] }
      list.items.push(numbered[1])
    } else if (heading) {
      flushList()
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1])}
        </p>,
      )
    } else if (line.trim() === "") {
      flushList()
    } else {
      flushList()
      blocks.push(
        <p key={blocks.length} className="whitespace-pre-wrap">
          {inline(line)}
        </p>,
      )
    }
  }
  flushList()
  return <div className="space-y-2">{blocks}</div>
}

/** Inline formatting: **bold** and `code`. */
function inline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index))
    if (m[2] != null) parts.push(<strong key={key++}>{m[2]}</strong>)
    else if (m[3] != null)
      parts.push(
        <code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
          {m[3]}
        </code>,
      )
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}
