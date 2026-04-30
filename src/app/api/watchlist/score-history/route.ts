import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { NextResponse } from "next/server"

type BucketTotals = { action: number; watch: number; good: number }
type DailySnapshot = Record<string, BucketTotals>

export type WatchlistScoreHistoryResponse = {
  /** Map of YYYY-MM-DD → CM-keyed bucket totals. CM key "_all" = portfolio-wide. */
  history: Record<string, DailySnapshot>
}

/**
 * Returns the trailing 14 days of bucket totals, written daily by the refresh-cache cron.
 * The watchlist UI uses this to compute "today's score vs 7d-avg" deltas per filter scope.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const history = (await readCache<Record<string, DailySnapshot>>("watchlist_score_history")) ?? {}
  return NextResponse.json<WatchlistScoreHistoryResponse>({ history }, {
    headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
  })
}
