import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserLocale } from "@/lib/i18n/server"
import { stripAiTells } from "@/lib/ai/guardrails"
import { buildTools, executeTool, type ToolContext } from "@/lib/pedro/chat/tools"
import { loadPedroChatBaseSystem, buildDynamicSystemBlock } from "@/lib/pedro/chat/system-prompt"

// SDK reads ANTHROPIC_API_KEY from env - same key the rest of the Hub uses.
const anthropic = new Anthropic()

// Sonnet 4: reasoning + tool use. Same model constant the creative Pedro uses.
const MODEL = "claude-sonnet-4-20250514"
const MAX_TOKENS = 2000
// Tool-use loops chain several Claude round-trips + data fetches (Monday board
// scrape can be slow). 120s (the creative route's cap) is too tight; give the
// full serverless budget.
export const maxDuration = 300
// Hard stop on the agent loop so a pathological tool-call cycle can't run forever.
const MAX_ROUNDS = 8

type ToolCallLog = { name: string; input: unknown; ok: boolean; summary: string }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return sseErrorResponse("Unauthorized", 401)

  let body: { conversationId?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return sseErrorResponse("Invalid JSON body", 400)
  }
  const userMessage = (body.message ?? "").trim()
  if (!userMessage) return sseErrorResponse("message is required", 400)

  const userId = session.user.id
  const ctx: ToolContext = {
    isAdmin: session.user.role === "admin",
    isFinance: !!session.user.isFinance,
  }
  const locale = await getUserLocale(userId)
  const supabase = await createAdminClient()

  // ── Resolve / create conversation ──
  let conversationId = body.conversationId ?? null
  let isNew = false
  let title: string | null = null
  if (conversationId) {
    const { data } = await supabase
      .from("pedro_chat_conversations")
      .select("id, title, user_id")
      .eq("id", conversationId)
      .maybeSingle()
    if (!data || data.user_id !== userId) return sseErrorResponse("Conversation not found", 404)
    title = data.title
  } else {
    title = userMessage.length > 60 ? `${userMessage.slice(0, 57)}...` : userMessage
    const { data, error } = await supabase
      .from("pedro_chat_conversations")
      .insert({ user_id: userId, title })
      .select("id")
      .single()
    if (error || !data) return sseErrorResponse("Could not create conversation", 500)
    conversationId = data.id
    isNew = true
  }

  // ── Load prior turns (text only) for context ──
  const { data: priorRows } = await supabase
    .from("pedro_chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
  const messages: Anthropic.MessageParam[] = (priorRows ?? []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
  }))
  messages.push({ role: "user", content: userMessage })

  // Persist the user turn immediately (so a mid-stream crash still records it).
  await supabase
    .from("pedro_chat_messages")
    .insert({ conversation_id: conversationId, role: "user", content: userMessage })

  // ── System prompt: cacheable base + fresh dynamic block ──
  const base = await loadPedroChatBaseSystem()
  const dynamic = buildDynamicSystemBlock({
    locale,
    todayIso: new Date().toISOString().slice(0, 10),
    canSeeFinance: ctx.isAdmin || ctx.isFinance,
    userName: session.user.name ?? null,
  })
  const system: Anthropic.MessageCreateParams["system"] = [
    { type: "text", text: base, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ]
  const tools = buildTools(ctx)

  const encoder = new TextEncoder()
  const sse = (payload: object) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      let fullText = ""
      let promptTokens = 0
      let completionTokens = 0
      const toolLog: ToolCallLog[] = []
      try {
        controller.enqueue(sse({ type: "meta", conversationId, isNew, title }))

        for (let round = 0; round < MAX_ROUNDS; round++) {
          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system,
            tools,
            messages,
          })

          for await (const event of messageStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta" &&
              event.delta.text
            ) {
              fullText += event.delta.text
              controller.enqueue(sse({ type: "text", delta: event.delta.text }))
            }
          }

          const final = await messageStream.finalMessage()
          promptTokens += final.usage.input_tokens ?? 0
          completionTokens += final.usage.output_tokens ?? 0

          const toolUses = final.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          )

          // No tool calls → the assistant's text is the final answer.
          if (toolUses.length === 0) break

          // Feed the assistant's turn (text + tool_use blocks) back verbatim.
          messages.push({ role: "assistant", content: final.content })

          // Execute each tool, stream a status event, collect the results.
          const toolResults: Anthropic.ToolResultBlockParam[] = []
          for (const tu of toolUses) {
            controller.enqueue(sse({ type: "tool", phase: "start", name: tu.name }))
            const result = await executeTool(
              tu.name,
              (tu.input ?? {}) as Record<string, unknown>,
              ctx,
            )
            toolLog.push({ name: tu.name, input: tu.input, ok: result.ok, summary: result.summary })
            controller.enqueue(
              sse({ type: "tool", phase: "end", name: tu.name, ok: result.ok, summary: result.summary }),
            )
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify({ summary: result.summary, data: result.data }),
              is_error: !result.ok,
            })
          }
          messages.push({ role: "user", content: toolResults })
          // Loop again so Claude can use the tool results (or call more tools).
        }

        const cleaned = stripAiTells(fullText)

        // Persist the assistant turn + touch the conversation.
        await supabase.from("pedro_chat_messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: cleaned,
          tool_calls: toolLog.length > 0 ? toolLog : null,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
        })
        await supabase
          .from("pedro_chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId)

        controller.enqueue(
          sse({
            type: "done",
            text: cleaned,
            conversationId,
            usage: { promptTokens, completionTokens },
          }),
        )
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Pedro chat stream error"
        console.error("Pedro chat stream error:", e)
        controller.enqueue(sse({ type: "error", message: msg }))
        controller.enqueue(sse({ type: "done", text: fullText, conversationId, usage: null }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

function sseErrorResponse(message: string, status: number) {
  const encoder = new TextEncoder()
  const body = encoder.encode(
    `data: ${JSON.stringify({ type: "error", message })}\n\n` +
      `data: ${JSON.stringify({ type: "done", text: "", conversationId: null, usage: null })}\n\n`,
  )
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  })
}
