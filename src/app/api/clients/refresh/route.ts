import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { writeCache } from "@/lib/cache"
import { createAdminClient } from "@/lib/supabase/server"
import {
  invalidateKpiCachesForClients,
  runRocketLeadsCampaignMatcher,
} from "@/lib/clients/run-campaign-matcher"

/**
 * On-demand Monday boards refresh for the Clients overview. The Refresh
 * button calls this before `router.refresh()` so the server component reads
 * a freshly-written `monday_boards` cache instead of whatever the cron last
 * left there — without this, renaming a status option in Monday wouldn't
 * surface in the Hub until the next 30-min cron tick.
 *
 * Lightweight on purpose: live-fetches both boards, writes the cache, done.
 * Stripe / KPI / agreement caches refresh through their own React Query
 * `.refetch()` calls on the client.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { onboarding, current } = await fetchBothBoards()
    await writeCache("monday_boards", { onboarding, current })

    // Re-run the RL campaign matcher across the whole shared ad account so any
    // client that was added or renamed since the last cron tick gets its
    // campaigns assigned, without requiring a per-client page visit. Clear the
    // stale `rlAccountNoCampaign` flag on `kpi_daily` so the overview's "No
    // Campaign selected" badge disappears in the same refresh.
    let matcher = { assignedCount: 0, affectedMondayItemIds: [] as string[] }
    try {
      const supabase = await createAdminClient()
      matcher = await runRocketLeadsCampaignMatcher(supabase)
      if (matcher.affectedMondayItemIds.length > 0) {
        await invalidateKpiCachesForClients(matcher.affectedMondayItemIds)
      }
    } catch (e) {
      console.error("[clients/refresh] matcher failed:", e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      ok: true,
      counts: { onboarding: onboarding.length, current: current.length },
      matcher,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Monday fetch failed" },
      { status: 500 },
    )
  }
}
