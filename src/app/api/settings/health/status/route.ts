import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/settings/health/status — lightweight token-validity read.
 *
 * The full health endpoint (/api/settings/health) pings every external
 * provider on each call which is expensive. This endpoint only reads the
 * `api_tokens.is_valid` column that the full check (or the hourly cron)
 * already persisted. Cheap enough to poll from a banner mounted in the
 * dashboard layout.
 *
 * Returns the list of invalid services + when they were last verified, so
 * the banner can render a "Reconnect" CTA + a stale-data hint when the
 * cron hasn't run yet.
 */

const SERVICES = ["monday", "meta", "stripe", "trengo", "fathom"] as const

const SERVICE_LABELS: Record<(typeof SERVICES)[number], string> = {
  monday: "Monday.com",
  meta: "Meta",
  stripe: "Stripe",
  trengo: "Trengo",
  fathom: "Fathom",
}

export type ApiHealthStatusResponse = {
  invalid: Array<{
    service: (typeof SERVICES)[number]
    label: string
    /** ISO string or null when the token has never been checked. */
    lastVerified: string | null
  }>
  /** Most-recent last_verified across all services — used to warn when the
   *  cron hasn't run in a long time (status is potentially stale). Null when
   *  no token has ever been checked. */
  lastCheckedAt: string | null
}

export async function GET(): Promise<NextResponse<ApiHealthStatusResponse | { error: string }>> {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("api_tokens")
    .select("service, is_valid, last_verified")
    .in("service", [...SERVICES])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const invalid: ApiHealthStatusResponse["invalid"] = []
  let lastCheckedAt: string | null = null

  for (const row of data ?? []) {
    const service = row.service as (typeof SERVICES)[number]
    if (!SERVICES.includes(service)) continue
    if (row.is_valid === false) {
      invalid.push({
        service,
        label: SERVICE_LABELS[service],
        lastVerified: row.last_verified ?? null,
      })
    }
    if (row.last_verified && (!lastCheckedAt || row.last_verified > lastCheckedAt)) {
      lastCheckedAt = row.last_verified
    }
  }

  return NextResponse.json({ invalid, lastCheckedAt })
}
