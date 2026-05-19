import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { stripHtml } from "@/lib/html"
import { sendInboxAssignmentPush } from "@/lib/notifications/inbox-trigger"

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
    /** Stable Monday update id when present on the payload (newer event
     *  versions). Anchors `source_msg_id` so the webhook key matches what the
     *  backfill builds, preventing duplicates when both paths touch the same
     *  update. */
    updateId?: number | string
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

/**
 * Parse @-mentions out of a Monday update body's HTML. Mentions render as:
 *   <a class="user_mention_editor router"
 *      data-mention-type="User"
 *      data-mention-id="<monday_user_id>">@<display name></a>
 *
 * Returns an array of `{ mondayUserId, displayName }` in document order.
 * `mondayUserId` is the numeric Monday user id; `displayName` is the anchor
 * text without the leading "@". Empty array when no mentions found (i.e.
 * the body contains no <a class="user_mention_editor"> anchor).
 */
function parseMondayMentions(html: string): Array<{ mondayUserId: string; displayName: string }> {
  if (!html) return []
  const re =
    /<a[^>]*\bdata-mention-type=["']User["'][^>]*\bdata-mention-id=["'](\d+)["'][^>]*>(?:@)?([^<]+)<\/a>/gi
  const out: Array<{ mondayUserId: string; displayName: string }> = []
  for (const m of html.matchAll(re)) {
    const mondayUserId = m[1]
    const displayName = m[2].replace(/^@/, "").trim()
    if (mondayUserId && displayName) out.push({ mondayUserId, displayName })
  }
  return out
}

/**
 * Resolve mentioned Monday display names to Hub user ids via
 * `user_column_mappings.monday_person_name`. Returns the FIRST matched Hub
 * user id (the assignee for the inbox event). Null when none of the
 * mentioned names map to a Hub user — caller should skip the event.
 *
 * Why first-match: a Monday update that mentions multiple people would
 * otherwise need a fan-out per mention, doubling event counts. First-match
 * keeps the inbox lean; we can revisit if the team explicitly wants
 * everyone-mentioned to receive their own row.
 */
async function resolveFirstMentionToHubUser(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  mentions: Array<{ displayName: string }>,
): Promise<string | null> {
  if (mentions.length === 0) return null
  const names = mentions.map((m) => m.displayName)
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id, monday_person_name")
    .in("monday_person_name", names)
  if (!data || data.length === 0) return null

  // Preserve the order of mentions: route to the user matching the FIRST
  // mention that resolves, not whichever Postgres returned first.
  const byName = new Map<string, string>()
  for (const row of data) {
    if (row.monday_person_name && row.user_id) {
      byName.set(row.monday_person_name as string, row.user_id as string)
    }
  }
  for (const m of mentions) {
    const id = byName.get(m.displayName)
    if (id) return id
  }
  return null
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

  // Monday sends rich HTML for `body` (mention anchors, <p> wrappers, etc.)
  // We need both forms: HTML to parse the mention anchors, plain text for
  // the inbox row title/body. textBody is the plain variant when available.
  const rawHtml = event.body ?? event.value?.body ?? ""
  const rawText = event.textBody ?? event.value?.text ?? rawHtml
  const text = stripHtml(rawText)
  if (!text) return NextResponse.json({ ok: true, skipped: "empty body" })

  const userId = String(event.userId ?? "")
  const userName = event.userName ?? "Monday user"

  // Synthetic dedupe id. Prefer the new pulse+updateId shape when Monday
  // surfaces an updateId on the payload (newer event versions) so this key
  // matches what the backfill builds. Falls back to the older
  // (board, pulse, user, trigger time) shape for legacy payload variants.
  const triggerTime = event.triggerTime ?? new Date().toISOString()
  const updateId = String(event.updateId ?? "")
  const sourceMsgId = updateId
    ? `monday:update:${pulseId}:${updateId}`
    : `monday:update:${eventBoardId}:${pulseId}:${userId}:${triggerTime}`

  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("source", "monday")
    .eq("source_msg_id", sourceMsgId)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, deduped: true })

  // System author for the FK — Monday webhook ingest doesn't have a
  // session-bound user_id and we don't try to map the *poster* to a Hub
  // account (that's a different problem; the body credits them by name via
  // author_name_cached). Also satisfies the NOT NULL assignee_id for
  // timeline-only rows where no Hub user owns the row.
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (!hq?.id) {
    return NextResponse.json({ ok: false, error: "no system author" }, { status: 500 })
  }

  // Two-track ingest (per the per-client timeline requirement):
  //
  // 1. PROMOTE → an actionable row in the Tasks/Updates tabs, assigned to a
  //    Hub user, with active status that drives the sidebar badge. Requires
  //    BOTH a routable @-mention AND a non-chat classification.
  //
  // 2. TIMELINE-ONLY → a passive row that's invisible to the Inbox tabs and
  //    badges but DOES surface in the per-client timeline. Used for every
  //    other Monday update (no mention / unmapped mention / chat-classified)
  //    so finance + AMs can audit the full activity log on a client without
  //    bouncing back to Monday.
  //
  // Track 2 invisibility math:
  //   - kind="chat" → escapes the kind="task"|"update" filter on Tasks/Updates
  //     tabs and on the unreadUpdates/openTasks badges.
  //   - thread_key=null → escapes the chat substrate (Client/Team Inbox tabs
  //     and the unreadChats badge), which all filter `thread_key IS NOT NULL`.
  //   - assignee_id=hq (system) → no real Hub user is the assignee, so even
  //     a hypothetical "everything assigned to me" query stays clean.
  //   - status="read" → no unread state to ping anywhere.
  //   The per-client timeline (api/clients/[id]/timeline) only filters by
  //   `client_id`, so these still show up there — which is the whole point.
  const mentions = parseMondayMentions(rawHtml)
  const mentionedUserId = mentions.length > 0
    ? await resolveFirstMentionToHubUser(supabase, mentions)
    : null

  // Only spend Anthropic budget when there's a routable mention — otherwise
  // we already know we'll write timeline-only and the classification doesn't
  // change anything downstream.
  const classification = mentionedUserId
    ? await classifyInboxMessage({ source: "monday", authorKind: "rl_team", content: text })
    : null

  const promote = !!mentionedUserId && classification && classification.kind !== "chat"

  const titlePreview = text.length > 100 ? text.slice(0, 100) + "…" : text
  const bodyFull = text.length > 100 ? text : null

  const insertRow = promote
    ? {
        kind: classification!.kind,
        assignee_id: mentionedUserId!,
        status: classification!.kind === "task" ? "open" : "unread",
        priority: classification!.kind === "task" ? "normal" : null,
      }
    : {
        kind: "chat" as const,
        assignee_id: hq.id, // system user — keeps row out of every "assigned to me" query
        status: "read",
        priority: null,
      }

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      ...insertRow,
      client_id: pulseId, // Monday item id IS our client_id text key
      author_id: hq.id,
      title: titlePreview || `Monday update from ${userName}`,
      body: bodyFull,
      source: "monday",
      source_thread: `monday:item:${pulseId}`,
      source_msg_id: sourceMsgId,
      // thread_key intentionally null — Monday updates don't form a chat thread.
      // scope intentionally null — they live in Tasks/Updates (when promoted)
      // or in the per-client timeline (when not), never in Chat tabs.
      thread_key: null,
      scope: null,
      author_kind: "rl_team",
      author_external: userId,
      author_name_cached: userName,
      classify_conf: classification?.confidence ?? null,
      classify_method: classification ? "ai" : null,
      created_at_src: triggerTime,
      raw: payload as unknown as Record<string, unknown>,
    })
    .select("id")
    .single()

  if (error) {
    console.error("Monday webhook insert failed:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  // Push notifications only for promoted rows — the timeline-only path is
  // passive history, not someone's TODO.
  if (promote && inserted?.id) void sendInboxAssignmentPush(supabase, inserted.id)

  return NextResponse.json({
    ok: true,
    promoted: promote,
    classified: classification?.kind ?? "skipped",
    confidence: classification?.confidence ?? null,
    pulseId,
    boardId: eventBoardId,
  })
}
