import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchMetaAdDetails, type MetaAdDetail } from "@/lib/integrations/meta"
import {
  NOT_SHIPPED_AFTER_DAYS,
  scoreVariantOutcome,
} from "@/lib/pedro/variants"
import { computeAccountStats } from "@/lib/pedro/performance"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * sync-pedro-variants — closes Pedro's learning loop.
 *
 * For every pedro_variants row that has been around long enough to
 * possibly have been shipped:
 *   1. Find the client's Meta ad account.
 *   2. Pull the last 60d of ad performance.
 *   3. Match `pedro_variants.ad_name` against `MetaAdDetail.adName`
 *      EXACTLY (Roy's design — CM must copy 1:1, no fuzzy match).
 *   4. If matched: stamp spend/leads/CPL + verdict (winner/loser/neutral).
 *   5. If NOT matched after NOT_SHIPPED_AFTER_DAYS days: mark `not_shipped`.
 *
 * The next creative-refresh prompt reads back from this enriched table
 * as a LEARNING block — see `getPastPedroVariantsForClient` in
 * src/lib/pedro/past-variants-context.ts.
 *
 * Scope: one Meta call per Live client that has variants. Batched so
 * we don't hit Meta rate limits on big fleets. Idempotent — re-running
 * the same day just updates the same rows.
 *
 * Roy 2026-06-09.
 */

export const maxDuration = 300 // mirror refresh-cache; Meta calls can be slow

const META_WINDOW_DAYS = 60

function dateRange(days: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days + 1)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("sync-pedro-variants")
  const startedAt = Date.now()

  try {
    const supabase = await createAdminClient()
    const { start, end } = dateRange(META_WINDOW_DAYS)
    const nowIso = new Date().toISOString()

    // 1. Pull the client list + ad account map from the warm Monday cache.
    // Falls back to empty so an early-deploy with no cache doesn't crash;
    // next refresh-cache tick will warm it and the next sync run picks
    // everything up.
    const boards = await readCache<{
      onboarding: MondayClient[]
      current: MondayClient[]
    }>("monday_boards")
    const allClients = boards ? [...boards.onboarding, ...boards.current] : []
    const adAccountByClient = new Map<string, string>()
    for (const c of allClients) {
      if (c.metaAdAccountId) adAccountByClient.set(c.mondayItemId, c.metaAdAccountId)
    }

    // 2. Get every client with at least one pending variant or one variant
    // that hasn't been synced in the last 24h. We don't re-sync winners/
    // losers more often than that — once the verdict's in, it doesn't
    // change materially day-to-day.
    type DueClientRow = { client_id: string }
    const { data: dueClientsData } = await supabase
      .from("pedro_variants")
      .select("client_id")
      .or(
        "last_synced_at.is.null,last_synced_at.lt." +
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .neq("outcome", "not_shipped")

    const dueClientIds = Array.from(
      new Set(((dueClientsData ?? []) as DueClientRow[]).map((r) => r.client_id)),
    )

    let matched = 0
    let updated = 0
    let markedNotShipped = 0
    let skippedNoAccount = 0
    let skippedMetaFail = 0
    const CLIENT_BATCH = 5

    for (let i = 0; i < dueClientIds.length; i += CLIENT_BATCH) {
      const batch = dueClientIds.slice(i, i + CLIENT_BATCH)

      await Promise.all(
        batch.map(async (clientId) => {
          const adAccount = adAccountByClient.get(clientId)
          if (!adAccount) {
            skippedNoAccount++
            return
          }

          // Pull all pending/syncable variants for this client.
          type VariantRow = {
            id: string
            ad_name: string
            generated_at: string
            outcome: string
          }
          const { data: variants } = await supabase
            .from("pedro_variants")
            .select("id, ad_name, generated_at, outcome")
            .eq("client_id", clientId)
            .neq("outcome", "not_shipped")

          if (!variants || variants.length === 0) return
          const variantRows = variants as VariantRow[]

          let ads: MetaAdDetail[] = []
          try {
            ads = await fetchMetaAdDetails(adAccount, start, end)
          } catch (e) {
            console.error(
              `[sync-pedro-variants] Meta fetch failed for ${clientId}:`,
              e instanceof Error ? e.message : e,
            )
            skippedMetaFail++
            return
          }
          const stats = computeAccountStats(ads)
          const byName = new Map<string, MetaAdDetail>()
          for (const ad of ads) {
            if (ad.adName) byName.set(ad.adName, ad)
          }

          const ageDays = (gen: string): number =>
            Math.floor((Date.now() - new Date(gen).getTime()) / 86_400_000)

          for (const v of variantRows) {
            const match = byName.get(v.ad_name)

            if (match) {
              const cpl = match.leads > 0 ? match.spend / match.leads : null
              const outcome = scoreVariantOutcome({
                spend: match.spend,
                leads: match.leads,
                cpl,
                accountAvgCpl: stats.avgCpl,
              })
              await supabase
                .from("pedro_variants")
                .update({
                  last_synced_at: nowIso,
                  meta_ad_id: match.adId,
                  spend: match.spend,
                  leads: match.leads,
                  cpl,
                  ctr: match.ctr,
                  outcome,
                  account_avg_cpl_at_sync: stats.avgCpl,
                })
                .eq("id", v.id)
              matched++
              updated++
              continue
            }

            // No match — if it's been long enough since generation,
            // mark not_shipped so we stop re-checking it (and so the
            // learning prompt can tell Pedro "this proposal was never
            // used").
            if (ageDays(v.generated_at) >= NOT_SHIPPED_AFTER_DAYS) {
              await supabase
                .from("pedro_variants")
                .update({
                  last_synced_at: nowIso,
                  outcome: "not_shipped",
                  account_avg_cpl_at_sync: stats.avgCpl,
                })
                .eq("id", v.id)
              markedNotShipped++
              updated++
            } else {
              // Still in the grace window — just stamp the sync time so
              // we don't pick it up again until tomorrow.
              await supabase
                .from("pedro_variants")
                .update({ last_synced_at: nowIso })
                .eq("id", v.id)
              updated++
            }
          }
        }),
      )
    }

    const metrics = {
      durationMs: Date.now() - startedAt,
      clientsChecked: dueClientIds.length,
      variantsUpdated: updated,
      variantsMatched: matched,
      variantsMarkedNotShipped: markedNotShipped,
      clientsSkippedNoAccount: skippedNoAccount,
      clientsSkippedMetaFail: skippedMetaFail,
    }
    await tracker.ok(metrics)
    return NextResponse.json({ ok: true, ...metrics })
  } catch (e) {
    console.error("[sync-pedro-variants] fatal:", e instanceof Error ? e.message : e)
    await tracker.fail(e)
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
