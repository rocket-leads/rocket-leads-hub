import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { computeBatchClientHealth, type ClientHealth } from "@/lib/integrations/health"

/**
 * POST /api/integrations/health
 *
 * Batched connection-health audit for the Clients tab. Body:
 *   {
 *     mondayItemIds: string[]  // omit/empty → audit every client
 *     bypassCache?: boolean    // force re-resolve (manual Refresh)
 *   }
 *
 * Returns:
 *   { health: Record<mondayItemId, ClientHealth> }
 *
 * Each ClientHealth carries per-service state (ok | broken | missing |
 * not_used | warning) + an aggregated `brokenCount` the UI uses for the
 * row badge and the "Broken connections (N)" tab filter.
 *
 * Performance: cached per-client for 1h in `cache_store`. First-time
 * audit of 100 clients with all 5 services linked is ~30s with 6-way
 * concurrency; subsequent loads are sub-second (cache hits).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    mondayItemIds?: string[]
    bypassCache?: boolean
  }
  const requestedIds = Array.isArray(body.mondayItemIds) ? body.mondayItemIds : []
  const bypassCache = body.bypassCache === true

  try {
    // We re-fetch the Monday client list here rather than trusting client-
    // posted MondayClient blobs — keeps the audit a pure read-only server-
    // side compute (the client only sends IDs), and ensures we audit the
    // current Monday state, not whatever was in the page's cache.
    const { onboarding, current } = await fetchBothBoards()
    const all = [...onboarding, ...current]
    const filtered = requestedIds.length > 0
      ? all.filter((c) => requestedIds.includes(c.mondayItemId))
      : all

    const health = await computeBatchClientHealth(filtered, { bypassCache })
    return NextResponse.json({ health } satisfies { health: Record<string, ClientHealth> })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Health audit failed" },
      { status: 500 },
    )
  }
}
