import { auth } from "@/lib/auth"
import { fetchMetaInsights } from "@/lib/meta"
import { fetchClientBoardItems } from "@/lib/monday"
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

function getDefaultDateRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = now
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: fmt(start), endDate: fmt(end) }
}

async function fetchSummary(
  client: ClientInput,
  startDate: string,
  endDate: string
): Promise<KpiSummary> {
  const [insights, items] = await Promise.all([
    client.metaAdAccountId
      ? fetchMetaInsights(client.metaAdAccountId, startDate, endDate).catch(() => [])
      : Promise.resolve([]),
    client.clientBoardId
      ? fetchClientBoardItems(client.clientBoardId).catch(() => [])
      : Promise.resolve([]),
  ])

  const adSpend = insights.reduce((sum, i) => sum + i.spend, 0)
  const leads = items.filter(
    (i) => i.dateCreated >= startDate && i.dateCreated <= endDate
  ).length
  const appointments = items.filter(
    (i) => i.dateAppointment >= startDate && i.dateAppointment <= endDate
  ).length

  return {
    adSpend,
    leads,
    cpl: leads > 0 ? adSpend / leads : 0,
    appointments,
    costPerAppointment: appointments > 0 ? adSpend / appointments : 0,
  }
}

// Process in batches to avoid overwhelming external APIs
async function batchProcess(
  clients: ClientInput[],
  startDate: string,
  endDate: string,
  batchSize: number
): Promise<Record<string, KpiSummary>> {
  const results: Record<string, KpiSummary> = {}

  for (let i = 0; i < clients.length; i += batchSize) {
    const batch = clients.slice(i, i + batchSize)
    const settled = await Promise.allSettled(
      batch.map((c) => fetchSummary(c, startDate, endDate))
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

  const body = (await req.json()) as { clients: ClientInput[]; startDate?: string; endDate?: string }
  if (!body.clients?.length) return NextResponse.json({})

  const defaults = getDefaultDateRange()
  const startDate = body.startDate ?? defaults.startDate
  const endDate = body.endDate ?? defaults.endDate
  const summaries = await batchProcess(body.clients, startDate, endDate, 5)

  return NextResponse.json(summaries)
}
