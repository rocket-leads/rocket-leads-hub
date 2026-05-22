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
  prevCpl: number
  /**
   * True when the prior comparison window was substantially live (≥80% of its
   * days had ad spend or Monday leads, and total spend > 0). When false, the UI
   * MUST hide CPL change indicators — a freshly-launched client compared
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
   * Useful for downstream code that wants to differentiate "Monday CRM not connected"
   * from "Monday CRM connected but empty".
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

// Last 7 days INCLUDING today (Roy 2026-05-22). Was previously
// "yesterday + 6 days back" but leads landing during the day stayed
// invisible until the next morning's cron. Today is included even
// though Meta's intraday spend is partial — freshness > stability.
function getLast7DaysRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6) // 7 days total, today inclusive
  return { startDate: fmtDate(start), endDate: fmtDate(end) }
}

// Previous 7 days = the week immediately BEFORE the current window.
// end = today - 7, start = today - 13.
function getPrevious7DaysRange() {
  const end = new Date()
  end.setDate(end.getDate() - 7)
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

// Pure helpers moved to lib/clients/kpi-window so they can be unit-tested
// without pulling in NextRequest / Supabase. Re-exported here so existing
// import paths (`@/app/api/kpi-summaries/route`) keep working.
export { isPrevPeriodReliable, PREV_PERIOD_COVERAGE_THRESHOLD } from "@/lib/clients/kpi-window"
import { isPrevPeriodReliable } from "@/lib/clients/kpi-window"

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

  const cpl = leads > 0 ? adSpend / leads : 0
  const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0

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
    prevCpl,
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
  // Monday `dateCreated` text often carries a time component
  // ("2026-05-17 06:50:00"); a naive lex-compare against a YYYY-MM-DD end
  // date drops every item on the end-date because " 06:50:00" sorts after
  // the end-date string. Normalize to the YYYY-MM-DD prefix. Same fix as
  // calculateKpis() in lib/clients/kpis.ts — this code path was missed
  // when that one was patched (Roy 2026-05, weekly update showed Mon-Sat
  // instead of Mon-Sun).
  const inMondayDateRange = (rawDate: string, s: string, e: string): boolean => {
    if (!rawDate) return false
    const day = rawDate.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
    if (!day) return false
    return day >= s && day <= e
  }
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
    ? items.filter((i) => inMondayDateRange(i.dateCreated, startDate, endDate)).length
    : 0
  const mondayPrevLeads = monday.ok
    ? items.filter((i) => inMondayDateRange(i.dateCreated, prevStartDate, prevEndDate)).length
    : 0
  const metaLeadsReported = filtered.reduce((sum, i) => sum + i.leads, 0)
  const metaPrevLeadsReported = prevFiltered.reduce((sum, i) => sum + i.leads, 0)

  const metaFallback = mondayLeads === 0 && metaLeadsReported > 0
  const leads = metaFallback ? metaLeadsReported : mondayLeads
  const prevLeads = mondayPrevLeads === 0 && metaPrevLeadsReported > 0 ? metaPrevLeadsReported : mondayPrevLeads

  const cpl = leads > 0 ? adSpend / leads : 0
  const prevCpl = prevLeads > 0 ? prevAdSpend / prevLeads : 0

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
      // Normalize the same way as inMondayDateRange — strip the time off
      // dateCreated before comparing AND before adding to the set, so a set
      // entry is a clean YYYY-MM-DD that lines up with `d.date` rows above.
      const day = item.dateCreated.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
      if (day && day >= prevStartDate && day <= prevEndDate) prevActiveDates.add(day)
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
            // Strict equality on the date portion only — Monday's dateCreated
            // includes a time so the legacy `i.dateCreated === d.date`
            // comparison silently returned 0 for every day.
            const mondayLeadsForDay = items.filter(
              (i) => i.dateCreated.match(/(\d{4}-\d{2}-\d{2})/)?.[1] === d.date,
            ).length
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
      prevCpl,
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

/**
 * Build the per-client `selectedCampaignIds` map needed by the live-fetch path.
 * Used by both the date-range cache fall-through (when individual clients are
 * missing from `kpi_daily`) and the cold-start live-fetch at the bottom of POST.
 *
 * Before reading the table, runs the same auto-select pass that
 * `/api/clients/[id]/campaigns` GET does — any ACTIVE non-RL Meta campaign that has
 * no row yet gets upserted with is_selected=true. Without this, the watchlist's
 * live-fetch (force-refresh, cache miss, brand-new client) keeps filtering by
 * stale selections and reports "No spend or leads (7d)" while the client page
 * shows real data.
 */
async function loadSelectedCampaigns(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  mondayItemIds: string[],
  options: { skipAutoSelect?: boolean } = {},
): Promise<Record<string, Set<string>>> {
  const result: Record<string, Set<string>> = {}
  if (mondayItemIds.length === 0) return result

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, monday_item_id, meta_ad_account_id")
    .in("monday_item_id", mondayItemIds)

  // Auto-select pass — best-effort; failures here just mean the existing selections
  // get used as-is, same as if this step didn't exist.
  // Skipped when the caller only needs current selections (e.g. the self-heal
  // lookup just wants to know "does this client have ANY selected campaign?")
  // — the cron handles auto-selection daily so we don't need to do it on every
  // request, and the Meta fetch makes this the hottest cost in the route.
  if (!options.skipAutoSelect) {
    try {
      const { autoSelectActiveCampaignsForNonRlClients } = await import("@/lib/clients/auto-select-non-rl-campaigns")
      const candidates = (clientRows ?? [])
        .filter((r): r is { id: string; monday_item_id: string; meta_ad_account_id: string } =>
          Boolean(r.id && r.monday_item_id && r.meta_ad_account_id),
        )
        .map((r) => ({ clientId: r.id, mondayItemId: r.monday_item_id, metaAdAccountId: r.meta_ad_account_id }))
      if (candidates.length > 0) {
        const matched = await autoSelectActiveCampaignsForNonRlClients(supabase, candidates)
        if (matched.assignedCount > 0) {
          console.log(
            `[kpi-summaries] auto-selected ${matched.assignedCount} new ACTIVE non-RL campaigns across ${matched.affectedMondayItemIds.length} clients before live-fetch`,
          )
        }
      }
    } catch (e) {
      console.error("[kpi-summaries] non-RL auto-select failed:", e instanceof Error ? e.message : e)
    }
  }

  const itemToClientId: Record<string, string> = {}
  for (const row of clientRows ?? []) itemToClientId[row.monday_item_id] = row.id

  const clientIds = Object.values(itemToClientId)
  if (clientIds.length === 0) return result

  const { data: campaignRows } = await supabase
    .from("client_campaigns")
    .select("client_id, meta_campaign_id")
    .in("client_id", clientIds)
    .eq("is_selected", true)

  const clientIdToMondayItem = Object.fromEntries(
    Object.entries(itemToClientId).map(([k, v]) => [v, k]),
  )
  for (const row of campaignRows ?? []) {
    const mondayItemId = clientIdToMondayItem[row.client_id]
    if (!mondayItemId) continue
    if (!result[mondayItemId]) result[mondayItemId] = new Set()
    result[mondayItemId].add(row.meta_campaign_id)
  }
  return result
}

/**
 * Detect cached `rlAccountNoCampaign: true` entries that are now stale — i.e. the client
 * has selected campaigns in `client_campaigns` but the flag persists in cache.
 *
 * Why this happens: the campaigns POST endpoint runs `invalidateKpiCachesForClients` as
 * fire-and-forget (`void invalidateKpiCachesForClients(...)`) so it doesn't block the
 * response. On Vercel the function execution is killed once the response is sent, and
 * the cache write to `cache_store` can be cut off mid-flight. Result: the user picks
 * campaigns, the page says "saved", but the watchlist keeps showing "RL ad account —
 * no campaigns selected" until the next 30-min cron rewrites the cache.
 *
 * This helper is the self-heal: cheap Supabase lookup against `client_campaigns`,
 * returns the IDs that are truly stale. Caller treats them as cache-misses and routes
 * to live-fetch, which produces a fresh, flag-free entry.
 */
async function findStaleRlNoCampaign(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  candidateIds: string[],
): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set()
  // skipAutoSelect: we only need to know "do they have ANY selected campaign right
  // now"; running fetchMetaCampaigns for every non-RL ad account on a hot read path
  // adds seconds per request. The cron handles auto-selection daily.
  const selected = await loadSelectedCampaigns(supabase, candidateIds, { skipAutoSelect: true })
  const stale = new Set<string>()
  for (const id of candidateIds) {
    if ((selected[id]?.size ?? 0) > 0) stale.add(id)
  }
  return stale
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

/**
 * Fresh KPI fetch for an arbitrary date window. Wraps the same
 * batchProcess the POST handler uses, but skips the rolling-7d cache so
 * callers can ask for any [startDate, endDate] range (e.g., last week's
 * Mon-Sun for the weekly-update queue).
 *
 * Internal call only — assumes admin context. Don't expose without auth.
 */
export async function fetchKpisForWindow(args: {
  clients: ClientInput[]
  startDate: string
  endDate: string
}): Promise<Record<string, KpiSummary>> {
  const { clients, startDate, endDate } = args
  if (clients.length === 0) return {}
  const supabase = await createAdminClient()
  const selectedByMondayItemId = await loadSelectedCampaigns(
    supabase,
    clients.map((c) => c.mondayItemId),
  )
  const prev = getPreviousRange(startDate, endDate)
  return batchProcess(
    clients,
    startDate,
    endDate,
    prev.startDate,
    prev.endDate,
    5,
    selectedByMondayItemId,
    supabase,
  )
}

export type { ClientInput as KpiClientInput }

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

  const hasRequestedRange = !!(body.startDate && body.endDate)

  // Single-client fast path: the slide-over Home tab calls this with exactly one
  // client. Reading the entire monolithic `kpi_daily` blob (1-2MB, all clients)
  // just to extract one entry is the dominant cost of opening a panel. The cron
  // also writes per-client `kpi_daily:<id>` keys — one Supabase select returns
  // ~25KB and the panel renders within ~50ms instead of waiting for the bulk read
  // and parse. Stays disabled on `?force=1` so the Refresh button still rewarms
  // the canonical 7d cache via live-fetch.
  if (!force && body.clients.length === 1) {
    const only = body.clients[0]
    const perClient = await readCache<KpiDailyClientData>(`kpi_daily:${only.mondayItemId}`)
    if (perClient && perClient.days.length > 0) {
      // Self-heal: if the cached entry is flagged rlAccountNoCampaign but the
      // client now has selected campaigns, skip the fast path and let the
      // existing logic below route it to live-fetch.
      let stale = false
      if (perClient.rlAccountNoCampaign) {
        try {
          const supabase = await createAdminClient()
          stale = (await findStaleRlNoCampaign(supabase, [only.mondayItemId])).has(only.mondayItemId)
        } catch (e) {
          console.error("[kpi-summaries] single-client self-heal check failed:", e instanceof Error ? e.message : e)
        }
      }
      if (!stale) {
        const { startDate, endDate } = hasRequestedRange
          ? { startDate: body.startDate!, endDate: body.endDate! }
          : getLast7DaysRange()
        const { startDate: prevStartDate, endDate: prevEndDate } = hasRequestedRange
          ? getPreviousRange(startDate, endDate)
          : getPrevious7DaysRange()
        const summary = aggregateDailyToSummary(perClient, startDate, endDate, prevStartDate, prevEndDate)
        return NextResponse.json(
          { [only.mondayItemId]: summary },
          { headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" } },
        )
      }
    }
    // Fall through — per-client cache miss or stale flag. Existing logic below
    // covers it (will read the monolithic blob next, or live-fetch).
  }

  // Date-range path: when the caller specifies a window, aggregate from the daily
  // rollup cache. Range is exclusive of today (cache only contains up to yesterday).
  // If the daily cache is empty we fall straight through to a LIVE fetch with the
  // REQUESTED dates — never to the 7d cache. The old fall-through quietly served
  // 7d numbers for any custom range, which looked indistinguishable from a working
  // filter and was the source of "data doesn't change when I change the range".
  if (hasRequestedRange) {
    const dailyCache = await readCache<KpiDailyCache>("kpi_daily")
    if (dailyCache && Object.keys(dailyCache).length > 0) {
      const { startDate: prevStartDate, endDate: prevEndDate } = getPreviousRange(body.startDate!, body.endDate!)
      const summaries: Record<string, KpiSummary> = {}
      const missing: ClientInput[] = []

      // Self-heal: same stale-flag fix as in the 7d path. A cached daily entry with
      // `rlAccountNoCampaign: true` whose client now has selected campaigns is bogus
      // (the cron skipped the Meta fetch because no campaigns were selected, leaving
      // a zeros-only entry). Route those to live-fetch so the date-range view doesn't
      // serve stale "no campaigns selected" data.
      const flaggedIds = body.clients
        .filter((c) => dailyCache[c.mondayItemId]?.rlAccountNoCampaign === true)
        .map((c) => c.mondayItemId)
      let staleSet = new Set<string>()
      let supabaseShared: Awaited<ReturnType<typeof createAdminClient>> | null = null
      if (flaggedIds.length > 0) {
        try {
          supabaseShared = await createAdminClient()
          staleSet = await findStaleRlNoCampaign(supabaseShared, flaggedIds)
          if (staleSet.size > 0) {
            console.log(
              `[kpi-summaries] self-heal (date-range): ${staleSet.size} stale rlAccountNoCampaign entries — routing to live-fetch:`,
              [...staleSet],
            )
          }
        } catch (e) {
          console.error(
            "[kpi-summaries] self-heal lookup (date-range) failed:",
            e instanceof Error ? e.message : e,
          )
        }
      }

      for (const c of body.clients) {
        const daily = dailyCache[c.mondayItemId]
        if (!daily || staleSet.has(c.mondayItemId)) {
          missing.push(c)
          continue
        }
        summaries[c.mondayItemId] = aggregateDailyToSummary(daily, body.startDate!, body.endDate!, prevStartDate, prevEndDate)
      }

      // Live-fetch any clients missing from the cache. Two paths reach here:
      //   - Brand-new clients added since the last KPI cron tick.
      //   - Clients whose cache entry was just invalidated (e.g. campaigns
      //     auto-matched or manually selected) so the stale 0-numbers from
      //     the pre-selection cron run don't keep showing in the overview.
      //   - Self-healed clients whose `rlAccountNoCampaign` flag was stale.
      if (missing.length > 0) {
        try {
          const supabase = supabaseShared ?? (await createAdminClient())
          const selectedByMondayItemId = await loadSelectedCampaigns(
            supabase,
            missing.map((c) => c.mondayItemId),
          )
          const live = await batchProcess(
            missing,
            body.startDate!, body.endDate!, prevStartDate, prevEndDate,
            5, selectedByMondayItemId, supabase,
          )
          Object.assign(summaries, live)
        } catch (e) {
          console.error("[kpi-summaries] live-fetch for missing clients failed:", e instanceof Error ? e.message : e)
        }
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
      const missing: ClientInput[] = []

      // Self-heal: any cached entry with `rlAccountNoCampaign: true` whose client now has
      // selected campaigns is stale (cache invalidation never landed — see helper for the
      // backstory). Validate against `client_campaigns` and route stale clients to the
      // live-fetch path below so they get a fresh, flag-free entry.
      const flaggedIds = body.clients
        .filter((c) => cached[c.mondayItemId]?.rlAccountNoCampaign === true)
        .map((c) => c.mondayItemId)
      let staleSet = new Set<string>()
      let supabaseShared: Awaited<ReturnType<typeof createAdminClient>> | null = null
      if (flaggedIds.length > 0) {
        try {
          supabaseShared = await createAdminClient()
          staleSet = await findStaleRlNoCampaign(supabaseShared, flaggedIds)
          if (staleSet.size > 0) {
            console.log(
              `[kpi-summaries] self-heal: ${staleSet.size} stale rlAccountNoCampaign entries — routing to live-fetch:`,
              [...staleSet],
            )
          }
        } catch (e) {
          console.error(
            "[kpi-summaries] self-heal lookup failed (treating all as cache hits):",
            e instanceof Error ? e.message : e,
          )
        }
      }

      for (const c of body.clients) {
        if (cached[c.mondayItemId] && !staleSet.has(c.mondayItemId)) {
          summaries[c.mondayItemId] = cached[c.mondayItemId]
        } else {
          missing.push(c)
        }
      }
      // Live-fetch missing clients so newly-assigned RL campaigns and
      // brand-new clients aren't blank — same pattern as the date-range path.
      if (missing.length > 0) {
        try {
          const supabase = supabaseShared ?? (await createAdminClient())
          const { startDate, endDate } = getLast7DaysRange()
          const { startDate: prevStartDate, endDate: prevEndDate } = getPrevious7DaysRange()
          const selectedByMondayItemId = await loadSelectedCampaigns(
            supabase,
            missing.map((c) => c.mondayItemId),
          )
          const live = await batchProcess(
            missing,
            startDate, endDate, prevStartDate, prevEndDate,
            5, selectedByMondayItemId, supabase,
          )
          Object.assign(summaries, live)

          // Patch self-healed entries back into the kpi_summaries cache so subsequent
          // requests don't re-detect the stale flag and re-live-fetch on every load.
          // Re-read the cache before merging in case another request just wrote (best-effort).
          if (staleSet.size > 0) {
            const healed: Record<string, KpiSummary> = {}
            for (const id of staleSet) {
              if (live[id]) healed[id] = live[id]
            }
            if (Object.keys(healed).length > 0) {
              const latest = (await readCache<Record<string, KpiSummary>>("kpi_summaries")) ?? cached
              void writeCache("kpi_summaries", { ...latest, ...healed })
            }
          }
        } catch (e) {
          console.error("[kpi-summaries] 7d live-fetch for missing clients failed:", e instanceof Error ? e.message : e)
        }
      }
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
  const selectedByMondayItemId = await loadSelectedCampaigns(
    supabase,
    body.clients.map((c) => c.mondayItemId),
  )

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
