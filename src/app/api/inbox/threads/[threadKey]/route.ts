import { auth } from "@/lib/auth"
import { after, NextRequest, NextResponse } from "next/server"
import {
  getChatThreadMessages,
  markChatThreadRead,
  markChatThreadUnread,
  setChatThreadArchived,
  setChatThreadSnoozedUntil,
  setChatThreadStarred,
} from "@/lib/inbox/fetchers"
import { syncThreadArchiveToTrengo } from "@/lib/inbox/trengo-sync"

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

  const body = (await req.json().catch(() => ({}))) as {
    action?: string
    /** ISO timestamp for `snooze`. Required when action='snooze'; null
     *  or omitted clears the snooze. */
    until?: string | null
  }
  const action = body.action
  const supportedActions = new Set([
    "mark_read",
    "mark_unread",
    "star",
    "unstar",
    "archive",
    "unarchive",
    "snooze",
    "unsnooze",
  ])
  if (!action || !supportedActions.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const userId = session.user.id
  const role = session.user.role ?? "member"

  try {
    let result: { updated: number } = { updated: 0 }
    switch (action) {
      case "mark_read":
        result = await markChatThreadRead(threadKey, userId, role)
        break
      case "mark_unread":
        result = await markChatThreadUnread(threadKey, userId, role)
        break
      case "star":
        result = await setChatThreadStarred(threadKey, userId, role, true)
        break
      case "unstar":
        result = await setChatThreadStarred(threadKey, userId, role, false)
        break
      case "archive":
        result = await setChatThreadArchived(threadKey, userId, role, true)
        // `after()` keeps the serverless function alive after we've
        // returned the JSON response, so the Trengo close-call gets to
        // finish reliably. A plain `void promise` would race the
        // function-instance shutdown on Vercel and silently lose ~5%
        // of mirror writes. The archive-state in Supabase is
        // authoritative; the Trengo mirror is best-effort either way,
        // but `after()` makes "best-effort" actually best-effort.
        after(syncThreadArchiveToTrengo({ threadKey, userId, archived: true }))
        break
      case "unarchive":
        result = await setChatThreadArchived(threadKey, userId, role, false)
        after(syncThreadArchiveToTrengo({ threadKey, userId, archived: false }))
        break
      case "snooze": {
        // Validate the until timestamp before writing it - silently
        // accepting null would clear the snooze (which is what
        // `unsnooze` is for), and accepting garbage would corrupt the
        // rollup. Require a parseable future ISO string.
        const until = body.until ?? null
        if (!until || isNaN(new Date(until).getTime())) {
          return NextResponse.json(
            { error: "snooze requires a valid `until` ISO timestamp" },
            { status: 400 },
          )
        }
        result = await setChatThreadSnoozedUntil(threadKey, userId, role, until)
        break
      }
      case "unsnooze":
        result = await setChatThreadSnoozedUntil(threadKey, userId, role, null)
        break
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : `Failed to ${action}`,
      },
      { status: 500 },
    )
  }
}
