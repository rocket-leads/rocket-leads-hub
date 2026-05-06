import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { getChatThreadMessages, markChatThreadRead } from "@/lib/inbox/fetchers"

/**
 * GET /api/inbox/threads/{threadKey}
 *
 * Returns all messages in a chat thread, chronologically. Visibility is
 * applied per-event so the user only sees what they're allowed to.
 *
 * threadKey is URL-encoded by the caller — typical values look like
 * "trengo:contact:42" or "slack:dm:U023BECGF".
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadKey: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { threadKey: encoded } = await params
  const threadKey = decodeURIComponent(encoded)
  if (!threadKey) {
    return NextResponse.json({ error: "threadKey required" }, { status: 400 })
  }

  try {
    const messages = await getChatThreadMessages(
      threadKey,
      session.user.id,
      session.user.role ?? "member",
    )
    return NextResponse.json({ threadKey, messages })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load thread messages" },
      { status: 500 },
    )
  }
}

/**
 * PATCH /api/inbox/threads/{threadKey}
 *
 * Body: `{ action: 'mark_read' }`. Flips every unread chat event in this
 * thread (that the caller can see) to status='read'. Idempotent — calling
 * it on an already-read thread is a no-op. Used by the chat pane to clear
 * the thread's unread badge as soon as the user opens it (Slack default).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadKey: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { threadKey: encoded } = await params
  const threadKey = decodeURIComponent(encoded)
  if (!threadKey) {
    return NextResponse.json({ error: "threadKey required" }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { action?: string }
  if (body.action !== "mark_read") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  try {
    const result = await markChatThreadRead(
      threadKey,
      session.user.id,
      session.user.role ?? "member",
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to mark thread read" },
      { status: 500 },
    )
  }
}
