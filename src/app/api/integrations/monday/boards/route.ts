import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchMondayBoards } from "@/lib/integrations/monday"

/**
 * GET /api/integrations/monday/boards?q=<query>&limit=<n>
 *
 * Backs the search list inside <ConnectedEntity service="monday-board">.
 * Returns up to `limit` ResolvedEntity rows for the query. Monday's GraphQL
 * has no name-filter on its `boards` query, so search is done in-memory
 * against a 5-minute cached list of all accessible boards — see
 * `searchMondayBoards` for the cache + ranking story.
 *
 * Cold-open (empty query) returns the most-recently-used boards so the AM
 * lands on "boards I actually work with" instead of every legacy board the
 * token can see.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get("q") ?? ""
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 10, 1), 25) : 10

  try {
    const entities = await searchMondayBoards(q, limit)
    return NextResponse.json({ entities })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monday board search failed" },
      { status: 500 },
    )
  }
}
