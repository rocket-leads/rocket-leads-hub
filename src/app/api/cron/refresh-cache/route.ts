import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { fetchBillingSummary } from "@/lib/integrations/stripe"
import { writeCache } from "@/lib/cache"
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

function getLast7DaysRange() {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startDate: fmt(start), endDate: fmt(end) }
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

          const [insights, items] = await Promise.all([
            shouldFetchMeta
              ? fetchMetaInsights(client.metaAdAccountId, startDate, endDate).catch(() => [])
              : Promise.resolve([]),
            client.clientBoardId
              ? fetchClientBoardItems(client.clientBoardId).catch(() => [])
              : Promise.resolve([]),
          ])

          const filtered = selectedCampaignIds.size > 0
            ? insights.filter((i) => selectedCampaignIds.has(i.campaignId))
            : insights

          const adSpend = filtered.reduce((sum, i) => sum + i.spend, 0)

          // Fall back to Meta-reported leads when no Monday board is linked.
          // Appointments aren't trackable without Monday CRM, so they stay 0.
          const metaFallback = !client.clientBoardId && shouldFetchMeta && filtered.length > 0
          const leads = metaFallback
            ? filtered.reduce((sum, i) => sum + i.leads, 0)
            : items.filter((i) => i.dateCreated >= startDate && i.dateCreated <= endDate).length
          const appointments = metaFallback
            ? 0
            : items.filter((i) => i.dateAppointment >= startDate && i.dateAppointment <= endDate).length
          const cpl = leads > 0 ? adSpend / leads : 0

          return {
            mondayItemId: client.mondayItemId,
            summary: {
              adSpend,
              leads,
              cpl,
              appointments,
              costPerAppointment: appointments > 0 ? adSpend / appointments : 0,
              ...(isRlNoCampaign ? { rlAccountNoCampaign: true } : {}),
              ...(metaFallback ? { metaFallback: true } : {}),
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

CRITICAL: Rocket Leads clients have FIXED, LIMITED budgets (typically €1,000–€3,000/month total). Clients almost NEVER scale budget. NEVER recommend "scale budget", "increase spend", or any budget increase. The lever is always: better creatives, new angles, refined targeting, better landing pages — NOT more spend.

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
