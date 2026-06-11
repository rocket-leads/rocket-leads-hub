import { auth } from "@/lib/auth"
import { fetchConversations } from "@/lib/integrations/trengo"
import { cachedFetch } from "@/lib/cache"
import { checkTabAccess } from "@/lib/clients/access"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params

  // Gate the conversation history on per-client communication access.
  // Pure CMs return Forbidden (Roy 2026-06-11) - client conversations
  // are an AM workflow.
  const canViewComm = await checkTabAccess(
    session.user.id,
    session.user.role ?? "member",
    mondayItemId,
    "communication",
  )
  if (!canViewComm) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const trengoContactId = req.nextUrl.searchParams.get("trengoContactId")
  if (!trengoContactId) {
    return NextResponse.json({ error: "No Trengo Contact ID provided." }, { status: 400 })
  }

  try {
    const conversations = await cachedFetch(
      `trengo_conversations:${trengoContactId}`,
      () => fetchConversations(trengoContactId),
    )
    return NextResponse.json(conversations, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch conversations" },
      { status: 500 }
    )
  }
}
