import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { listChatThreads, type ChatScope } from "@/lib/inbox/fetchers"

/**
 * GET /api/inbox/threads?scope=external|internal[&mentionsOnly=true]
 *
 * Lists chat-substrate threads grouped by thread_key. Used by the Team Inbox
 * (scope=internal) and Client Inbox (scope=external) tabs. Visibility mirrors
 * the rest of the inbox: admins see everything, non-admins see threads they
 * participate in or that link to clients they have access to.
 *
 * `mentionsOnly=true` (Roy 2026-06-09 — CM Mentions tab): strips the
 * channel-subscription + client-access visibility paths and keeps only
 * `assignee_id = current_user`. The CM sees nothing except threads where
 * they've been explicitly @-mentioned or hand-routed.
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

  const mentionsOnly = req.nextUrl.searchParams.get("mentionsOnly") === "true"

  try {
    const threads = await listChatThreads(
      session.user.id,
      session.user.role ?? "member",
      scopeParam,
      { mentionsOnly },
    )
    return NextResponse.json({ threads })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load threads" },
      { status: 500 },
    )
  }
}
