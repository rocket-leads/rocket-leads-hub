import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { fetchMetaInsightsDaily, aggregateMetaDailyToTotals, aggregateMetaDailyByDate } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { categorize, updateWatchlistClientState } from "@/lib/watchlist/categorize"
import { fetchBillingSummary } from "@/lib/integrations/stripe"
import { readCache, writeCache } from "@/lib/cache"
import { computeActionCategory } from "@/lib/clients/action-category"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import {
  fetchMondayTargets,
  fetchMetaTargets,
  fetchFinance,
  fetchCosts,
  fetchDelivery,
  getMtdRange,
} from "@/lib/targets/fetchers"
import Anthropic from "@anthropic-ai/sdk"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { BillingSummary } from "@/lib/integrations/stripe"

const anthropic = new Anthropic()

const SPARKLINE_DAYS = 14

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

function getTrendRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (SPARKLINE_DAYS - 1))
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function fillTrend(
  byDate: Array<{ date: string; spend: number; leads: number }>,
  startDate: string,
): Array<{ date: string; spend: number; leads: number }> {
  const map = new Map(byDate.map((d) => [d.date, d]))
  const out: Array<{ date: string; spend: number; leads: number }> = []
  const cursor = new Date(startDate + "T00:00:00Z")
  for (let i = 0; i < SPARKLINE_DAYS; i++) {
    const d = fmtDate(cursor)
    out.push(map.get(d) ?? { date: d, spend: 0, leads: 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export const maxDuration = 300 // 5 minutes max for Vercel Pro

export async function GET(req: NextRequest) {
  // Verify cron secret — Vercel sends this header for cron jobs
  const authHeader = req.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startTime = Date.now()
  const supabase = await createAdminClient()

  try {
    // 1. Fetch all clients from Monday
    const { onboarding, current } = await fetchBothBoards()
    const allClients = [...onboarding, ...current]

    // 2. Load selected campaigns for all clients
    const mondayItemIds = allClients.map((c) => c.mondayItemId)
    const { data: clientRows } = await supabase
      .from("clients")
      .select("id, monday_item_id")
      .in("monday_item_id", mondayItemIds)

    const itemToClientId: Record<string, string> = {}
    for (const row of clientRows ?? []) {
      itemToClientId[row.monday_item_id] = row.id
    }

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

    const { startDate, endDate } = getLast7DaysRange()
    const { startDate: prevStartDate, endDate: prevEndDate } = getPrevious7DaysRange()
    const trendRange = getTrendRange()

    // 3. Compute KPI summaries in batches of 5
    const kpiClients = allClients.filter((c) => c.metaAdAccountId || c.clientBoardId)
    const kpiSummaries: Record<string, KpiSummary> = {}

    for (let i = 0; i < kpiClients.length; i += 5) {
      const batch = kpiClients.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async (client) => {
          const selectedCampaignIds = selectedByMondayItemId[client.mondayItemId] ?? new Set<string>()
          const isRlNoCampaign = isRocketLeadsAdAccount(client.metaAdAccountId) && selectedCampaignIds.size === 0
          const shouldFetchMeta = client.metaAdAccountId && !isRlNoCampaign

          type MondayItems = Awaited<ReturnType<typeof fetchClientBoardItems>>
          type MondayResult = { ok: boolean; items: MondayItems }

          // One 14d daily Meta fetch covers the 7d total, prev-7d total, and sparkline trend.
          const [dailyInsights, monday] = await Promise.all([
            shouldFetchMeta
              ? fetchMetaInsightsDaily(client.metaAdAccountId, trendRange.startDate, trendRange.endDate).catch(() => [])
              : Promise.resolve([]),
            client.clientBoardId
              ? fetchClientBoardItems(client.clientBoardId)
                  .then((items): MondayResult => ({ ok: true, items }))
                  .catch((e): MondayResult => {
                    console.error("Monday fetch failed for board", client.clientBoardId, e instanceof Error ? e.message : e)
                    return { ok: false, items: [] }
                  })
              : Promise.resolve<MondayResult>({ ok: false, items: [] }),
          ])
          const items = monday.items

          const dailyFiltered = selectedCampaignIds.size > 0
            ? dailyInsights.filter((d) => selectedCampaignIds.has(d.campaignId))
            : dailyInsights

          const inWindow = (date: string, s: string, e: string) => date >= s && date <= e
          const filtered = aggregateMetaDailyToTotals(
            dailyFiltered.filter((d) => inWindow(d.date, startDate, endDate))
          )
          const prevFiltered = aggregateMetaDailyToTotals(
            dailyFiltered.filter((d) => inWindow(d.date, prevStartDate, prevEndDate))
          )

          const adSpend = filtered.reduce((sum, x) => sum + x.spend, 0)
          const prevAdSpend = prevFiltered.reduce((sum, x) => sum + x.spend, 0)

          // Use Monday lead counts when available, otherwise fall back to Meta. "Monday
          // returned 0 leads while Meta reports leads" is treated like a fetch failure — it
          // covers access issues, broken Zapier sync, wrong column mapping, etc.
          const mondayLeads = monday.ok
            ? items.filter((it) => it.dateCreated >= startDate && it.dateCreated <= endDate).length
            : 0
          const mondayPrevLeads = monday.ok
            ? items.filter((it) => it.dateCreated >= prevStartDate && it.dateCreated <= prevEndDate).length
            : 0
          const metaLeadsReported = filtered.reduce((sum, x) => sum + x.leads, 0)
          const metaPrevLeadsReported = prevFiltered.reduce((sum, x) => sum + x.leads, 0)

          const metaFallback = mondayLeads === 0 && metaLeadsReported > 0
          const leads = metaFallback ? metaLeadsReported : mondayLeads
          const prevLeads = mondayPrevLeads === 0 && metaPrevLeadsReported > 0 ? metaPrevLeadsReported : mondayPrevLeads

          const appointments = monday.ok
            ? items.filter((it) => it.dateAppointment >= startDate && it.dateAppointment <= endDate).length
            : 0
          const prevAppointments = monday.ok
            ? items.filter((it) => it.dateAppointment >= prevStartDate && it.dateAppointment <= prevEndDate).length
            : 0

          const cpl = leads > 0 ? adSpend / leads : 0
          const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0
          const costPerAppointment = appointments > 0 ? adSpend / appointments : 0
          const prevCostPerAppointment = prevAppointments > 0 ? prevAdSpend / prevAppointments : 0

          // 14d daily trend: spend always from Meta; leads from Monday-per-day if CRM connected,
          // else fall back to Meta's per-day count (mirrors metaFallback rule for the 7d total).
          const metaByDate = aggregateMetaDailyByDate(dailyFiltered)
          const dailyTrend = shouldFetchMeta
            ? fillTrend(
                metaByDate.map((d) => {
                  if (monday.ok) {
                    const mondayLeadsForDay = items.filter((it) => it.dateCreated === d.date).length
                    return { date: d.date, spend: d.spend, leads: mondayLeadsForDay > 0 ? mondayLeadsForDay : d.leads }
                  }
                  return d
                }),
                trendRange.startDate,
              )
            : undefined

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
              ...(isRlNoCampaign ? { rlAccountNoCampaign: true } : {}),
              ...(metaFallback ? { metaFallback: true } : {}),
              mondayCrmConnected: monday.ok,
              ...(dailyTrend ? { dailyTrend } : {}),
            } as KpiSummary,
          }
        })
      )

      for (const result of results) {
        if (result.status === "fulfilled") {
          kpiSummaries[result.value.mondayItemId] = result.value.summary
        }
      }
    }

    // 4. Compute billing summaries in batches of 10
    const customerIds = allClients.map((c) => c.stripeCustomerId).filter(Boolean)
    const billingSummaries: Record<string, BillingSummary> = {}

    for (let i = 0; i < customerIds.length; i += 10) {
      const batch = customerIds.slice(i, i + 10)
      const results = await Promise.allSettled(batch.map((id) => fetchBillingSummary(id)))
      results.forEach((result, j) => {
        if (result.status === "fulfilled") {
          billingSummaries[batch[j]] = result.value
        }
      })
    }

    // 5. Write KPI + billing + boards caches
    await Promise.all([
      writeCache("monday_boards", { onboarding, current }),
      writeCache("kpi_summaries", kpiSummaries),
      writeCache("billing_summaries", billingSummaries),
    ])

    // 5a-pre. Daily score snapshot per CM. Used for the "vs 7d avg" KPI card on the
    // watchlist header — kept in cache_store under a single rolling map so we don't need
    // a dedicated table. Pruned to the trailing 14 days.
    try {
      const today = new Date().toISOString().slice(0, 10)
      type BucketTotals = { action: number; watch: number; good: number }
      type DailySnapshot = Record<string, BucketTotals> // keys: CM name + "_all"
      const snapshot: DailySnapshot = { _all: { action: 0, watch: 0, good: 0 } }

      for (const client of allClients) {
        const kpi = kpiSummaries[client.mondayItemId]
        const { category } = categorize(client, kpi)
        if (category !== "action" && category !== "watch" && category !== "good") continue
        const cmKey = client.campaignManager || "_unassigned"
        if (!snapshot[cmKey]) snapshot[cmKey] = { action: 0, watch: 0, good: 0 }
        snapshot[cmKey][category]++
        snapshot._all[category]++
      }

      const historyKey = "watchlist_score_history"
      const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      const existing = (await readCache<Record<string, DailySnapshot>>(historyKey)) ?? {}
      const merged: Record<string, DailySnapshot> = { ...existing, [today]: snapshot }
      // Prune entries older than 14 days so the map can't grow unbounded.
      for (const date of Object.keys(merged)) {
        if (date < cutoffStr) delete merged[date]
      }
      await writeCache(historyKey, merged)
    } catch (e) {
      console.error("Watchlist score snapshot failed:", e instanceof Error ? e.message : e)
    }

    // 5a. Update Watch List bucket state (`watchlist_client_state`) for ALL clients.
    // Shared helper does the diff-and-upsert so since_date stays anchored at the original
    // transition date — the same helper is used by the kpi-summaries `?force=1` path so
    // a manual refresh from the UI also populates state without waiting for cron.
    try {
      await updateWatchlistClientState(supabase, allClients, kpiSummaries)
    } catch (e) {
      console.error("Watchlist state update failed:", e instanceof Error ? e.message : e)
    }

    // 5b. Refresh Targets dashboard data (MTD + current calendar month)
    const mtd = getMtdRange()
    const monthStart = `${mtd.year}-${String(mtd.month).padStart(2, "0")}-01`
    const lastDay = new Date(mtd.year, mtd.month, 0).getDate()
    const monthEnd = `${mtd.year}-${String(mtd.month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`

    const targetsResults = await Promise.allSettled([
      fetchMondayTargets(mtd.startDate, mtd.endDate),
      fetchMetaTargets(mtd.startDate, mtd.endDate),
      fetchFinance(monthStart, monthEnd),
      fetchCosts(mtd.year, mtd.month),
      fetchDelivery(mtd.startDate, mtd.endDate),
    ])

    const [mondayResult, metaResult, financeResult, costsResult, deliveryResult] = targetsResults
    const targetsWrites: Array<Promise<void>> = []

    if (mondayResult.status === "fulfilled") {
      targetsWrites.push(writeCache("targets_marketing_monday", mondayResult.value))
    } else {
      console.error("[cron] targets monday failed:", mondayResult.reason)
    }
    if (metaResult.status === "fulfilled") {
      targetsWrites.push(writeCache("targets_marketing_meta", metaResult.value))
    } else {
      console.error("[cron] targets meta failed:", metaResult.reason)
    }
    if (financeResult.status === "fulfilled") {
      targetsWrites.push(writeCache("targets_finance", financeResult.value))
    } else {
      console.error("[cron] targets finance failed:", financeResult.reason)
    }
    if (costsResult.status === "fulfilled") {
      targetsWrites.push(writeCache("targets_costs", costsResult.value))
    } else {
      console.error("[cron] targets costs failed:", costsResult.reason)
    }
    if (deliveryResult.status === "fulfilled") {
      targetsWrites.push(writeCache("targets_delivery", deliveryResult.value))
    } else {
      console.error("[cron] targets delivery failed:", deliveryResult.reason)
    }

    await Promise.all(targetsWrites)

    // 6. Generate AI summaries for critical/warning clients
    const actionClients = allClients.filter((c) => {
      const kpi = kpiSummaries[c.mondayItemId]
      const billing = c.stripeCustomerId ? billingSummaries[c.stripeCustomerId] : undefined
      const action = computeActionCategory(c, kpi, billing, undefined)
      return action.priority <= 4 // critical, warning, monitor
    })

    const overviewProposals: Record<string, { type: string; title: string }> = {}

    if (actionClients.length > 0) {
      // Build a batch prompt with all action clients
      const clientLines = actionClients.slice(0, 30).map((c) => {
        const kpi = kpiSummaries[c.mondayItemId]
        const billing = c.stripeCustomerId ? billingSummaries[c.stripeCustomerId] : undefined
        const action = computeActionCategory(c, kpi, billing, undefined)
        return `- ${c.mondayItemId} | ${c.name} | ${action.label}: ${action.reason} | Spend: €${kpi?.adSpend?.toFixed(0) ?? 0} | Leads: ${kpi?.leads ?? 0} | CPL: €${kpi?.cpl?.toFixed(2) ?? 0}`
      }).join("\n")

      try {
        const msg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          system: `You are a performance marketing analyst at Rocket Leads. Generate a 1-line actionable recommendation for each client. Be specific — reference their KPIs.

CRITICAL: Rocket Leads clients have FIXED, LIMITED budgets (typically €1,000–€3,000/month total). Clients almost NEVER scale budget. NEVER recommend "scale budget", "increase spend", or any budget increase. The lever is always: better creatives, iterations on winning ads, new angles, refined targeting, better landing pages — NOT more spend.

NEVER recommend "keep running" for winners — that's passive advice. Winners decay from ad fatigue. Always recommend ITERATING: new variants of the winning creative in the same direction (same hook/angle/format, fresh executions).

Output JSON only: { "monday_item_id": { "type": "critical"|"warning"|"action", "title": "1-line recommendation" } }`,
          messages: [{ role: "user", content: `Generate 1-line recommendations for these clients:\n${clientLines}\n\nReturn ONLY a JSON object.` }],
        })

        const text = msg.content[0].type === "text" ? msg.content[0].text : ""
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          for (const [id, val] of Object.entries(parsed)) {
            if (val && typeof val === "object" && "title" in val) {
              overviewProposals[id] = val as { type: string; title: string }
            }
          }
        }
      } catch (e) {
        console.error("AI overview proposals error:", e instanceof Error ? e.message : String(e))
      }
    }

    await writeCache("overview_proposals", overviewProposals)

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      totalClients: allClients.length,
      kpiClients: Object.keys(kpiSummaries).length,
      billingClients: Object.keys(billingSummaries).length,
      aiProposals: Object.keys(overviewProposals).length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
