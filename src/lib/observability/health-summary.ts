import { createAdminClient } from "@/lib/supabase/server"

/**
 * Cheap one-shot health summary for the sidebar dot. Two queries against
 * Supabase, both indexed — runs on every admin sidebar render but stays
 * well under 50ms on a warm connection.
 *
 * Lit when EITHER:
 *   - any expected integration (api_tokens.is_valid = false), OR
 *   - any cron has errored in the last 24h.
 *
 * Returning the counts (not just a boolean) so the tooltip can say what's
 * actually wrong without the user having to click into /settings/health.
 */
export type HealthSummary = {
  /** Whether the dot should light up at all. */
  needsAttention: boolean
  /** Cron runs with status != 'ok' in the last 24h. */
  recentErrors: number
  /** Connected integrations that report is_valid = false. */
  invalidIntegrations: number
}

export const HEALTHY_SUMMARY: HealthSummary = {
  needsAttention: false,
  recentErrors: 0,
  invalidIntegrations: 0,
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Fetches the summary. On any failure (Supabase down, RLS denial, schema
 * miss) returns HEALTHY_SUMMARY rather than throwing — the sidebar must
 * never crash because observability tooling is itself broken.
 */
export async function fetchHealthSummary(now: number = Date.now()): Promise<HealthSummary> {
  try {
    const supabase = await createAdminClient()
    const cutoff = new Date(now - ONE_DAY_MS).toISOString()

    const [errorsRes, tokensRes] = await Promise.all([
      supabase
        .from("cron_runs")
        .select("cron_name", { count: "exact", head: true })
        .neq("status", "ok")
        .gte("started_at", cutoff),
      supabase.from("api_tokens").select("service, is_valid"),
    ])

    const recentErrors = errorsRes.count ?? 0
    const invalidIntegrations = (tokensRes.data ?? []).filter((t) => t.is_valid === false).length

    return {
      needsAttention: recentErrors > 0 || invalidIntegrations > 0,
      recentErrors,
      invalidIntegrations,
    }
  } catch {
    return HEALTHY_SUMMARY
  }
}
