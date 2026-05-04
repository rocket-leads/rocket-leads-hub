import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { resolveClientAssignee } from "@/lib/inbox/assignee"

export const maxDuration = 60

/**
 * Monday update webhook receiver.
 *
 * Per the Phase C design (project_phase_c_unified_inbox_design.md): Monday
 * updates are CRM-side team-notes ABOUT a client, not chat messages WITH the
 * client. They never land in the chat substrate (Team / Client Inbox tabs);
 * they only surface as Tasks or Updates when the AI classifier judges the
 * content as task- or update-like. Plain chat-style notes get skipped here so
 * we don't inflate the inbox with low-signal CRM chatter.
 *
 * Two payload shapes Monday sends here:
 *
 * 1. `challenge` — sent once when registering the webhook URL. We echo it.
 *
 * 2. Real events — only `create_update` is handled. Each carries:
 *      - event.boardId  → must be the onboarding or current-clients board
 *      - event.pulseId  → the Monday item id of the client
 *      - event.userId / event.userName → Monday user who wrote the update
 *      - event.body / event.value.text → the update text
 *
 * Auth: shared secret `MONDAY_WEBHOOK_SECRET`. Monday doesn't sign payloads
 * the way Slack does; the convention is a static header or URL query param.
 * We accept either `?secret=…` or `Authorization: Bearer …`.
 */

type MondayChallengePayload = { challenge: string }

type MondayEventPayload = {
  event?: {
    type?: string
    boardId?: number | string
    pulseId?: number | string
    userId?: number | string
    userName?: string
    body?: string
    textBody?: string
    value?: { text?: string; body?: string }
    triggerTime?: string
  }
}

function verifyAuth(req: NextRequest): boolean {
  const expected = process.env.MONDAY_WEBHOOK_SECRET
  if (!expected) return false
  const queryParam = req.nextUrl.searchParams.get("secret")
  if (queryParam && queryParam === expected) return true
  const auth = req.headers.get("authorization")
  if (auth === `Bearer ${expected}`) return true
  return false
}

async function getBoardConfig(supabase: Awaited<ReturnType<typeof createAdminClient>>) {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "board_config")
    .maybeSingle()
  if (!data?.value) return null
  return data.value as {
    onboarding_board_id?: string
    current_board_id?: string
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  let payload: MondayChallengePayload | MondayEventPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // 1. Challenge response — echoed BEFORE auth check so the URL can be
  // registered even before MONDAY_WEBHOOK_SECRET is set in env.
  if ("challenge" in payload && payload.challenge) {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // 2. Real events require auth.
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const event = (payload as MondayEventPayload).event
  if (!event) return NextResponse.json({ ok: true, ignored: "no event" })

  // We only care about new updates on client items.
  if (event.type !== "create_update") {
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  const supabase = await createAdminClient()
  const boardConfig = await getBoardConfig(supabase)
  if (!boardConfig) {
    return NextResponse.json({ ok: false, error: "No board config" }, { status: 500 })
  }

  const eventBoardId = String(event.boardId ?? "")
  const onboardingBoard = String(boardConfig.onboarding_board_id ?? "")
  const currentBoard = String(boardConfig.current_board_id ?? "")
  if (eventBoardId !== onboardingBoard && eventBoardId !== currentBoard) {
    // Update on some other board (lead board, internal board, etc.) — out of scope.
    return NextResponse.json({ ok: true, ignored: "non-client board" })
  }

  const pulseId = String(event.pulseId ?? "")
  if (!pulseId) {
    return NextResponse.json({ ok: false, error: "missing pulseId" }, { status: 400 })
  }

  const text = (
    event.body ??
    event.textBody ??
    event.value?.text ??
    event.value?.body ??
    ""
  ).trim()
  if (!text) return NextResponse.json({ ok: true, skipped: "empty body" })

  const userId = String(event.userId ?? "")
  const userName = event.userName ?? "Monday user"

  // Synthetic dedupe id — Monday update payloads vary by version, so we key on
  // (board, pulse, user, trigger time) which is unique enough in practice.
  const triggerTime = event.triggerTime ?? new Date().toISOString()
  const sourceMsgId = `monday:update:${eventBoardId}:${pulseId}:${userId}:${triggerTime}`

  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("source", "monday")
    .eq("source_msg_id", sourceMsgId)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, deduped: true })

  // Classify. Author is internal (RL team writes Monday updates).
  const classification = await classifyInboxMessage({
    source: "monday",
    authorKind: "rl_team",
    content: text,
  })

  // Per design: Monday is NOT in the chat substrate. Only emit when the AI
  // classifies as task or update — chat-grade Monday notes get dropped.
  if (classification.kind === "chat") {
    return NextResponse.json({
      ok: true,
      skipped: "chat-classified Monday update is not surfaced",
      confidence: classification.confidence,
    })
  }

  // System author for the FK. Assignee resolves to the AM of the client so
  // classified Monday updates land on the right person's "Assigned to me"
  // view rather than a phantom HQ inbox. Falls back to HQ when the client's
  // AM isn't mapped via user_column_mappings.
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (!hq?.id) {
    return NextResponse.json({ ok: false, error: "no system author" }, { status: 500 })
  }

  const assigneeId = (await resolveClientAssignee(pulseId)) ?? hq.id

  const titlePreview = text.length > 100 ? text.slice(0, 100) + "…" : text
  const bodyFull = text.length > 100 ? text : null

  const { error } = await supabase.from("inbox_events").insert({
    kind: classification.kind,
    client_id: pulseId, // Monday item id IS our client_id text key
    author_id: hq.id,
    assignee_id: assigneeId,
    title: titlePreview || `Monday update from ${userName}`,
    body: bodyFull,
    status: classification.kind === "task" ? "open" : "unread",
    priority: classification.kind === "task" ? "normal" : null,
    source: "monday",
    source_thread: `monday:item:${pulseId}`,
    source_msg_id: sourceMsgId,
    // thread_key intentionally null — Monday updates don't form a chat thread.
    // scope intentionally null — they live in Tasks/Updates, not in Chat tabs.
    thread_key: null,
    scope: null,
    author_kind: "rl_team",
    author_external: userId,
    author_name_cached: userName,
    classify_conf: classification.confidence,
    classify_method: "ai",
    created_at_src: triggerTime,
    raw: payload as unknown as Record<string, unknown>,
  })

  if (error) {
    console.error("Monday webhook insert failed:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    classified: classification.kind,
    confidence: classification.confidence,
    pulseId,
    boardId: eventBoardId,
  })
}
