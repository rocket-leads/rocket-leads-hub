import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"

/**
 * POST /api/inbox/attachment-upload  (multipart: file, channelId, key?)
 *
 * Channel-scoped Trengo draft-attachment upload for the "New message" composer,
 * which has no ticket yet (the existing per-event upload needs a ticket). The
 * returned attachment id is included as `attachment_ids` when the message is
 * sent, so Trengo attaches it to the freshly-created ticket. Uploads AS the
 * logged-in user (their personal Trengo token). Roy 2026-07-30.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get("file")
  const channelId = Number(form?.get("channelId"))
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 })
  }
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 })
  }

  const token = await getUserPlatformToken(session.user.id, "trengo")
  if (!token) {
    return NextResponse.json({ ok: false, needsConnect: "trengo" }, { status: 409 })
  }

  // A draft bucket key — Trengo needs one; it isn't tied to a real ticket, and
  // the message send references the returned attachment id directly.
  const key = (form?.get("key") as string | null)?.trim() || `newmsg-${channelId}-${session.user.id}`
  const url = `https://app.trengo.com/api/v2/ticket_draft_attachments?channel_id=${channelId}&key=${encodeURIComponent(key)}`

  let trengoRes: Response
  try {
    let attempt = 0
    for (;;) {
      const fd = new FormData()
      fd.append("channel_id", String(channelId))
      fd.append("key", key)
      fd.append("file", file, file.name)
      trengoRes = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        body: fd,
      })
      if (trengoRes.status !== 429 || attempt >= 3) break
      const ra = parseInt(trengoRes.headers.get("retry-after") ?? "", 10)
      const delay = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt
      await new Promise((r) => setTimeout(r, Math.min(delay, 8000)))
      attempt++
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Trengo upload failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  const text = await trengoRes.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text.slice(0, 300)
  }
  if (trengoRes.status === 401 || trengoRes.status === 403) {
    return NextResponse.json({ ok: false, needsConnect: "trengo" }, { status: 409 })
  }
  if (!trengoRes.ok) {
    return NextResponse.json(
      { error: `Trengo upload failed (${trengoRes.status})`, trengo: body },
      { status: 502 },
    )
  }
  const rec = (body as { data?: Record<string, unknown> })?.data ?? (body as Record<string, unknown>)
  return NextResponse.json({
    id: rec?.id,
    full_url: rec?.full_url,
    client_name: rec?.client_name,
    mime_type: rec?.mime_type,
  })
}
