import { auth } from "@/lib/auth"
import { listReactionsForItems } from "@/lib/inbox/reactions"
import { NextRequest, NextResponse } from "next/server"

/**
 * GET /api/inbox/reactions?itemIds=a,b,c
 *
 * Bulk reaction summaries for a page of feed items - one query for the whole
 * visible list instead of one per card. The itemIds come from the caller's
 * already-visibility-filtered feed, so we don't re-check per-item access here
 * (reactions aren't sensitive; the worst case is a count the user could see
 * anyway on an item in their own feed).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const raw = req.nextUrl.searchParams.get("itemIds")
  const itemIds = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : []
  const reactions = await listReactionsForItems(itemIds, session.user.id)
  return NextResponse.json({ reactions })
}
