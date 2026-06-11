import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { refreshAllVerticalPatterns } from "@/lib/pedro/vertical-patterns"

/**
 * GET /api/cron/refresh-pedro-patterns
 *
 * Nightly Pedro vertical-patterns refresh. Computes, per vertical:
 *  - top winning ads (CPL-driven, last 30d)
 *  - common angles (Claude synthesis)
 *  - common hooks (Claude synthesis)
 *  - format distribution
 *
 * Upserts into pedro_vertical_patterns. Pedro reads this table during
 * angles / script / ad-copy / refresh generation as cross-client
 * inspiration - much cheaper than fanning out Meta API calls per
 * request.
 *
 * Auth: same pattern as the rest of the cron endpoints - Vercel
 * CRON_SECRET for scheduled runs, admin session for manual re-warm.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("refresh-pedro-patterns")
  const startTime = Date.now()
  const supabase = await createAdminClient()

  try {
    const results = await refreshAllVerticalPatterns(supabase)
    const duration = Date.now() - startTime
    const metrics = {
      verticals: results.length,
      synthesised: results.filter((r) => r.hadSynthesis).length,
      total_winners: results.reduce((s, r) => s + r.sample_size, 0),
      durationMs: duration,
    }
    await tracker.ok(metrics)

    return NextResponse.json({
      ok: true,
      ...metrics,
      breakdown: results.map((r) => ({
        vertical: r.vertical,
        sampleSize: r.sample_size,
        clientCount: r.client_count,
        synthesised: r.hadSynthesis,
      })),
    })
  } catch (e) {
    console.error("Pedro patterns cron failed:", e)
    await tracker.fail(e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 },
    )
  }
}
