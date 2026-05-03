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
  const body = (await req.json().catch(() => null)) as { message?: string } | null
  if (!body?.message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 })
  }

  try {
    const result = await replyToInboxEvent(session.user.id, id, body.message)
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
