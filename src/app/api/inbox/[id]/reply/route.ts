import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { replyToInboxEvent, NeedsConnectError } from "@/lib/inbox/reply"

/**
 * POST /api/inbox/{eventId}/reply { message: string }
 *
 * Sends a reply to the source platform of this inbox event AS the logged-in
 * Hub user. Mirrors the sent message back into inbox_events so the thread
 * history in the Hub stays complete.
 *
 * Returns 409 with { needsConnect: "<platform>" } when the user hasn't
 * connected the relevant platform yet — the UI uses that to render a
 * "Connect <platform> first" prompt with a deep-link to /account.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = (await req.json().catch(() => null)) as
    | {
        message?: string
        internalNote?: boolean
        attachmentIds?: number[]
        template?: { name?: string; language?: string; params?: unknown[]; body?: string }
        email?: {
          subject?: string
          cc?: unknown[]
          bcc?: unknown[]
          html?: string
        }
      }
    | null
  const message = (body?.message ?? "").toString()
  const attachmentIds = Array.isArray(body?.attachmentIds)
    ? body.attachmentIds.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : []
  const template = body?.template
    ? {
        name: String(body.template.name ?? "").trim(),
        language: String(body.template.language ?? "").trim(),
        params: Array.isArray(body.template.params)
          ? body.template.params.map((p) => String(p ?? ""))
          : [],
        body: typeof body.template.body === "string" ? body.template.body : undefined,
      }
    : undefined
  const email = body?.email
    ? {
        subject:
          typeof body.email.subject === "string" && body.email.subject.trim()
            ? body.email.subject
            : undefined,
        cc: Array.isArray(body.email.cc)
          ? body.email.cc.map((s) => String(s ?? "").trim()).filter(Boolean)
          : undefined,
        bcc: Array.isArray(body.email.bcc)
          ? body.email.bcc.map((s) => String(s ?? "").trim()).filter(Boolean)
          : undefined,
        html: typeof body.email.html === "string" ? body.email.html : undefined,
      }
    : undefined

  if (template && (!template.name || !template.language)) {
    return NextResponse.json(
      { error: "template.name and template.language required" },
      { status: 400 },
    )
  }
  if (!template && !message.trim() && attachmentIds.length === 0 && !email?.html?.trim()) {
    return NextResponse.json(
      { error: "message, template, html body, or at least one attachment required" },
      { status: 400 },
    )
  }

  try {
    const result = await replyToInboxEvent(session.user.id, id, message, {
      internalNote: body?.internalNote === true,
      attachmentIds,
      template,
      email,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    if (e instanceof NeedsConnectError) {
      return NextResponse.json(
        { ok: false, needsConnect: e.platform, error: e.message },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Reply failed" },
      { status: 500 },
    )
  }
}
