import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import {
  getChatThreadMessages,
  markChatThreadRead,
  markChatThreadUnread,
} from "@/lib/inbox/fetchers"

/**
 * GET /api/inbox/threads/{threadKey}
 *
 * Returns all messages in a chat thread, chronologically. Visibility is
 * applied per-event so the user only sees what they're allowed to.
 *
 * threadKey is URL-encoded by the caller - typical values look like
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
 * Body: `{ action: 'mark_read' | 'mark_unread' }`.
 *
 *  - `mark_read`: flips every unread chat event in this thread (that the
 *    caller can see) to status='read'. Used by the chat pane to clear the
 *    badge as soon as the user opens a thread (Slack default).
 *  - `mark_unread`: flips the most recent visible event back to unread so
 *    the thread surfaces as unread again. Lets the user "save for later"
 *    from the inbox row or via bulk select.
 *
 * Both are idempotent.
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
  if (body.action !== "mark_read" && body.action !== "mark_unread") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  try {
    const result =
      body.action === "mark_read"
        ? await markChatThreadRead(
            threadKey,
            session.user.id,
            session.user.role ?? "member",
          )
        : await markChatThreadUnread(
            threadKey,
            session.user.id,
            session.user.role ?? "member",
          )
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : `Failed to ${body.action === "mark_read" ? "mark thread read" : "mark thread unread"}`,
      },
      { status: 500 },
    )
  }
}
