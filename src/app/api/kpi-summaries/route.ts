import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchMetaInsightsDaily, aggregateMetaDailyToTotals, aggregateMetaDailyByDate } from "@/lib/integrations/meta"
import { fetchClientBoardItems } from "@/lib/integrations/monday"
import { updateWatchlistClientState } from "@/lib/watchlist/categorize"
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
  /**
   * True when the prior comparison window was substantially live (≥80% of its
   * days had ad spend or Monday leads, and total spend > 0). When false, the UI
   * MUST hide CPL / CPA change indicators — a freshly-launched client compared
   * against a window where they weren't live yet would otherwise read as a wild
   * +/-100% swing that's purely an artefact of the launch date. Optional for
   * backwards-compat with older cached entries; missing → treat as reliable so
   * we don't regress until the cron rewrites the cache.
   */
  prevPeriodReliable?: boolean
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

/**
 * Per-day rollup for one client, written by the daily cron and aggregated on-the-fly by
 * `/api/kpi-summaries` for any requested startDate/endDate. Days are sorted oldest → newest
 * and contain dense entries for the entire DAILY_HISTORY_DAYS window — missing days are
 * filled with zeros so range aggregation is just `.filter(d => d.date >= start && d.date <= end)`.
 */
export type DailyRollup = {
  date: string         // YYYY-MM-DD
  spend: number        // Meta ad spend (post campaign filter)
  metaLeads: number    // Meta-reported leads from `actions`
  mondayLeads: number  // Monday lead count (items where dateCreated == this day)
  mondayAppts: number  // Monday appointment count (items where dateAppointment == this day)
}

export type KpiDailyClientData = {
  mondayItemId: string
  days: DailyRollup[]
  mondayCrmConnected: boolean
  rlAccountNoCampaign?: boolean
}

export type KpiDailyCache = Record<string, KpiDailyClientData>

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

/**
 * For a given range, return the same-length range immediately before it.
 * Used to compute period-over-period CPL/CPA deltas for any date filter.
 */
function getPreviousRange(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(startDate + "T00:00:00Z")
  const end = new Date(endDate + "T00:00:00Z")
  const dayMs = 86400000
  const lengthDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1
  const prevEnd = new Date(start.getTime() - dayMs)
  const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * dayMs)
  return { startDate: fmtDate(prevStart), endDate: fmtDate(prevEnd) }
}

/** Threshold for "prev period had substantial activity" — see KpiSummary.prevPeriodReliable. */
export const PREV_PERIOD_COVERAGE_THRESHOLD = 0.8

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate + "T00:00:00Z").getTime()
  const end = new Date(endDate + "T00:00:00Z").getTime()
  return Math.round((end - start) / 86400000) + 1
}

/**
 * Returns true when the prev period was live for ≥80% of its days AND had
 * total spend > 0. Both conditions matter — a single high-spend day in an
 * otherwise-dead window passes "spend > 0" but fails the coverage check.
 *
 * Exported so the cron writes the same flag the live path returns — keeping
 * a single source of truth for the threshold.
 */
export function isPrevPeriodReliable(
  prevStartDate: string,
  prevEndDate: string,
  prevDaysWithActivity: number,
  prevAdSpend: number,
): boolean {
  const totalDays = daysBetween(prevStartDate, prevEndDate)
  if (totalDays <= 0) return false
  if (prevAdSpend <= 0) return false
  return prevDaysWithActivity / totalDays >= PREV_PERIOD_COVERAGE_THRESHOLD
}

/**
 * Aggregate per-day rollups for one client into a KpiSummary for the given window.
 * Mirrors the cron's window-level logic: metaFallback applies when Monday reports zero
 * leads in the window but Meta has them. Returned shape matches the existing 7d-summary
 * contract so consumers don't need to branch on data source.
 */
function aggregateDailyToSummary(
  daily: KpiDailyClientData,
  startDate: string,
  endDate: string,
  prevStartDate: string,
  prevEndDate: string,
): KpiSummary {
  const window = daily.days.filter((d) => d.date >= startDate && d.date <= endDate)
  const prev = daily.days.filter((d) => d.date >= prevStartDate && d.date <= prevEndDate)

  const adSpend = window.reduce((s, d) => s + d.spend, 0)
  const prevAdSpend = prev.reduce((s, d) => s + d.spend, 0)

  const mondayLeadsTotal = daily.mondayCrmConnected ? window.reduce((s, d) => s + d.mondayLeads, 0) : 0
  const mondayPrevLeadsTotal = daily.mondayCrmConnected ? prev.reduce((s, d) => s + d.mondayLeads, 0) : 0
  const metaLeadsTotal = window.reduce((s, d) => s + d.metaLeads, 0)
  const metaPrevLeadsTotal = prev.reduce((s, d) => s + d.metaLeads, 0)

  const metaFallback = mondayLeadsTotal === 0 && metaLeadsTotal > 0
  const leads = metaFallback ? metaLeadsTotal : mondayLeadsTotal
  const prevLeads = mondayPrevLeadsTotal === 0 && metaPrevLeadsTotal > 0 ? metaPrevLeadsTotal : mondayPrevLeadsTotal

  const appointments = daily.mondayCrmConnected ? window.reduce((s, d) => s + d.mondayAppts, 0) : 0
  const prevAppointments = daily.mondayCrmConnected ? prev.reduce((s, d) => s + d.mondayAppts, 0) : 0

  const cpl = leads > 0 ? adSpend / leads : 0
  const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0
  const costPerAppointment = appointments > 0 ? adSpend / appointments : 0
  const prevCostPerAppointment = prevAppointments > 0 ? prevAdSpend / prevAppointments : 0

  // Coverage = days in prev window that had any spend or (when CRM is connected) any
  // Monday lead. dense rollups means `prev.length` is the full window length.
  const prevDaysWithActivity = prev.filter(
    (d) => d.spend > 0 || (daily.mondayCrmConnected && d.mondayLeads > 0),
  ).length
  const prevPeriodReliable = isPrevPeriodReliable(prevStartDate, prevEndDate, prevDaysWithActivity, prevAdSpend)

  return {
    adSpend,
    leads,
    cpl,
    appointments,
    costPerAppointment,
    prevCpl,
    prevCostPerAppointment,
    prevPeriodReliable,
    ...(daily.rlAccountNoCampaign ? { rlAccountNoCampaign: true } : {}),
    ...(metaFallback ? { metaFallback: true } : {}),
    mondayCrmConnected: daily.mondayCrmConnected,
  }
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

  // Meta fetch range = union of (the 14d sparkline window) ∪ (the requested
  // window + its prev range). Without this expansion, picking a custom date
  // range outside the trailing 14 days (e.g. "last month") would return zeros
  // because the Meta call only pulled the recent fortnight. The expansion is
  // cheap — Meta paginates the daily insights and the route already lives
  // behind a per-client rate limit.
  const trendRange = getTrendRange()
  const metaFetchStart = prevStartDate < trendRange.startDate ? prevStartDate : trendRange.startDate
  const metaFetchEnd = endDate > trendRange.endDate ? endDate : trendRange.endDate

  const [dailyInsights, monday] = await Promise.all([
    shouldFetchMeta
      ? fetchMetaInsightsDaily(client.metaAdAccountId!, metaFetchStart, metaFetchEnd).catch(() => [])
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

  // Coverage check on the prev window — Meta data is sparse (no row for zero-spend
  // days), so we collect distinct dates that had spend and union them with Monday
  // lead dates when CRM is connected. Both contribute to "the client was live that
  // day" since either signal proves activity.
  const prevActiveDates = new Set<string>()
  for (const d of dailyFiltered) {
    if (d.spend > 0 && d.date >= prevStartDate && d.date <= prevEndDate) prevActiveDates.add(d.date)
  }
  if (monday.ok) {
    for (const item of items) {
      if (item.dateCreated >= prevStartDate && item.dateCreated <= prevEndDate) prevActiveDates.add(item.dateCreated)
    }
  }
  const prevPeriodReliable = isPrevPeriodReliable(prevStartDate, prevEndDate, prevActiveDates.size, prevAdSpend)

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
      prevPeriodReliable,
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

  const body = (await req.json()) as {
    clients: ClientInput[]
    startDate?: string
    endDate?: string
  }
  if (!body.clients?.length) return NextResponse.json({})

  // Date-range path: when the caller specifies a window, aggregate from the daily
  // rollup cache. Range is exclusive of today (cache only contains up to yesterday).
  // If the daily cache is empty we fall straight through to a LIVE fetch with the
  // REQUESTED dates — never to the 7d cache. The old fall-through quietly served
  // 7d numbers for any custom range, which looked indistinguishable from a working
  // filter and was the source of "data doesn't change when I change the range".
  const hasRequestedRange = !!(body.startDate && body.endDate)
  if (hasRequestedRange) {
    const dailyCache = await readCache<KpiDailyCache>("kpi_daily")
    if (dailyCache && Object.keys(dailyCache).length > 0) {
      const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousRange(body.startDate!, body.endDate!)
      const summaries: Record<string, KpiSummary> = {}
      for (const c of body.clients) {
        const daily = dailyCache[c.mondayItemId]
        if (!daily) continue
        summaries[c.mondayItemId] = aggregateDailyToSummary(daily, body.startDate!, body.endDate!, prevStartDate, prevEndDate)
      }
      return NextResponse.json(summaries, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
    console.log("[kpi-summaries] daily cache empty — live fetch for requested range", body.startDate, body.endDate)
    // fall through to live fetch (uses the requested dates — see below)
  }

  // 7d cache shortcut: only valid when the caller didn't ask for a custom range.
  // Otherwise we'd silently return 7d numbers for, say, March, and Roy can't tell.
  if (!force && !hasRequestedRange) {
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

  // Live fetch — uses the REQUESTED window when provided, otherwise last 7d.
  // Cold-start or `?force=1` for the default view also reaches here.
  const { startDate, endDate } = hasRequestedRange
    ? { startDate: body.startDate!, endDate: body.endDate! }
    : getLast7DaysRange()
  const { startDate: prevStartDate, endDate: prevEndDate } = hasRequestedRange
    ? getPreviousRange(startDate, endDate)
    : getPrevious7DaysRange()

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

  // On force-refresh of the DEFAULT (7d) view, merge fresh results into the
  // shared 7d cache so other consumers see the up-to-date numbers. A custom
  // date range must never write to this cache — it'd serve March numbers as
  // "today's" KPIs to the watchlist and Slack summaries.
  if (force && !hasRequestedRange && Object.keys(summaries).length > 0) {
    const existing = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? {}
    void writeCache("kpi_summaries", { ...existing, ...summaries })

    // Also populate the Watch List bucket state for the visible clients so the days/NEW
    // pills work without waiting for the next 30-min cron tick. Same helper the cron
    // uses, so the diff-and-upsert behaviour (only writes on transitions) is identical.
    try {
      await updateWatchlistClientState(
        supabase,
        body.clients.map((c) => ({ mondayItemId: c.mondayItemId, metaAdAccountId: c.metaAdAccountId })),
        summaries,
      )
    } catch (e) {
      console.error("Watchlist state update from kpi-summaries force-refresh failed:", e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
