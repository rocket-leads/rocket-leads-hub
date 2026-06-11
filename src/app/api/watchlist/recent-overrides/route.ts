import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"
import type { StoredOverride } from "@/lib/watchlist/learning"

export type RecentOverridesResponse = {
  overrides: StoredOverride[]
}

/**
 * Last 30 days of overrides across all clients, surfaced as a flat list for
 * the dashboard's learning layer. The dashboard runs `suggestAiAdjustment`
 * against this list for every live client on render - pattern matching
 * happens client-side so the suggestion updates the moment a new override
 * lands (no cron lag).
 *
 * 30-day window is the trade-off: long enough that we accumulate enough
 * supporting overrides for a high-confidence match, short enough that
 * yesterday's strategy doesn't get overweighted by something the team
 * decided three months ago in a different market context.
 */
export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // We pull EVERY override - expired or not - because the learning corpus is
  // the full history of CM decisions, not just what's currently active. An
  // expired-by-time override is still a valid signal that "the team made
  // this call when the data looked like X".
  const { data, error } = await supabase
    .from("watchlist_overrides")
    .select("monday_item_id, to_category, from_category, reason, created_at, kpi_snapshot")
    .gte("created_at", thirtyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    console.error("[recent-overrides] read failed:", error.message)
    return NextResponse.json<RecentOverridesResponse>({ overrides: [] }, { status: 200 })
  }

  const overrides: StoredOverride[] = (data ?? []).map((r) => ({
    mondayItemId: r.monday_item_id,
    toCategory: r.to_category as "action" | "watch" | "good",
    fromCategory: r.from_category as "action" | "watch" | "good" | "no-data" | null,
    reason: r.reason,
    createdAt: r.created_at,
    kpiSnapshot: r.kpi_snapshot ?? null,
  }))

  return NextResponse.json<RecentOverridesResponse>(
    { overrides },
    { headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" } },
  )
}
