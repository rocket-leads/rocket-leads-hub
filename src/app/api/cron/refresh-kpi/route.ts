import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards, fetchClientBoardItems } from "@/lib/integrations/monday"
import { fetchMetaInsightsDaily } from "@/lib/integrations/meta"
import { writeCache } from "@/lib/cache"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { isPrevPeriodReliable } from "@/app/api/kpi-summaries/route"
import type { KpiSummary, KpiDailyCache, KpiDailyClientData, DailyRollup } from "@/app/api/kpi-summaries/route"

/**
 * Dedicated KPI cache cron — split off from /api/cron/refresh-cache because
 * the combined cron was reliably hitting Vercel's 300s maxDuration on the KPI
 * loop, which left kpi_daily un-written and forced /clients into the slow
 * live-fetch fallback. With its own 5-minute budget the KPI work has plenty
 * of room; everything else (billing, AI proposals, targets dashboards) stays
 * in /api/cron/refresh-cache.
 *
 * Schedule: 5am UTC. /api/cron/refresh-cache shifts to 5:30am so it can read
 * fresh KPI data from cache.
 */

export const maxDuration = 300

const SPARKLINE_DAYS = 14
const DAILY_HISTORY_DAYS = 120
const KPI_BATCH = 10

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Last 7 days INCLUDING today. Roy 2026-05-22: shifted from
// "yesterday + 6 days back" to "today + 6 days back" so leads that
// land during the day are visible immediately in the Watch List.
// Trade-off: today's spend/CPL is partial until Meta closes the day
// (~24h settling), so CPL on the 7d window may dip mid-day then
// recover by tomorrow morning. Acceptable because freshness > stability.
function getLast7DaysRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

// Previous 7 days = the week immediately BEFORE the current window.
// With end = today (inclusive), prev end is today - 7.
function getPrevious7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 7)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function getDailyHistoryRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (DAILY_HISTORY_DAYS - 1))
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function buildDailyRollups(
  metaDaily: Array<{ date: string; spend: number; leads: number; campaignId: string }>,
  mondayItems: Array<{ dateCreated: string }>,
  rangeStart: string,
): DailyRollup[] {
  const byDate = new Map<string, DailyRollup>()
  const cursor = new Date(rangeStart + "T00:00:00Z")
  for (let i = 0; i < DAILY_HISTORY_DAYS; i++) {
    const d = fmtDate(cursor)
    byDate.set(d, { date: d, spend: 0, metaLeads: 0, mondayLeads: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  for (const m of metaDaily) {
    const entry = byDate.get(m.date)
    if (entry) {
      entry.spend += m.spend
      entry.metaLeads += m.leads
    }
  }
  for (const it of mondayItems) {
    // Monday `dateCreated` text often carries a time component
    // ("2026-05-17 06:50:00"); the byDate map is keyed on YYYY-MM-DD, so a
    // raw lookup misses for every item that has a time and the day's lead
    // count silently reads 0. Strip to YYYY-MM-DD before lookup.
    const day = it.dateCreated.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
    if (!day) continue
    const lead = byDate.get(day)
    if (lead) lead.mondayLeads += 1
  }
  return Array.from(byDate.values())
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("refresh-kpi")
  const startTime = Date.now()
  const supabase = await createAdminClient()

  try {
    // 1. Fetch both Monday boards (top-level client list).
    const { onboarding, current } = await fetchBothBoards()
    const allClients = [...onboarding, ...current]
    console.log(`[refresh-kpi] loaded ${allClients.length} clients (${onboarding.length} onboarding + ${current.length} current)`)

    // 1b. Run the Rocket Leads campaign matcher across the full RL ad account
    // BEFORE we read selected campaigns below, so brand-new clients added since
    // the last cron tick — and any newly-launched ACTIVE campaigns whose name
    // matches a known client at ≥0.95 confidence — get their `client_campaigns`
    // rows in place. Without this, the morning's KPI compute would still treat
    // those clients as "no selection" and leave their numbers at zero.
    try {
      const { runRocketLeadsCampaignMatcher } = await import("@/lib/clients/run-campaign-matcher")
      const matched = await runRocketLeadsCampaignMatcher(supabase)
      if (matched.assignedCount > 0) {
        console.log(
          `[refresh-kpi] matcher assigned ${matched.assignedCount} new RL campaigns to ${matched.affectedMondayItemIds.length} clients`,
        )
      }
    } catch (e) {
      console.error("[refresh-kpi] matcher failed:", e instanceof Error ? e.message : e)
    }

    // 1c. Mirror what `/api/clients/[id]/campaigns` GET does for non-RL accounts:
    // any ACTIVE Meta campaign that has no row in `client_campaigns` for the
    // owning client gets auto-upserted as is_selected=true. Without this step the
    // KPI filter below ignores newly-launched campaigns and the watchlist shows
    // "No spend or leads (7d)" for clients whose only selected rows are stale
    // paused campaigns. RL accounts are skipped — handled by the matcher above.
    try {
      const { autoSelectActiveCampaignsForNonRlClients } = await import("@/lib/clients/auto-select-non-rl-campaigns")
      const { data: nonRlRows } = await supabase
        .from("clients")
        .select("id, monday_item_id, meta_ad_account_id")
        .not("meta_ad_account_id", "is", null)
      const candidates = (nonRlRows ?? [])
        .filter((r): r is { id: string; monday_item_id: string; meta_ad_account_id: string } =>
          Boolean(r.id && r.monday_item_id && r.meta_ad_account_id),
        )
        .map((r) => ({ clientId: r.id, mondayItemId: r.monday_item_id, metaAdAccountId: r.meta_ad_account_id }))
      const autoMatched = await autoSelectActiveCampaignsForNonRlClients(supabase, candidates)
      if (autoMatched.assignedCount > 0) {
        console.log(
          `[refresh-kpi] auto-selected ${autoMatched.assignedCount} new ACTIVE non-RL campaigns across ${autoMatched.affectedMondayItemIds.length} clients`,
        )
      }
    } catch (e) {
      console.error("[refresh-kpi] non-RL auto-select failed:", e instanceof Error ? e.message : e)
    }

    // 2. Load each client's selected Meta campaigns from supabase. Used to filter
    // dailyInsights down to campaigns the user actually wants tracked.
    const mondayItemIds = allClients.map((c) => c.mondayItemId)
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, monday_item_id")
      .in("monday_item_id", mondayItemIds)

    const itemToClientId: Record<string, string> = {}
    for (const row of clientRows ?? []) itemToClientId[row.monday_item_id] = row.id

    const clientIds = Object.values(itemToClientId)
    const selectedByMondayItemId: Record<string, Set<string>> = {}
    if (clientIds.length > 0) {
      const { data: campaignRows } = await supabase
        .from("client_campaigns")
        .select("client_id, meta_campaign_id")
        .in("client_id", clientIds)
        .eq("is_selected", true)
      for (const row of campaignRows ?? []) {
        const mondayItemId = Object.keys(itemToClientId).find((k) => itemToClientId[k] === row.client_id)
        if (mondayItemId) {
          if (!selectedByMondayItemId[mondayItemId]) selectedByMondayItemId[mondayItemId] = new Set()
          selectedByMondayItemId[mondayItemId].add(row.meta_campaign_id)
        }
      }
    }

    // 3. KPI batch loop. One Meta + one Monday fetch per client. Batched at 10
    // for parallelism without hitting per-account rate limits.
    const { startDate, endDate } = getLast7DaysRange()
    const { startDate: prevStartDate, endDate: prevEndDate } = getPrevious7DaysRange()
    const dailyHistoryRange = getDailyHistoryRange()
    const kpiClients = allClients.filter((c) => c.metaAdAccountId || c.clientBoardId)
    const kpiSummaries: Record<string, KpiSummary> = {}
    const kpiDaily: KpiDailyCache = {}
    // Per-client cache pre-warm. The slide-over's /api/clients/[id]/kpis
    // route reads from these exact keys; without this every first-open in a
    // 10-minute window had to live-fetch Monday (1-3s) + Meta (500-1500ms).
    // Now the cron has the data anyway, so we mirror it into the keys that
    // endpoint reads from — opens go from ~2-3s cold to ~200ms warm.
    const perClientCacheJobs: Array<{ key: string; data: unknown }> = []

    const kpiStartedAt = Date.now()
    for (let i = 0; i < kpiClients.length; i += KPI_BATCH) {
      const batch = kpiClients.slice(i, i + KPI_BATCH)
      const elapsedSec = ((Date.now() - kpiStartedAt) / 1000).toFixed(0)
      console.log(`[refresh-kpi] batch ${i / KPI_BATCH + 1}/${Math.ceil(kpiClients.length / KPI_BATCH)} — ${i}/${kpiClients.length} done — ${elapsedSec}s elapsed`)
      const results = await Promise.allSettled(
        batch.map(async (client) => {
          const selectedCampaignIds = selectedByMondayItemId[client.mondayItemId] ?? new Set<string>()
          const isRlNoCampaign = isRocketLeadsAdAccount(client.metaAdAccountId) && selectedCampaignIds.size === 0
          const shouldFetchMeta = client.metaAdAccountId && !isRlNoCampaign

          type MondayItems = Awaited<ReturnType<typeof fetchClientBoardItems>>
          type MondayResult = { ok: boolean; items: MondayItems }

          const [dailyInsights, monday] = await Promise.all([
            shouldFetchMeta
              ? fetchMetaInsightsDaily(client.metaAdAccountId, dailyHistoryRange.startDate, dailyHistoryRange.endDate).catch(() => [])
              : Promise.resolve([]),
            client.clientBoardId
              ? fetchClientBoardItems(client.clientBoardId)
                  .then((items): MondayResult => ({ ok: true, items }))
                  .catch((e): MondayResult => {
                    // Include the client name so the log points at WHICH client to fix
                    // (board IDs alone require a Monday lookup to identify).
                    console.error(
                      `[refresh-kpi] Monday board fetch failed: client="${client.name}" (mondayItemId=${client.mondayItemId}) board=${client.clientBoardId} — ${e instanceof Error ? e.message : e}`,
                    )
                    return { ok: false, items: [] }
                  })
              : Promise.resolve<MondayResult>({ ok: false, items: [] }),
          ])

          // Mirror the freshly-fetched data into the per-client cache keys
          // that /api/clients/[id]/kpis reads from. Without this, every
          // first-open of a client in a 10-minute window had to live-fetch
          // these all over again. Push happens inside the concurrent map —
          // JS arrays are safe under single-threaded async push.
          if (monday.ok) {
            perClientCacheJobs.push({
              key: `monday_board_items:${client.clientBoardId}`,
              data: monday.items,
            })
          }
          if (shouldFetchMeta && client.metaAdAccountId) {
            const last7d = dailyInsights.filter(
              (d) => d.date >= startDate && d.date <= endDate,
            )
            const byCampaign = new Map<
              string,
              { campaignId: string; campaignName: string; spend: number; leads: number }
            >()
            for (const d of last7d) {
              const entry = byCampaign.get(d.campaignId) ?? {
                campaignId: d.campaignId,
                campaignName: d.campaignName,
                spend: 0,
                leads: 0,
              }
              entry.spend += d.spend
              entry.leads += d.leads
              byCampaign.set(d.campaignId, entry)
            }
            perClientCacheJobs.push({
              key: `meta_insights:${client.metaAdAccountId}:${startDate}:${endDate}`,
              data: Array.from(byCampaign.values()),
            })
          }

          const dailyFiltered = selectedCampaignIds.size > 0
            ? dailyInsights.filter((d) => selectedCampaignIds.has(d.campaignId))
            : dailyInsights

          const days = buildDailyRollups(dailyFiltered, monday.items, dailyHistoryRange.startDate)
          const window7d = days.filter((d) => d.date >= startDate && d.date <= endDate)
          const windowPrev = days.filter((d) => d.date >= prevStartDate && d.date <= prevEndDate)

          const adSpend = window7d.reduce((s, d) => s + d.spend, 0)
          const prevAdSpend = windowPrev.reduce((s, d) => s + d.spend, 0)

          const mondayLeadsTotal = monday.ok ? window7d.reduce((s, d) => s + d.mondayLeads, 0) : 0
          const mondayPrevLeadsTotal = monday.ok ? windowPrev.reduce((s, d) => s + d.mondayLeads, 0) : 0
          const metaLeadsTotal = window7d.reduce((s, d) => s + d.metaLeads, 0)
          const metaPrevLeadsTotal = windowPrev.reduce((s, d) => s + d.metaLeads, 0)

          const metaFallback = mondayLeadsTotal === 0 && metaLeadsTotal > 0
          const leads = metaFallback ? metaLeadsTotal : mondayLeadsTotal
          const prevLeads = mondayPrevLeadsTotal === 0 && metaPrevLeadsTotal > 0 ? metaPrevLeadsTotal : mondayPrevLeadsTotal

          const cpl = leads > 0 ? adSpend / leads : 0
          const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0

          const prevDaysWithActivity = windowPrev.filter(
            (d) => d.spend > 0 || (monday.ok && d.mondayLeads > 0),
          ).length
          const prevPeriodReliable = isPrevPeriodReliable(prevStartDate, prevEndDate, prevDaysWithActivity, prevAdSpend)

          const sparkSlice = days.slice(-SPARKLINE_DAYS)
          const dailyTrend = shouldFetchMeta
            ? sparkSlice.map((d) => ({
                date: d.date,
                spend: d.spend,
                leads: monday.ok && d.mondayLeads > 0 ? d.mondayLeads : d.metaLeads,
              }))
            : undefined

          const dailyEntry: KpiDailyClientData = {
            mondayItemId: client.mondayItemId,
            days,
            mondayCrmConnected: monday.ok,
            ...(isRlNoCampaign ? { rlAccountNoCampaign: true } : {}),
          }

          return {
            mondayItemId: client.mondayItemId,
            summary: {
              adSpend,
              leads,
              cpl,
              prevCpl,
              prevPeriodReliable,
              ...(isRlNoCampaign ? { rlAccountNoCampaign: true } : {}),
              ...(metaFallback ? { metaFallback: true } : {}),
              mondayCrmConnected: monday.ok,
              ...(dailyTrend ? { dailyTrend } : {}),
            } as KpiSummary,
            daily: dailyEntry,
          }
        })
      )

      for (const result of results) {
        if (result.status === "fulfilled") {
          kpiSummaries[result.value.mondayItemId] = result.value.summary
          kpiDaily[result.value.mondayItemId] = result.value.daily
        }
      }
    }

    // 4. Write all caches. allSettled so a single failure doesn't drop the others.
    const writeJobs = [
      { key: "monday_boards", bytes: JSON.stringify({ onboarding, current }).length, run: () => writeCache("monday_boards", { onboarding, current }) },
      { key: "kpi_summaries", bytes: JSON.stringify(kpiSummaries).length, run: () => writeCache("kpi_summaries", kpiSummaries) },
      { key: "kpi_daily", bytes: JSON.stringify(kpiDaily).length, run: () => writeCache("kpi_daily", kpiDaily) },
      // Per-client pre-warm writes — typically 100+ keys, one per client board
      // and one per ad account. Logged in aggregate to avoid spamming.
      ...perClientCacheJobs.map((j) => ({
        key: j.key,
        bytes: JSON.stringify(j.data).length,
        run: () => writeCache(j.key, j.data),
      })),
    ]
    console.log(
      `[refresh-kpi] pre-warming ${perClientCacheJobs.length} per-client cache entries (monday_board_items + meta_insights)`,
    )
    // Only log the three big aggregate writes individually; per-client entries
    // would bury everything else in noise.
    for (const j of writeJobs.slice(0, 3)) console.log(`[refresh-kpi] writing ${j.key} — ${(j.bytes / 1024).toFixed(0)}KB`)
    const writeResults = await Promise.allSettled(writeJobs.map((j) => j.run()))
    writeResults.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(`[refresh-kpi] ${writeJobs[idx].key} write failed:`, r.reason instanceof Error ? r.reason.message : r.reason)
      }
    })

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(0)
    const writeFailures = writeResults.filter((r) => r.status === "rejected").length
    const metrics = {
      elapsedSec: Number(totalSec),
      clients: kpiClients.length,
      kpiSummaries: Object.keys(kpiSummaries).length,
      kpiDaily: Object.keys(kpiDaily).length,
      writeFailures,
    }
    if (writeFailures > 0) {
      await tracker.partial(`${writeFailures}/${writeResults.length} cache writes failed`, metrics)
    } else {
      await tracker.ok(metrics)
    }
    return NextResponse.json({
      ok: true,
      elapsedSec: Number(totalSec),
      clients: kpiClients.length,
      kpiSummaries: Object.keys(kpiSummaries).length,
      kpiDaily: Object.keys(kpiDaily).length,
      writes: writeResults.map((r, i) => ({ key: writeJobs[i].key, ok: r.status === "fulfilled" })),
    })
  } catch (err) {
    console.error("[refresh-kpi] crashed:", err instanceof Error ? err.message : err)
    await tracker.fail(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 })
  }
}
