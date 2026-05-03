import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { getChatThreadMessages } from "@/lib/inbox/fetchers"

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
