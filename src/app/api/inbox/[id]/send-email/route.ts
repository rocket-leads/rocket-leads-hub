import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { sendEmailToAddressAsUser } from "@/lib/integrations/trengo"
import { NeedsConnectError } from "@/lib/inbox/reply"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { stripHtml } from "@/lib/html"
import { NextRequest, NextResponse } from "next/server"

/**
 * POST /api/inbox/{eventId}/send-email
 *
 * Send a NEW email (fresh Trengo ticket) from the inbox email composer, used
 * whenever the AM changes the From channel or the To recipient, or forwards a
 * mail - none of which a Trengo *reply* can express (a reply is bound to the
 * ticket's own channel + contact). A normal, unchanged reply still goes through
 * `/reply` and threads under the original conversation.
 *
 * `{eventId}` anchors the send to the thread the composer is open on: we read
 * its `thread_key` / `client_id` / `scope` so the outbound is mirrored back
 * into the SAME Hub conversation the AM was looking at.
 *
 * Sends AS the logged-in user (their personal Trengo token) so the customer
 * sees the AM's name, not a system bot. The composer already assembled the
 * rich HTML (message + signature) - we pass it straight through.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const { id: eventId } = await params

  let body: {
    fromChannelId?: number
    to?: string[]
    cc?: string[]
    bcc?: string[]
    subject?: string
    html?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const fromChannelId = Number(body.fromChannelId)
  const to = (body.to ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const cc = (body.cc ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const bcc = (body.bcc ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const subject = (body.subject ?? "").trim()
  const html = typeof body.html === "string" ? body.html : ""

  if (!Number.isFinite(fromChannelId) || fromChannelId <= 0) {
    return NextResponse.json({ error: "fromChannelId required" }, { status: 400 })
  }
  if (to.length === 0) {
    return NextResponse.json({ error: "At least one To recipient required" }, { status: 400 })
  }
  if (!html.trim()) {
    return NextResponse.json({ error: "Empty email body" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Anchor to the thread the composer is open on so the mirror lands in-context.
  const { data: event } = await supabase
    .from("inbox_events")
    .select("id, client_id, thread_key, scope")
    .eq("id", eventId)
    .maybeSingle<{
      id: string
      client_id: string | null
      thread_key: string | null
      scope: string | null
    }>()
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }

  const token = await getUserPlatformToken(userId, "trengo")
  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        needsConnect: "trengo",
        error: "Connect your Trengo account first via /account.",
      },
      { status: 401 },
    )
  }

  // Trengo's new-ticket flow binds one primary contact; any additional To
  // recipients ride along as CC so everyone still receives it.
  const primaryTo = to[0]
  const extraTo = to.slice(1)
  const ccAll = [...extraTo, ...cc]

  let outboundId: string
  let ticketId: string
  try {
    const sent = await sendEmailToAddressAsUser({
      userToken: token,
      channelId: fromChannelId,
      email: primaryTo,
      name: primaryTo,
      subject: subject || "(no subject)",
      body: html,
      bodyIsHtml: true,
      cc: ccAll,
      bcc,
    })
    outboundId = sent.messageId
    ticketId = sent.ticketId
  } catch (e) {
    if (e instanceof NeedsConnectError) {
      return NextResponse.json(
        { ok: false, needsConnect: "trengo", error: e.message },
        { status: 401 },
      )
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Send failed" },
      { status: 502 },
    )
  }

  // Mirror the outbound into inbox_events under the current thread so the AM
  // sees what they sent in the same conversation view. Plain-text preview from
  // the HTML (the chat pane renders body_html when present; we keep the html so
  // the mirrored card shows the real formatting).
  const { data: hubUser } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle<{ name: string | null; email: string | null }>()

  const preview = stripHtml(html)
  const titlePreview = preview.length > 100 ? preview.slice(0, 100) + "…" : preview
  const bodyFull = preview.length > 100 ? preview : null
  const createdAtSrc = new Date().toISOString()

  const { data: inserted } = await supabase
    .from("inbox_events")
    .insert({
      kind: "chat",
      client_id: event.client_id ?? "",
      author_id: userId,
      assignee_id: userId,
      title: titlePreview || `Email to ${primaryTo}`,
      body: bodyFull,
      body_html: html,
      email_subject: subject || null,
      email_from: null,
      status: "read",
      source: "trengo",
      source_thread: `trengo:ticket:${ticketId}`,
      source_msg_id: `trengo:msg:${outboundId}`,
      thread_key: event.thread_key,
      scope: event.scope ?? "external",
      author_kind: "rl_team",
      author_external: null,
      author_name_cached: hubUser?.name ?? hubUser?.email ?? null,
      classify_method: "manual",
      created_at_src: createdAtSrc,
      trengo_channel_id: fromChannelId,
      is_internal: false,
    })
    .select("id")
    .single()

  return NextResponse.json({
    ok: true,
    outboundMsgId: outboundId,
    ticketId,
    inboxEventId: (inserted?.id as string) ?? "",
  })
}
