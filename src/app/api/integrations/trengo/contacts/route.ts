import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchTrengoContacts } from "@/lib/integrations/trengo"

/**
 * GET /api/integrations/trengo/contacts?q=<query>&limit=<n>
 *
 * Backs the search list inside <ConnectedEntity service="trengo-contact">.
 * Uses Trengo's native `/contacts?term=` substring search - no in-memory
 * cache because the contact pool is too large; one Trengo round-trip per
 * unique query string, deduped by React Query.
 *
 * Empty query returns the first page (most-recently-created contacts) so
 * the picker isn't blank on cold-open.
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
    const entities = await searchTrengoContacts(q, limit)
    return NextResponse.json({ entities })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Trengo contact search failed" },
      { status: 500 },
    )
  }
}
