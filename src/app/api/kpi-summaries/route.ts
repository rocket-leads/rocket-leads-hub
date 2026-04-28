import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsightsDaily, aggregateMetaDailyToTotals, aggregateMetaDailyByDate } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { detectMondayActivity } from "@/lib/clients/monday-activity"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import { readCache, writeCache } from "@/lib/cache"
import { NextRequest, NextResponse } from "next/server"

export type KpiSummary = {
  adSpend: number
  leads: number
  cpl: number
  appointments: number
  costPerAppointment: number
  prevCpl: number
  prevCostPerAppointment: number
  /** True when client uses RL ad account but has no campaigns selected — data should be ignored */
  rlAccountNoCampaign?: boolean
  /** True when leads come from Meta `actions` because Monday returned no usable data */
  metaFallback?: boolean
  /**
   * True only when we successfully read items from a linked Monday board for this fetch.
   * When false, `appointments` is NOT a real "zero" — the CRM source is missing entirely
   * and the AI/UI should treat appointment-based metrics as UNKNOWN, not as zero.
   */
  mondayCrmConnected?: boolean
  /**
   * Per-day spend & leads for the trailing 14 days, sorted oldest → newest. Used to render
   * inline sparklines in the Watch List. Days with no Meta activity are filled with zeros so
   * the array length is always exactly the rendered window. Optional — older cache entries
   * may not carry it.
   */
  dailyTrend?: Array<{ date: string; spend: number; leads: number }>
}

type ClientInput = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
}

const SPARKLINE_DAYS = 14

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getLast7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1) // yesterday
  const start = new Date(end)
  start.setDate(start.getDate() - 6) // 7 days total
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function getPrevious7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 8) // day before the current 7-day window
  const start = new Date(end)
  start.setDate(start.getDate() - 6) // 7 days total
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

function getTrendRange() {
  const end = new Date()
  end.setDate(end.getDate() - 1)
  const start = new Date(end)
  start.setDate(start.getDate() - (SPARKLINE_DAYS - 1))
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

/**
 * Fill in missing dates with zero so the trend array is always exactly SPARKLINE_DAYS long
 * and can be plotted as a continuous line.
 */
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

type FetchResult = { summary: KpiSummary; mondayActive: boolean; mondayOk: boolean }

async function fetchSummary(
  client: ClientInput,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  selectedCampaignIds: Set<string>
): Promise<FetchResult> {
  // RL ad account with no campaigns selected → return empty data with flag
  const isRlNoCampaign = isRocketLeadsAdAccount(client.metaAdAccountId) && selectedCampaignIds.size === 0
  const shouldFetchMeta = client.metaAdAccountId && !isRlNoCampaign

  type MondayItems = Awaited<ReturnType<typeof fetchClientBoardItems>>
  type MondayResult = { ok: boolean; items: MondayItems }

  // Single 14d daily fetch covers both the 7d / prev-7d totals AND the sparkline trend.
  // Saves one Meta API roundtrip per client compared to fetching each window separately.
  const trendRange = getTrendRange()

  const [dailyInsights, monday] = await Promise.all([
    shouldFetchMeta
      ? fetchMetaInsightsDaily(client.metaAdAccountId!, trendRange.startDate, trendRange.endDate).catch(() => [])
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

  // Slice daily rows into the two 7d windows and aggregate to per-campaign totals.
  const inWindow = (date: string, s: string, e: string) => date >= s && date <= e
  const filtered = aggregateMetaDailyToTotals(
    dailyFiltered.filter((d) => inWindow(d.date, startDate, endDate))
  )
  const prevFiltered = aggregateMetaDailyToTotals(
    dailyFiltered.filter((d) => inWindow(d.date, prevStartDate, prevEndDate))
  )

  const adSpend = filtered.reduce((sum, i) => sum + i.spend, 0)
  const prevAdSpend = prevFiltered.reduce((sum, i) => sum + i.spend, 0)

  // Use Monday lead counts when available, otherwise fall back to Meta. We treat "Monday
  // returned 0 leads in this window while Meta reports leads" the same as a fetch failure —
  // it covers access issues, broken Zapier sync, wrong column mapping, etc. Appointments
  // can only come from Monday CRM, so they always read from `items`.
  const mondayLeads = monday.ok
    ? items.filter((i) => i.dateCreated >= startDate && i.dateCreated <= endDate).length
    : 0
  const mondayPrevLeads = monday.ok
    ? items.filter((i) => i.dateCreated >= prevStartDate && i.dateCreated <= prevEndDate).length
    : 0
  const metaLeadsReported = filtered.reduce((sum, i) => sum + i.leads, 0)
  const metaPrevLeadsReported = prevFiltered.reduce((sum, i) => sum + i.leads, 0)

  const metaFallback = mondayLeads === 0 && metaLeadsReported > 0
  const leads = metaFallback ? metaLeadsReported : mondayLeads
  const prevLeads = mondayPrevLeads === 0 && metaPrevLeadsReported > 0 ? metaPrevLeadsReported : mondayPrevLeads

  const appointments = monday.ok
    ? items.filter((i) => i.dateAppointment >= startDate && i.dateAppointment <= endDate).length
    : 0
  const prevAppointments = monday.ok
    ? items.filter((i) => i.dateAppointment >= prevStartDate && i.dateAppointment <= prevEndDate).length
    : 0

  const cpl = leads > 0 ? adSpend / leads : 0
  const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0
  const prevCostPerAppointment = prevAppointments > 0 ? prevAdSpend / prevAppointments : 0

  // Build the 14d sparkline trend. Spend comes from Meta directly; daily leads come from
  // Monday when the CRM is connected, otherwise we fall back to Meta's per-day lead count
  // (mirrors the metaFallback rule applied to the 7d total).
  const metaByDate = aggregateMetaDailyByDate(dailyFiltered)
  const dailyTrend = shouldFetchMeta
    ? fillTrend(
        metaByDate.map((d) => {
          if (monday.ok) {
            const mondayLeadsForDay = items.filter((i) => i.dateCreated === d.date).length
            // Use Monday count if it has any leads; otherwise fall back to Meta for that day.
            return { date: d.date, spend: d.spend, leads: mondayLeadsForDay > 0 ? mondayLeadsForDay : d.leads }
          }
          return d
        }),
        trendRange.startDate,
      )
    : undefined

  return {
    summary: {
      adSpend,
      leads,
      cpl,
      appointments,
      costPerAppointment: appointments > 0 ? adSpend / appointments : 0,
      prevCpl,
      prevCostPerAppointment,
      ...(isRlNoCampaign ? { rlAccountNoCampaign: true } : {}),
      ...(metaFallback ? { metaFallback: true } : {}),
      mondayCrmConnected: monday.ok,
      ...(dailyTrend ? { dailyTrend } : {}),
    },
    mondayActive: items.length > 0 ? detectMondayActivity(items) : false,
    mondayOk: monday.ok,
  }
}

async function batchProcess(
  clients: ClientInput[],
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
  batchSize: number,
  selectedByMondayItemId: Record<string, Set<string>>,
  supabase: Awaited<ReturnType<typeof createAdminClient>>
): Promise<Record<string, KpiSummary>> {
  const results: Record<string, KpiSummary> = {}
  const activityUpdates: Array<{ mondayItemId: string; active: boolean }> = []

  for (let i = 0; i < clients.length; i += batchSize) {
    const batch = clients.slice(i, i + batchSize)
    const settled = await Promise.allSettled(
      batch.map((c) =>
        fetchSummary(c, startDate, endDate, prevStartDate, prevEndDate, selectedByMondayItemId[c.mondayItemId] ?? new Set())
      )
    )
    settled.forEach((result, j) => {
      if (result.status === "fulfilled") {
        results[batch[j].mondayItemId] = result.value.summary
        // Only persist activity when Monday actually responded — a failed fetch
        // (e.g. access denied) shouldn't flip a client to inactive.
        if (batch[j].clientBoardId && result.value.mondayOk) {
          activityUpdates.push({ mondayItemId: batch[j].mondayItemId, active: result.value.mondayActive })
        }
      }
    })
  }

  // Batch-update monday_active in Supabase (fire-and-forget)
  if (activityUpdates.length > 0) {
    Promise.allSettled(
      activityUpdates.map(({ mondayItemId, active }) =>
        supabase.from("clients").update({ monday_active: active }).eq("monday_item_id", mondayItemId)
      )
    ).catch(() => {})
  }

  return results
}

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const force = req.nextUrl.searchParams.get("force") === "1"

  const body = (await req.json()) as { clients: ClientInput[] }
  if (!body.clients?.length) return NextResponse.json({})

  // Serve from cache — cron keeps it fresh every 30 min. Skipped on `?force=1`
  // so the user can trigger a live re-fetch from the watchlist refresh button.
  if (!force) {
    const cached = await readCache<Record<string, KpiSummary>>("kpi_summaries")
    if (cached) {
      const summaries: Record<string, KpiSummary> = {}
      for (const c of body.clients) {
        if (cached[c.mondayItemId]) summaries[c.mondayItemId] = cached[c.mondayItemId]
      }
      // Return whatever we have from cache — don't block on live fetches
      if (Object.keys(summaries).length > 0) {
        return NextResponse.json(summaries, {
          headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
        })
      }
    }
  }

  // Live fetch — happens on cold-start (no cache) or when `force=1` is passed
  const { startDate, endDate } = getLast7DaysRange()
  const { startDate: prevStartDate, endDate: prevEndDate } = getPrevious7DaysRange()

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
    body.clients, startDate, endDate, prevStartDate, prevEndDate, 5, selectedByMondayItemId, supabase
  )

  // On force-refresh, merge fresh results into the existing cache so other
  // consumers (and subsequent non-force loads) see the up-to-date numbers.
  if (force && Object.keys(summaries).length > 0) {
    const existing = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? {}
    void writeCache("kpi_summaries", { ...existing, ...summaries })
  }

  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
