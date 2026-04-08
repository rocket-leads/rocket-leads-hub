import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { fetchBillingSummary } from "@/lib/integrations/stripe"
import { writeCache } from "@/lib/cache"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { BillingSummary } from "@/lib/integrations/stripe"

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

          const [insights, items] = await Promise.all([
            client.metaAdAccountId
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
          const leads = items.filter((i) => i.dateCreated >= startDate && i.dateCreated <= endDate).length
          const appointments = items.filter((i) => i.dateAppointment >= startDate && i.dateAppointment <= endDate).length
          const cpl = leads > 0 ? adSpend / leads : 0

          return {
            mondayItemId: client.mondayItemId,
            summary: {
              adSpend,
              leads,
              cpl,
              appointments,
              costPerAppointment: appointments > 0 ? adSpend / appointments : 0,
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

    // 5. Write all caches
    await Promise.all([
      writeCache("kpi_summaries", kpiSummaries),
      writeCache("billing_summaries", billingSummaries),
    ])

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    return NextResponse.json({
      ok: true,
      duration: `${duration}s`,
      kpiClients: Object.keys(kpiSummaries).length,
      billingClients: Object.keys(billingSummaries).length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
