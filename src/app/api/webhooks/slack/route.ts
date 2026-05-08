import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { verifySlackSignature } from "@/lib/integrations/slack-oauth"
import { classifyInboxMessage } from "@/lib/inbox/classify"
import { sendInboxAssignmentPush } from "@/lib/notifications/inbox-trigger"

export const maxDuration = 60

/**
 * Slack Events API webhook receiver.
 *
 * Two payload shapes Slack sends to this endpoint:
 *
 * 1. `url_verification` — Slack pings on first save with a challenge string
 *    we must echo back. Run once when configuring Event Subscriptions.
 *
 * 2. `event_callback` — actual events. We care about:
 *      - message.channels / message.groups / message.im / message.mpim
 *        (messages in any conversation the bot is a member of)
 *      - app_mention (someone @-mentions the bot in a public channel)
 *
 * All requests are HMAC-signed with SLACK_SIGNING_SECRET — we reject any
 * unsigned/old/mismatching request before doing any work.
 *
 * Like the Trengo handler, we always 200-OK fast (Slack retries on non-2xx
 * within ~3s). Heavy work runs after we've responded — actually no, we keep
 * it inline for now because the classifier + DB insert is well under that
 * budget. Move to a queue if it becomes a problem.
 */

type SlackEventPayload =
  | { type: "url_verification"; challenge: string; token: string }
  | {
      type: "event_callback"
      team_id?: string
      event: SlackEvent
    }

type SlackEvent = {
  type: string
  channel?: string
  channel_type?: "im" | "mpim" | "channel" | "group"
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  bot_id?: string
  subtype?: string
  team?: string
  // For app_mention etc.
  event_ts?: string
}

export async function POST(req: NextRequest) {
  // We need the raw body string for signature verification — reading it
  // first as text and JSON-parsing later avoids consuming the stream twice.
  const rawBody = await req.text()

  let payload: SlackEventPayload
  try {
    payload = JSON.parse(rawBody) as SlackEventPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // 1. URL verification — echo the challenge so Slack accepts the endpoint.
  // We intentionally answer this BEFORE the signature check: the challenge
  // response carries no sensitive data and Slack treats this ping as the
  // proof-of-life for the URL. Letting it through without a configured
  // SLACK_SIGNING_SECRET means the URL can be verified even on a brand-new
  // env. Every real event below still requires a valid signature.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge })
  }

  // From here on signature is required.
  const timestamp = req.headers.get("x-slack-request-timestamp")
  const signature = req.headers.get("x-slack-signature")
  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  // 2. Real events.
  if (payload.type !== "event_callback") {
    return NextResponse.json({ ok: true, ignored: payload })
  }

  const event = payload.event
  if (!event) return NextResponse.json({ ok: true, ignored: "no event" })

  // Only handle message events (and app_mention which Slack delivers as a
  // separate event type). Skip bot_messages and message_changed/deleted
  // subtypes — we don't need to ingest those for the chat substrate.
  const isMessage = event.type === "message" || event.type === "app_mention"
  if (!isMessage) return NextResponse.json({ ok: true, ignored: event.type })
  if (event.bot_id) return NextResponse.json({ ok: true, ignored: "bot_message" })
  if (event.subtype && event.subtype !== "thread_broadcast") {
    return NextResponse.json({ ok: true, ignored: `subtype:${event.subtype}` })
  }

  const text = (event.text ?? "").trim()
  if (!text) return NextResponse.json({ ok: true, skipped: "empty body" })

  const channelId = event.channel ?? ""
  const slackUserId = event.user ?? ""
  const ts = event.ts ?? event.event_ts ?? ""
  if (!channelId || !slackUserId || !ts) {
    return NextResponse.json({ ok: false, error: "missing channel/user/ts" }, { status: 400 })
  }

  // Thread key — DMs use a per-user thread, channel messages use a per-channel
  // thread. mpim (group DMs) get their own per-conversation thread.
  const channelType = event.channel_type ?? "channel"
  const threadKey =
    channelType === "im"
      ? `slack:dm:${slackUserId}`
      : channelType === "mpim"
        ? `slack:mpim:${channelId}`
        : `slack:channel:${channelId}`

  const sourceMsgId = `slack:msg:${channelId}:${ts}`
  const sourceThread = event.thread_ts
    ? `slack:thread:${channelId}:${event.thread_ts}`
    : `slack:channel:${channelId}`

  const supabase = await createAdminClient()

  // Dedupe — Slack retries on non-2xx within ~3s, sometimes also on success.
  const { data: existing } = await supabase
    .from("inbox_events")
    .select("id")
    .eq("source", "slack")
    .eq("source_msg_id", sourceMsgId)
    .maybeSingle()
  if (existing) return NextResponse.json({ ok: true, deduped: true })

  // Decide author_kind. If the slack user matches a row in user_platform_tokens
  // (i.e. they've connected Slack via OAuth), they're a Hub team member and
  // therefore "rl_team". Otherwise "external" — could be a client or anyone.
  const { data: matchedUser } = await supabase
    .from("user_platform_tokens")
    .select("user_id")
    .eq("platform", "slack")
    .filter("meta->>slack_user_id", "eq", slackUserId)
    .maybeSingle()
  const authorKind: "rl_team" | "external" = matchedUser ? "rl_team" : "external"

  // System author — webhook ingest doesn't have a session-bound user_id.
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (!hq?.id) {
    return NextResponse.json({ ok: false, error: "No system author user" }, { status: 500 })
  }

  // Classify with AI. Defaults to chat on uncertainty.
  const classification = await classifyInboxMessage({
    source: "slack",
    authorKind,
    content: text,
  })

  // Slack messages always live in the chat substrate (Team Inbox future,
  // currently DMs aren't visible due to API constraints). Classifier output
  // is still recorded for auditability and can drive auto-actions later,
  // but the row's `kind` is locked to "chat" — the dual-inbox dedup
  // depends on chat-substrate rows never showing up in Tasks/Updates.
  const status = "unread"
  const priority = null

  const titlePreview = text.length > 100 ? text.slice(0, 100) + "…" : text
  const bodyFull = text.length > 100 ? text : null

  const { data: inserted, error } = await supabase
    .from("inbox_events")
    .insert({
      kind: "chat",
      client_id: "", // slack channels aren't auto-linked to clients yet — C.5+ adds that
      author_id: hq.id,
      assignee_id: matchedUser?.user_id ?? hq.id,
      title: titlePreview || `Slack message`,
      body: bodyFull,
      status,
      priority,
      source: "slack",
      source_thread: sourceThread,
      source_msg_id: sourceMsgId,
      thread_key: threadKey,
      scope: "internal", // Slack is the team / internal channel for now
      author_kind: authorKind,
      author_external: slackUserId,
      author_name_cached: null, // resolved later via users.info if needed
      classify_conf: classification.confidence,
      classify_method: "ai",
      created_at_src: new Date(parseFloat(ts) * 1000).toISOString(),
      raw: payload as unknown as Record<string, unknown>,
    })
    .select("id")
    .single()

  if (error) {
    console.error("Slack webhook insert failed:", error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (inserted?.id) void sendInboxAssignmentPush(supabase, inserted.id)

  return NextResponse.json({
    ok: true,
    classified: classification.kind,
    confidence: classification.confidence,
    threadKey,
  })
}
