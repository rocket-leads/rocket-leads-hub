import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards, fetchClientBoardItems } from "@/lib/integrations/monday"
import { fetchMetaInsightsDaily } from "@/lib/integrations/meta"
import { writeCache } from "@/lib/cache"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
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

function getLast7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function getPrevious7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 8)
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
  mondayItems: Array<{ dateCreated: string; dateAppointment: string }>,
  rangeStart: string,
): DailyRollup[] {
  const byDate = new Map<string, DailyRollup>()
  const cursor = new Date(rangeStart + "T00:00:00Z")
  for (let i = 0; i < DAILY_HISTORY_DAYS; i++) {
    const d = fmtDate(cursor)
    byDate.set(d, { date: d, spend: 0, metaLeads: 0, mondayLeads: 0, mondayAppts: 0 })
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
    const lead = byDate.get(it.dateCreated)
    if (lead) lead.mondayLeads += 1
    const appt = byDate.get(it.dateAppointment)
    if (appt) appt.mondayAppts += 1
  }
  return Array.from(byDate.values())
}

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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

          const appointments = monday.ok ? window7d.reduce((s, d) => s + d.mondayAppts, 0) : 0
          const prevAppointments = monday.ok ? windowPrev.reduce((s, d) => s + d.mondayAppts, 0) : 0

          const cpl = leads > 0 ? adSpend / leads : 0
          const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0
          const costPerAppointment = appointments > 0 ? adSpend / appointments : 0
          const prevCostPerAppointment = prevAppointments > 0 ? prevAdSpend / prevAppointments : 0

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
              appointments,
              costPerAppointment,
              prevCpl,
              prevCostPerAppointment,
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

    // 4. Write all three caches. allSettled so a single failure doesn't drop the others.
    const writeJobs = [
      { key: "monday_boards", bytes: JSON.stringify({ onboarding, current }).length, run: () => writeCache("monday_boards", { onboarding, current }) },
      { key: "kpi_summaries", bytes: JSON.stringify(kpiSummaries).length, run: () => writeCache("kpi_summaries", kpiSummaries) },
      { key: "kpi_daily", bytes: JSON.stringify(kpiDaily).length, run: () => writeCache("kpi_daily", kpiDaily) },
    ]
    for (const j of writeJobs) console.log(`[refresh-kpi] writing ${j.key} — ${(j.bytes / 1024).toFixed(0)}KB`)
    const writeResults = await Promise.allSettled(writeJobs.map((j) => j.run()))
    writeResults.forEach((r, idx) => {
      if (r.status === "rejected") {
        console.error(`[refresh-kpi] ${writeJobs[idx].key} write failed:`, r.reason instanceof Error ? r.reason.message : r.reason)
      }
    })

    const totalSec = ((Date.now() - startTime) / 1000).toFixed(0)
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
    return NextResponse.json({ error: err instanceof Error ? err.message : "unknown" }, { status: 500 })
  }
}
