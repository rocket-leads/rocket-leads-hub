import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { listChatThreads, type ChatScope } from "@/lib/inbox/fetchers"

/**
 * GET /api/inbox/threads?scope=external|internal
 *
 * Lists chat-substrate threads grouped by thread_key. Used by the Team Inbox
 * (scope=internal) and Client Inbox (scope=external) tabs. Visibility mirrors
 * the rest of the inbox: admins see everything, non-admins see threads they
 * participate in or that link to clients they have access to.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const scopeParam = req.nextUrl.searchParams.get("scope") as ChatScope | null
  if (scopeParam !== "external" && scopeParam !== "internal") {
    return NextResponse.json({ error: "scope must be external or internal" }, { status: 400 })
  }

  try {
    const threads = await listChatThreads(
      session.user.id,
      session.user.role ?? "member",
      scopeParam,
    )
    return NextResponse.json({ threads })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load threads" },
      { status: 500 },
    )
  }
}
