import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchMetaAdAccounts } from "@/lib/integrations/meta"

/**
 * GET /api/integrations/meta/ad-accounts?q=<query>&limit=<n>
 *
 * Backs the search list inside <ConnectedEntity service="meta-ad-account">.
 * Meta's `/me/adaccounts` endpoint has no name-filter, so the underlying
 * lib caches the full accessible-accounts list for 5 minutes and substring-
 * matches client-side - see `searchMetaAdAccounts` for ranking details.
 *
 * Cold-open (empty query) returns active accounts first, then everything
 * else, alphabetical within each group.
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
    const entities = await searchMetaAdAccounts(q, limit)
    return NextResponse.json({ entities })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta ad account search failed" },
      { status: 500 },
    )
  }
}
