import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { NextRequest, NextResponse } from "next/server"

export type KpiSummary = {
  adSpend: number
  leads: number
  cpl: number
  appointments: number
  costPerAppointment: number
}

type ClientInput = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
}

function getLast7DaysRange() {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const end = new Date()
  end.setDate(end.getDate() - 1) // yesterday
  const start = new Date(end)
  start.setDate(start.getDate() - 6) // 7 days total
  return { startDate: fmt(start), endDate: fmt(end) }
}

async function fetchSummary(
  client: ClientInput,
  startDate: string,
  endDate: string,
  selectedCampaignIds: Set<string>
): Promise<KpiSummary> {
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
    adSpend,
    leads,
    cpl,
    appointments,
    costPerAppointment: appointments > 0 ? adSpend / appointments : 0,
  }
}

async function batchProcess(
  clients: ClientInput[],
  startDate: string,
  endDate: string,
  batchSize: number,
  selectedByMondayItemId: Record<string, Set<string>>
): Promise<Record<string, KpiSummary>> {
  const results: Record<string, KpiSummary> = {}

  for (let i = 0; i < clients.length; i += batchSize) {
    const batch = clients.slice(i, i + batchSize)
    const settled = await Promise.allSettled(
      batch.map((c) =>
        fetchSummary(c, startDate, endDate, selectedByMondayItemId[c.mondayItemId] ?? new Set())
      )
    )
    settled.forEach((result, j) => {
      if (result.status === "fulfilled") {
        results[batch[j].mondayItemId] = result.value
      }
    })
  }

  return results
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as { clients: ClientInput[] }
  if (!body.clients?.length) return NextResponse.json({})

  // Try cache first — return cached data if fresh
  const cached = await readCache<Record<string, KpiSummary>>("kpi_summaries")
  if (cached) {
    const requested = body.clients.map((c) => c.mondayItemId)
    const result: Record<string, KpiSummary> = {}
    let allHit = true
    for (const id of requested) {
      if (cached[id]) {
        result[id] = cached[id]
      } else {
        allHit = false
        break
      }
    }
    if (allHit) {
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  const { startDate, endDate } = getLast7DaysRange()

  // Load selected campaigns for all clients in two queries (no N+1)
  const supabase = await createAdminClient()
  const mondayItemIds = body.clients.map((c) => c.mondayItemId)

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

  const summaries = await batchProcess(
    body.clients, startDate, endDate, 5, selectedByMondayItemId
  )

  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
