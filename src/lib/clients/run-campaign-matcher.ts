import { fetchMetaCampaigns } from "@/lib/integrations/meta"
import { ROCKET_LEADS_AD_ACCOUNT_ID } from "@/lib/clients/ad-account"
import { matchRocketLeadsCampaign } from "@/lib/clients/campaign-matcher"
import { readCache, writeCache } from "@/lib/cache"
import type { KpiDailyCache } from "@/app/api/kpi-summaries/route"

type Supabase = Awaited<ReturnType<typeof import("@/lib/supabase/server").createAdminClient>>

export type MatcherRunResult = {
  /** Number of new campaign rows upserted across all RL clients. */
  assignedCount: number
  /** Monday item IDs of clients that received at least one new assignment.
   *  Callers use this to invalidate stale caches (e.g. `kpi_daily`'s
   *  `rlAccountNoCampaign` flag) so the UI reflects the new state without
   *  waiting for the 30-min cron. */
  affectedMondayItemIds: string[]
}

/**
 * Auto-assign Rocket Leads-account campaigns to the right client based on the
 * company name segment of `RL | NL | XX | Company | LP`. Runs across the full
 * RL ad account in one pass — used by both the per-client campaigns endpoint
 * (where it covers the visible client) and the global refresh endpoint
 * (which fans it out across every RL client without requiring page visits).
 *
 * Idempotent: campaigns already in `client_campaigns` for any RL client are
 * skipped, so user deselections (rows with is_selected=false) and earlier
 * matches don't get re-touched. Only campaigns ≥0.95 match confidence are
 * auto-assigned; ambiguous ones stay unassigned for manual selection.
 */
export async function runRocketLeadsCampaignMatcher(
  supabase: Supabase,
): Promise<MatcherRunResult> {
  const { data: rlClients } = await supabase
    .from("clients")
    .select("id, monday_item_id, name, meta_ad_account_id")
    .or(
      `meta_ad_account_id.eq.${ROCKET_LEADS_AD_ACCOUNT_ID},meta_ad_account_id.eq.act_${ROCKET_LEADS_AD_ACCOUNT_ID}`,
    )

  const candidates = (rlClients ?? [])
    .filter((c): c is { id: string; monday_item_id: string; name: string; meta_ad_account_id: string } =>
      Boolean(c.id && c.monday_item_id && c.name),
    )
  if (candidates.length === 0) return { assignedCount: 0, affectedMondayItemIds: [] }

  const candidateIds = candidates.map((c) => c.id)

  let campaigns: Awaited<ReturnType<typeof fetchMetaCampaigns>>
  try {
    campaigns = await fetchMetaCampaigns(ROCKET_LEADS_AD_ACCOUNT_ID)
  } catch (e) {
    console.error("[matcher] Meta fetch failed:", e instanceof Error ? e.message : e)
    return { assignedCount: 0, affectedMondayItemIds: [] }
  }

  const { data: existing } = await supabase
    .from("client_campaigns")
    .select("meta_campaign_id")
    .in("client_id", candidateIds)
  const globallyAssigned = new Set((existing ?? []).map((r) => r.meta_campaign_id))

  const idToMondayItem = new Map(candidates.map((c) => [c.id, c.monday_item_id]))
  const affectedSet = new Set<string>()
  const newRows: Array<{
    client_id: string
    meta_campaign_id: string
    campaign_name: string
    is_selected: boolean
  }> = []

  for (const c of campaigns) {
    if (c.status !== "ACTIVE") continue
    if (globallyAssigned.has(c.id)) continue
    const match = matchRocketLeadsCampaign(
      c.name,
      candidates.map((cd) => ({ id: cd.id, name: cd.name })),
    )
    if (!match || match.confidence < 0.95) continue
    newRows.push({
      client_id: match.clientId,
      meta_campaign_id: c.id,
      campaign_name: c.name,
      is_selected: true,
    })
    const itemId = idToMondayItem.get(match.clientId)
    if (itemId) affectedSet.add(itemId)
  }

  if (newRows.length === 0) return { assignedCount: 0, affectedMondayItemIds: [] }

  await supabase.from("client_campaigns").upsert(newRows, {
    onConflict: "client_id,meta_campaign_id",
  })

  return {
    assignedCount: newRows.length,
    affectedMondayItemIds: Array.from(affectedSet),
  }
}

/**
 * Invalidate cached KPIs for clients whose campaign selections just changed
 * (auto-matched or manually picked). Removes their entries from both
 * `kpi_daily` AND `kpi_summaries` so the next `/api/kpi-summaries` call
 * falls through to a live fetch for those clients — kpi-summaries was
 * extended to live-fetch missing-from-cache clients exactly for this case.
 *
 * Without this, the UI would keep rendering the pre-selection numbers
 * (typically all-zeros + `rlAccountNoCampaign`) until the next 30-min KPI
 * cron, which is what made HGR / Inland Invest / etc. look empty in the
 * overview after their campaigns had been linked.
 *
 * Best-effort: a write failure just means the user sees stale numbers
 * until the cron catches up — same fallback as the original flag-clear.
 */
export async function invalidateKpiCachesForClients(mondayItemIds: string[]): Promise<void> {
  if (mondayItemIds.length === 0) return
  try {
    const ids = new Set(mondayItemIds)
    const [daily, summaries] = await Promise.all([
      readCache<KpiDailyCache>("kpi_daily"),
      readCache<Record<string, unknown>>("kpi_summaries"),
    ])

    const writes: Array<Promise<void>> = []

    if (daily) {
      const next: KpiDailyCache = {}
      let touched = false
      for (const [k, v] of Object.entries(daily)) {
        if (ids.has(k)) {
          touched = true
          continue
        }
        next[k] = v
      }
      if (touched) writes.push(writeCache("kpi_daily", next))
    }

    if (summaries) {
      const next: Record<string, unknown> = {}
      let touched = false
      for (const [k, v] of Object.entries(summaries)) {
        if (ids.has(k)) {
          touched = true
          continue
        }
        next[k] = v
      }
      if (touched) writes.push(writeCache("kpi_summaries", next))
    }

    if (writes.length > 0) await Promise.all(writes)
  } catch (e) {
    console.error(
      "[matcher] kpi cache invalidate failed:",
      e instanceof Error ? e.message : e,
    )
  }
}
