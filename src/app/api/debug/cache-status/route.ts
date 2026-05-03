import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Admin diagnostic — lists every row in cache_store with its age and approximate
 * payload size. Used to answer "is the cron still warming the cache" without
 * having to open the Supabase studio. Hit it from the browser while signed in
 * as admin: GET /api/debug/cache-status.
 *
 * Response shape:
 *   {
 *     now: "2026-05-03T...",
 *     rows: [
 *       { key, updatedAt, ageMinutes, ageHuman, sizeKB, perClientCount? },
 *       ...
 *     ]
 *   }
 *
 * `perClientCount` is populated for the keys we know are keyed by client id
 * (kpi_summaries, kpi_daily, billing_summaries, monday_active_map) so a glance
 * tells you whether all clients made it into the cache or the cron failed
 * partway through.
 */
export async function GET() {
  const session = await auth()
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("cache_store")
    .select("key, updated_at, data")
    .order("key")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const now = Date.now()
  const PER_CLIENT_KEYS = new Set(["kpi_summaries", "kpi_daily", "billing_summaries"])

  const rows = (data ?? []).map((r) => {
    const updatedAt = r.updated_at ? new Date(r.updated_at).getTime() : 0
    const ageMs = updatedAt > 0 ? now - updatedAt : Infinity
    const ageMinutes = Math.round(ageMs / 60000)
    const ageHuman = ageMs === Infinity
      ? "never"
      : ageMinutes < 60
        ? `${ageMinutes}m ago`
        : ageMinutes < 1440
          ? `${Math.round(ageMinutes / 60)}h ago`
          : `${Math.round(ageMinutes / 1440)}d ago`

    // Approx size — JSON.stringify is the same the cache_store column already used.
    let sizeKB = 0
    try { sizeKB = Math.round(JSON.stringify(r.data).length / 1024) } catch { /* noop */ }

    let perClientCount: number | undefined
    if (PER_CLIENT_KEYS.has(r.key) && r.data && typeof r.data === "object") {
      perClientCount = Object.keys(r.data as Record<string, unknown>).length
    }

    return {
      key: r.key,
      updatedAt: r.updated_at,
      ageMinutes,
      ageHuman,
      sizeKB,
      ...(perClientCount !== undefined ? { perClientCount } : {}),
    }
  })

  return NextResponse.json({ now: new Date(now).toISOString(), rows })
}
