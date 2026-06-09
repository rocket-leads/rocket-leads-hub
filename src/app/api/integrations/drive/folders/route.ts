import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { searchDriveFolders } from "@/lib/integrations/google-drive"

/**
 * GET /api/integrations/drive/folders?q=<query>&limit=<n>
 *
 * Backs the search list inside <ConnectedEntity service="drive-folder">.
 * Uses Drive's native `q=name contains '...'` filter — no in-memory cache
 * needed because Drive's search is server-side and fast enough for the
 * single round-trip per unique query (deduped by React Query).
 *
 * Cold-open (empty query) returns the most-recently-modified folders so
 * the picker shows "folders I actually use" first.
 *
 * Scope: only folders the service account has been shared into appear.
 * That's the right boundary — workspace folders that the service account
 * can't see aren't valid link candidates from the Hub anyway.
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
    const entities = await searchDriveFolders(q, limit)
    return NextResponse.json({ entities })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Drive folder search failed" },
      { status: 500 },
    )
  }
}
