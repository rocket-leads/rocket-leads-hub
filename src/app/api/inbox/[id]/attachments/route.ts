import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { NeedsConnectError } from "@/lib/inbox/reply"

/**
 * POST /api/inbox/{eventId}/attachments
 *
 * Multipart proxy: forwards a file to Trengo's draft-attachment endpoint
 * scoped to this event's ticket + channel, and returns the Trengo attachment
 * record ({ id, full_url, client_name, mime_type, ... }).
 *
 * The `id` is what the chat-pane composer collects and passes on send via
 * `attachment_ids[]` in the reply payload.
 *
 * The Trengo path used here is `/api/v2/ticket_draft_attachments` - NOT the
 * public `/attachments` endpoint, which silently drops attachment IDs and is
 * effectively non-functional for our use case (see Phase 0 audit). The path
 * we use is undocumented but stable; it's what Trengo's own web UI calls
 * when you attach a file in their composer.
 *
 * Per-user token: the upload happens AS the calling Hub user, since Trengo
 * scopes attachments to the agent who created them. Falls back to a
 * NeedsConnectError-shaped 409 if the user hasn't connected Trengo yet.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: eventId } = await params

  // Resolve the event so we know which Trengo ticket + channel the attachment
  // belongs to. Same shape as replyToInboxEvent uses.
  const supabase = await createAdminClient()
  const { data: event, error: evErr } = await supabase
    .from("inbox_events")
    .select("id, source, source_thread, trengo_channel_id")
    .eq("id", eventId)
    .maybeSingle<{
      id: string
      source: string
      source_thread: string | null
      trengo_channel_id: number | null
    }>()
  if (evErr || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }
  if (event.source !== "trengo") {
    return NextResponse.json(
      { error: `Attachments only supported on Trengo threads (event source: ${event.source})` },
      { status: 400 },
    )
  }
  const ticketId = (event.source_thread ?? "").replace(/^trengo:ticket:/, "")
  if (!ticketId) {
    return NextResponse.json({ error: "Missing Trengo ticket id on event" }, { status: 400 })
  }
  if (!event.trengo_channel_id) {
    return NextResponse.json({ error: "Missing Trengo channel id on event" }, { status: 400 })
  }

  // Forward the multipart body to Trengo. We don't parse-and-rebuild the
  // multipart payload - a fresh FormData is cheaper and avoids edge cases
  // with binary boundaries.
  let incoming: FormData
  try {
    incoming = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 })
  }
  const file = incoming.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field" }, { status: 400 })
  }

  let token: string | null
  try {
    token = await getUserPlatformToken(session.user.id, "trengo")
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Token lookup failed" },
      { status: 500 },
    )
  }
  if (!token) {
    const err = new NeedsConnectError("trengo")
    return NextResponse.json(
      { ok: false, needsConnect: err.platform, error: err.message },
      { status: 409 },
    )
  }

  const key = `ticket${ticketId}`
  const url = `https://app.trengo.com/api/v2/ticket_draft_attachments?channel_id=${event.trengo_channel_id}&key=${encodeURIComponent(key)}`

  const fd = new FormData()
  fd.append("channel_id", String(event.trengo_channel_id))
  fd.append("key", key)
  fd.append("file", file, file.name)

  let trengoRes: Response
  try {
    trengoRes = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body: fd,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `Trengo upload failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const trengoText = await trengoRes.text()
  let trengoBody: unknown
  try {
    trengoBody = JSON.parse(trengoText)
  } catch {
    trengoBody = trengoText.slice(0, 300)
  }
  if (trengoRes.status === 401 || trengoRes.status === 403) {
    // Same needs-connect bubble as the reply path: stored token rejected,
    // surface the existing reconnect prompt rather than a raw 401.
    const err = new NeedsConnectError("trengo")
    return NextResponse.json(
      { ok: false, needsConnect: err.platform, error: err.message },
      { status: 409 },
    )
  }
  if (!trengoRes.ok) {
    return NextResponse.json(
      { error: `Trengo upload failed (${trengoRes.status})`, trengo: trengoBody },
      { status: 502 },
    )
  }

  // Pass through Trengo's response so the client has everything it needs to
  // render a preview chip + collect the id for the eventual send.
  return NextResponse.json(trengoBody)
}
