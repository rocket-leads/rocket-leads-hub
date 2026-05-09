import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { createAdminClient } from "@/lib/supabase/server"
import { runMonthlyDigestForAllClients } from "@/lib/pedro/monthly-digest"
import { startCronRun } from "@/lib/observability/cron-runs"

/**
 * GET /api/cron/pedro-monthly-digest
 *
 * Fires on the 1st of every month at 09:00. For every Live client
 * with a Meta ad account and ≥1 €spend in the last 30 days, Pedro
 * composes a four-section month-review (winners / losers / focus /
 * risks) and lands it as a single inbox task assigned to that
 * client's CM.
 *
 * Output of this cron: one task per Live client per month, dedup'd
 * via source_ref->>monthYear so re-runs in the same month are no-ops.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  const tracker = startCronRun("pedro-monthly-digest")
  try {
    const result = await runMonthlyDigestForAllClients(supabase)
    if (result.failed > 0) {
      await tracker.partial(
        `${result.failed} of ${result.attempted} digests failed`,
        result as unknown as Record<string, unknown>,
      )
    } else {
      await tracker.ok(result as unknown as Record<string, unknown>)
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error("Pedro monthly digest cron failed:", e)
    await tracker.fail(e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    )
  }
}
