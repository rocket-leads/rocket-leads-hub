import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { sendEmailToAddressAsUser } from "@/lib/integrations/trengo"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { sendTrengoTemplateToPhoneAsUser, NeedsConnectError } from "@/lib/inbox/reply"

/**
 * POST /api/inbox/new-message
 *
 * Compose a brand-new conversation from scratch (the "New message" flow),
 * Trengo-style: pick a channel, then send either an EMAIL (fresh ticket via
 * the address) or a WhatsApp TEMPLATE (to a phone number). Sends AS the
 * logged-in Hub user via their personal Trengo token.
 *
 * Body (email):    { channelId, kind: "email", to, subject?, html }
 * Body (whatsapp): { channelId, kind: "whatsapp", to, templateName, templateParams? }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const body = (await req.json().catch(() => null)) as {
    channelId?: number
    kind?: "email" | "whatsapp"
    to?: string
    cc?: unknown[]
    bcc?: unknown[]
    subject?: string
    html?: string
    templateName?: string
    templateParams?: unknown[]
  } | null

  const channelId = Number(body?.channelId)
  const kind = body?.kind
  const to = (body?.to ?? "").trim()
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 })
  }
  if (kind !== "email" && kind !== "whatsapp") {
    return NextResponse.json({ error: "kind must be email or whatsapp" }, { status: 400 })
  }
  if (!to) {
    return NextResponse.json({ error: "recipient required" }, { status: 400 })
  }

  try {
    if (kind === "email") {
      const html = (body?.html ?? "").trim()
      if (!html) return NextResponse.json({ error: "email body required" }, { status: 400 })
      const userToken = await getUserPlatformToken(userId, "trengo")
      if (!userToken) {
        return NextResponse.json({ ok: false, needsConnect: "trengo" }, { status: 409 })
      }
      const toStrArr = (v: unknown[] | undefined): string[] =>
        Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []
      const sent = await sendEmailToAddressAsUser({
        userToken,
        channelId,
        email: to,
        name: to,
        subject: (body?.subject ?? "").trim() || "(no subject)",
        body: html,
        bodyIsHtml: true,
        cc: toStrArr(body?.cc),
        bcc: toStrArr(body?.bcc),
      })
      return NextResponse.json({ ok: true, ticketId: sent.ticketId, messageId: sent.messageId })
    }

    // WhatsApp template send to a phone number.
    const templateName = (body?.templateName ?? "").trim()
    if (!templateName) {
      return NextResponse.json({ error: "templateName required" }, { status: 400 })
    }
    const params = Array.isArray(body?.templateParams)
      ? body!.templateParams.map((p) => String(p ?? ""))
      : []
    const phone = to.replace(/[^\d+]/g, "")
    if (!phone) return NextResponse.json({ error: "valid phone required" }, { status: 400 })
    const sent = await sendTrengoTemplateToPhoneAsUser(
      userId,
      phone,
      templateName,
      params,
      channelId,
    )
    return NextResponse.json({ ok: true, messageId: sent.message_id })
  } catch (e) {
    if (e instanceof NeedsConnectError) {
      return NextResponse.json(
        { ok: false, needsConnect: e.platform, error: e.message },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Send failed" },
      { status: 500 },
    )
  }
}
