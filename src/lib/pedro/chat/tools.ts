import type Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import {
  fetchBothBoards,
  parseStripeCustomerIds,
  type MondayClient,
} from "@/lib/integrations/monday"
import { fetchMetaCampaigns, fetchMetaInsights } from "@/lib/integrations/meta"
import { fetchBillingData } from "@/lib/integrations/stripe"
import {
  fetchMondayTargets,
  fetchMetaTargets,
  fetchFinance,
  getMtdRange,
} from "@/lib/targets/fetchers"
import { fetchKpisForWindow } from "@/app/api/kpi-summaries/route"
import type { CountryKey, PlatformKey } from "@/types/targets"

/**
 * Pedro chat tools - read-only wrappers around the Hub's existing (cached) data
 * functions, exposed to Claude as tool_use. Every tool returns a compact JSON
 * string. No tool mutates anything.
 *
 * Finance gating: `get_finance` and `get_client_billing` are only registered
 * (and only execute) for admin / finance users. See buildTools + executeTool.
 */

export type ToolContext = {
  isAdmin: boolean
  isFinance: boolean
}

function canSeeFinance(ctx: ToolContext): boolean {
  return ctx.isAdmin || ctx.isFinance
}

// ─── Date helpers ────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10)
}
/** Last 7 days including today - matches the Watch List / KPI convention. */
function last7dRange(): { startDate: string; endDate: string } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { startDate: fmt(start), endDate: fmt(end) }
}
function validDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s)
}

// ─── Client resolution ──────────────────────────────────────────────────────

let boardsMemo: { clients: MondayClient[]; at: number } | null = null
const BOARDS_TTL_MS = 5 * 60 * 1000

/** All clients from both Monday boards. Prefers the cron-warmed cache, falls
 *  back to a live fetch, then memoizes in-process for the request burst. */
async function loadClients(): Promise<MondayClient[]> {
  if (boardsMemo && Date.now() - boardsMemo.at < BOARDS_TTL_MS) return boardsMemo.clients
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
    60 * 60 * 1000,
  )
  const data = cached ?? (await fetchBothBoards())
  const clients = [...(data.onboarding ?? []), ...(data.current ?? [])]
  boardsMemo = { clients, at: Date.now() }
  return clients
}

async function resolveClient(ref: string): Promise<MondayClient | null> {
  const clients = await loadClients()
  const byId = clients.find((c) => c.mondayItemId === ref)
  if (byId) return byId
  const needle = ref.trim().toLowerCase()
  if (!needle) return null
  // Exact-ish then substring match on name / company name.
  return (
    clients.find(
      (c) => c.name.toLowerCase() === needle || c.companyName.toLowerCase() === needle,
    ) ??
    clients.find(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.companyName.toLowerCase().includes(needle),
    ) ??
    null
  )
}

// ─── Tool definitions ───────────────────────────────────────────────────────

const CLIENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_clients",
    description:
      "List Rocket Leads clients from the Monday boards. Use this FIRST to resolve a client name (e.g. 'Zumex', 'this campaign') to its mondayItemId before calling client-specific tools. Optionally filter by a name substring.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Optional case-insensitive substring to filter client name / company name.",
        },
        status: {
          type: "string",
          enum: ["all", "live", "onboarding"],
          description: "Filter by lifecycle. Default 'all'.",
        },
      },
    },
  },
  {
    name: "get_client_kpis",
    description:
      "Cost-per-lead (CPL), ad spend, lead count and CPL baselines for ONE client over a date window. Numbers are for the given window; the 30d baseline (baselineCpl) is the structural reference. Resolve the client via list_clients first. Default window is the last 7 days.",
    input_schema: {
      type: "object",
      properties: {
        mondayItemId: { type: "string", description: "The client's Monday item id (from list_clients)." },
        startDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to 7 days ago." },
        endDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to today." },
      },
      required: ["mondayItemId"],
    },
  },
  {
    name: "get_watchlist_status",
    description:
      "The Watch List bucket (action / watch / good) for clients, with days-in-bucket. Call with a mondayItemId for one client, or without to get all clients currently in 'action' or 'watch'.",
    input_schema: {
      type: "object",
      properties: {
        mondayItemId: { type: "string", description: "Optional single client id." },
      },
    },
  },
  {
    name: "get_meta_campaigns",
    description:
      "Meta ad campaigns for ONE client with per-campaign spend and leads over a window. Resolve the client via list_clients first. Default window is the last 7 days.",
    input_schema: {
      type: "object",
      properties: {
        mondayItemId: { type: "string", description: "The client's Monday item id." },
        startDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to 7 days ago." },
        endDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to today." },
      },
      required: ["mondayItemId"],
    },
  },
]

const TARGETS_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_targets_funnel",
    description:
      "Rocket Leads' OWN sales funnel (the agency, not a client): leads, opt-ins, booked/scheduled calls, taken calls, no-shows, deals and revenue for a period, plus a per-closer breakdown. Use this for questions about 'our' numbers, the bottleneck to hit our targets, or a closer's performance (e.g. Anel). Default period is month-to-date.",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to the 1st of this month." },
        endDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to today." },
        country: { type: "string", enum: ["all", "nl", "be", "de", "other"], description: "Country slice. Default 'all'." },
        closer: { type: "string", description: "Optional closer name filter (matches the 'wie_' column)." },
        platform: { type: "string", enum: ["all", "meta", "google"], description: "Ad-platform slice. Default 'all'." },
      },
    },
  },
  {
    name: "get_meta_targets",
    description:
      "Rocket Leads' OWN Meta ad spend for a period (spend, impressions, clicks, CPC, CPM, CTR), by country. Pair with get_targets_funnel to reason about cost-per-scheduled-call. Default period is month-to-date.",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to the 1st of this month." },
        endDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to today." },
      },
    },
  },
]

const FINANCE_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_finance",
    description:
      "Rocket Leads' finance overview from Stripe for a period: total invoiced / cash collected / open / overdue, split into service fee (New Business vs MRR) and ad budget. Sensitive. Default period is month-to-date.",
    input_schema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to the 1st of this month." },
        endDate: { type: "string", description: "YYYY-MM-DD. Optional, defaults to today." },
      },
    },
  },
  {
    name: "get_client_billing",
    description:
      "One client's Stripe billing: invoice history, totals invoiced / paid / outstanding, average payment days. Sensitive. Resolve the client via list_clients first.",
    input_schema: {
      type: "object",
      properties: {
        mondayItemId: { type: "string", description: "The client's Monday item id." },
      },
      required: ["mondayItemId"],
    },
  },
]

const MEETINGS_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_sales_calls",
    description:
      "Search ingested Fathom meeting transcripts (mostly sales calls). Use for questions like 'what can you pull from Anel's sales calls'. NOTE: there is no per-closer tracker; this searches transcript text, titles, summaries and the recorder name, so results are the calls that MENTION or were RECORDED BY the person, not a curated dashboard. Returns summaries + capped transcript excerpts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text to match in title / summary / transcript / recorder name (e.g. a closer name like 'Anel', or a topic)." },
        since: { type: "string", description: "YYYY-MM-DD. Only calls on/after this date. Optional." },
        limit: { type: "number", description: "Max calls to return (default 3, max 6)." },
      },
    },
  },
]

/** The tool schemas visible to Claude for this user (finance tools gated). */
export function buildTools(ctx: ToolContext): Anthropic.Tool[] {
  return [
    ...CLIENT_TOOLS,
    ...TARGETS_TOOLS,
    ...(canSeeFinance(ctx) ? FINANCE_TOOLS : []),
    ...MEETINGS_TOOLS,
  ]
}

// ─── Executor ───────────────────────────────────────────────────────────────

export type ToolResult = { ok: boolean; summary: string; data: unknown }

function money(n: number): string {
  return `€${Math.round(n).toLocaleString("en-GB")}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolInput = Record<string, any>

export async function executeTool(
  name: string,
  input: ToolInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "list_clients":
        return await runListClients(input)
      case "get_client_kpis":
        return await runClientKpis(input)
      case "get_watchlist_status":
        return await runWatchlistStatus(input)
      case "get_meta_campaigns":
        return await runMetaCampaigns(input)
      case "get_targets_funnel":
        return await runTargetsFunnel(input)
      case "get_meta_targets":
        return await runMetaTargets(input)
      case "get_finance":
        if (!canSeeFinance(ctx)) return denied("get_finance")
        return await runFinance(input)
      case "get_client_billing":
        if (!canSeeFinance(ctx)) return denied("get_client_billing")
        return await runClientBilling(input)
      case "search_sales_calls":
        return await runSearchSalesCalls(input)
      default:
        return { ok: false, summary: `Unknown tool: ${name}`, data: null }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "tool execution failed"
    return { ok: false, summary: `Tool ${name} failed: ${msg}`, data: { error: msg } }
  }
}

function denied(tool: string): ToolResult {
  return {
    ok: false,
    summary: `Access denied: ${tool} is finance-only and this user is not authorised. Tell the user finance data is out of scope for their access level.`,
    data: { error: "forbidden" },
  }
}

// ─── Tool implementations ────────────────────────────────────────────────────

async function runListClients(input: ToolInput): Promise<ToolResult> {
  const clients = await loadClients()
  const q = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
  const status = input.status === "live" || input.status === "onboarding" ? input.status : "all"
  let rows = clients
  if (status === "onboarding") rows = rows.filter((c) => c.boardType === "onboarding")
  if (status === "live") rows = rows.filter((c) => c.boardType === "current")
  if (q) {
    rows = rows.filter(
      (c) => c.name.toLowerCase().includes(q) || c.companyName.toLowerCase().includes(q),
    )
  }
  const compact = rows.slice(0, 60).map((c) => ({
    mondayItemId: c.mondayItemId,
    name: c.name,
    companyName: c.companyName || undefined,
    accountManager: c.accountManager || undefined,
    campaignManager: c.campaignManager || undefined,
    status: c.campaignStatus || undefined,
    board: c.boardType,
    hasMeta: !!c.metaAdAccountId,
    hasCrm: !!c.clientBoardId,
    hasStripe: !!c.stripeCustomerId,
  }))
  return {
    ok: true,
    summary: `${compact.length} client(s)${q ? ` matching "${input.query}"` : ""}.`,
    data: compact,
  }
}

async function runClientKpis(input: ToolInput): Promise<ToolResult> {
  const client = await resolveClient(String(input.mondayItemId ?? ""))
  if (!client) return { ok: false, summary: "Client not found. Call list_clients first.", data: null }
  const startDate = validDate(input.startDate) ? input.startDate : last7dRange().startDate
  const endDate = validDate(input.endDate) ? input.endDate : last7dRange().endDate

  const byId = await fetchKpisForWindow({
    clients: [
      {
        mondayItemId: client.mondayItemId,
        metaAdAccountId: client.metaAdAccountId || null,
        clientBoardId: client.clientBoardId || null,
      },
    ],
    startDate,
    endDate,
  })
  const k = byId[client.mondayItemId]
  if (!k) return { ok: false, summary: `No KPI data for ${client.name} (${startDate}..${endDate}).`, data: null }

  const data = {
    client: client.name,
    window: `${startDate}..${endDate}`,
    adSpend: k.adSpend,
    leads: k.leads,
    cpl: k.cpl,
    prevCpl: k.prevCpl,
    baselineCpl30d: k.baselineCpl,
    mondayCrmConnected: k.mondayCrmConnected ?? false,
    leadsSource: k.metaFallback ? "meta_fallback" : (k.mondayCrmConnected ? "monday_crm" : "unknown"),
    hasMetaAccount: !!client.metaAdAccountId,
  }
  const summary = client.metaAdAccountId
    ? `${client.name}: CPL ${data.cpl ? money(data.cpl) : "n/a"} (${startDate}..${endDate}), ${k.leads} leads, spend ${money(k.adSpend)}. 30d baseline CPL ${k.baselineCpl ? money(k.baselineCpl) : "n/a"}.`
    : `${client.name} has no Meta ad account linked, so spend/CPL are unavailable.`
  return { ok: true, summary, data }
}

async function runWatchlistStatus(input: ToolInput): Promise<ToolResult> {
  const supabase = await createAdminClient()
  const single = typeof input.mondayItemId === "string" && input.mondayItemId
  const client = single ? await resolveClient(String(input.mondayItemId)) : null
  if (single && !client) return { ok: false, summary: "Client not found. Call list_clients first.", data: null }

  let query = supabase
    .from("watchlist_client_state")
    .select("monday_item_id, category, since_date, prev_category")
  if (client) query = query.eq("monday_item_id", client.mondayItemId)
  else query = query.in("category", ["action", "watch"])
  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const clients = await loadClients()
  const nameById = new Map(clients.map((c) => [c.mondayItemId, c.name]))
  const today = fmt(new Date())
  const daysIn = (since: string) =>
    Math.max(0, Math.round((new Date(today).getTime() - new Date(since).getTime()) / 86400000))

  const list = (rows ?? []).map((r) => ({
    client: nameById.get(r.monday_item_id) ?? r.monday_item_id,
    category: r.category,
    daysInBucket: r.since_date ? daysIn(r.since_date) : null,
    isNew: r.since_date === today,
  }))
  if (client) {
    const one = list[0]
    return {
      ok: true,
      summary: one
        ? `${client.name} is in the "${one.category}" bucket (${one.daysInBucket}d).`
        : `${client.name} has no watch-list state (likely not a Live client with a Meta account).`,
      data: one ?? null,
    }
  }
  const action = list.filter((r) => r.category === "action")
  const watch = list.filter((r) => r.category === "watch")
  return {
    ok: true,
    summary: `${action.length} client(s) need action, ${watch.length} on watch.`,
    data: { action, watch },
  }
}

async function runMetaCampaigns(input: ToolInput): Promise<ToolResult> {
  const client = await resolveClient(String(input.mondayItemId ?? ""))
  if (!client) return { ok: false, summary: "Client not found. Call list_clients first.", data: null }
  if (!client.metaAdAccountId) return { ok: false, summary: `${client.name} has no Meta ad account linked.`, data: null }
  const startDate = validDate(input.startDate) ? input.startDate : last7dRange().startDate
  const endDate = validDate(input.endDate) ? input.endDate : last7dRange().endDate

  const [campaigns, insights] = await Promise.all([
    fetchMetaCampaigns(client.metaAdAccountId),
    fetchMetaInsights(client.metaAdAccountId, startDate, endDate).catch(() => []),
  ])
  const insightById = new Map(insights.map((i) => [i.campaignId, i]))
  const rows = campaigns.map((c) => {
    const ins = insightById.get(c.id)
    const spend = ins?.spend ?? 0
    const leads = ins?.leads ?? 0
    return {
      name: c.name,
      status: c.status,
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : null,
    }
  })
  rows.sort((a, b) => b.spend - a.spend)
  const active = rows.filter((r) => r.status === "ACTIVE").length
  return {
    ok: true,
    summary: `${client.name}: ${campaigns.length} campaign(s) (${active} active), window ${startDate}..${endDate}.`,
    data: { client: client.name, window: `${startDate}..${endDate}`, campaigns: rows.slice(0, 25) },
  }
}

function targetsRange(input: ToolInput): { startDate: string; endDate: string } {
  const mtd = getMtdRange()
  return {
    startDate: validDate(input.startDate) ? input.startDate : mtd.startDate,
    endDate: validDate(input.endDate) ? input.endDate : mtd.endDate,
  }
}

async function runTargetsFunnel(input: ToolInput): Promise<ToolResult> {
  const { startDate, endDate } = targetsRange(input)
  const country: CountryKey = ["all", "nl", "be", "de", "other"].includes(input.country)
    ? input.country
    : "all"
  const platform: PlatformKey | null =
    input.platform === "meta" || input.platform === "google" ? input.platform : null
  const closer = typeof input.closer === "string" && input.closer.trim() ? input.closer.trim() : null

  const byCountry = await fetchMondayTargets(startDate, endDate, closer, platform)
  const d = byCountry[country]
  const closers = d.closers
    .slice(0, 12)
    .map((c) => ({
      closer: c.closer,
      takenCalls: c.takenCalls,
      upcomingCalls: c.upcomingCalls,
      notUpdated: c.notUpdated,
      deals: c.deals,
      revenue: c.revenue,
      collectedRevenue: c.collectedRevenue,
    }))
  const data = {
    window: `${startDate}..${endDate}`,
    country,
    platform: platform ?? "all",
    closerFilter: closer,
    optIns: d.optIns,
    leads: d.leads,
    scheduledCalls: d.calls,
    takenCalls: d.takenCalls,
    noShows: d.noShows,
    cancellations: d.cancellations,
    notUpdated: d.notUpdated,
    upcoming: d.upcoming,
    deals: d.deals,
    closedRevenue: d.closedRevenue,
    collectedRevenue: d.collectedRevenue,
    closers,
  }
  return {
    ok: true,
    summary: `RL funnel ${startDate}..${endDate} (${country}${platform ? `/${platform}` : ""}): ${d.leads} leads, ${d.calls} scheduled calls, ${d.takenCalls} taken, ${d.deals} deals, ${money(d.collectedRevenue)} collected.`,
    data,
  }
}

async function runMetaTargets(input: ToolInput): Promise<ToolResult> {
  const { startDate, endDate } = targetsRange(input)
  const byCountry = await fetchMetaTargets(startDate, endDate)
  const all = byCountry.all
  return {
    ok: true,
    summary: `RL Meta spend ${startDate}..${endDate}: ${money(all.spend)}, ${all.clicks} clicks, CTR ${all.ctr.toFixed(2)}%.`,
    data: { window: `${startDate}..${endDate}`, ...byCountry.all, byCountry },
  }
}

async function runFinance(input: ToolInput): Promise<ToolResult> {
  const { startDate, endDate } = targetsRange(input)
  const f = await fetchFinance(startDate, endDate)
  const data = {
    window: `${startDate}..${endDate}`,
    total: f.total,
    serviceFee: f.serviceFee,
    serviceFeeNewBusiness: f.serviceFeeNewBusiness,
    serviceFeeMrr: f.serviceFeeMrr,
    adBudget: f.adBudget,
    invoiceCount: f.invoiceCount,
  }
  return {
    ok: true,
    summary: `Finance ${startDate}..${endDate}: invoiced ${money(f.total.invoiced)}, collected ${money(f.total.cashCollected)}, open ${money(f.total.open)}, overdue ${money(f.total.overdue)}.`,
    data,
  }
}

async function runClientBilling(input: ToolInput): Promise<ToolResult> {
  const client = await resolveClient(String(input.mondayItemId ?? ""))
  if (!client) return { ok: false, summary: "Client not found. Call list_clients first.", data: null }
  const ids = parseStripeCustomerIds(client.stripeCustomerId)
  if (ids.length === 0) return { ok: false, summary: `${client.name} has no Stripe customer linked.`, data: null }
  const billing = await fetchBillingData(ids[0])
  const invoices = billing.invoices.slice(0, 12).map((i) => ({
    number: i.number,
    status: i.status,
    amountDue: i.amountDue,
    amountPaid: i.amountPaid,
    created: new Date(i.created * 1000).toISOString().slice(0, 10),
  }))
  const data = {
    client: client.name,
    totalInvoiced: billing.totalInvoiced,
    totalPaid: billing.totalPaid,
    totalOutstanding: billing.totalOutstanding,
    avgPaymentDays: billing.avgPaymentDays,
    invoices,
  }
  return {
    ok: true,
    summary: `${client.name}: invoiced ${money(billing.totalInvoiced)}, paid ${money(billing.totalPaid)}, outstanding ${money(billing.totalOutstanding)}.`,
    data,
  }
}

async function runSearchSalesCalls(input: ToolInput): Promise<ToolResult> {
  const supabase = await createAdminClient()
  const limit = Math.min(6, Math.max(1, Number(input.limit) || 3))
  const q = typeof input.query === "string" ? input.query.trim() : ""
  const since = validDate(input.since) ? input.since : null

  let query = supabase
    .from("meetings")
    .select("title, scheduled_at, meeting_type, recorded_by_name, recorded_by_team, attendees, summary, transcript")
    .order("scheduled_at", { ascending: false })
    .limit(limit)
  if (since) query = query.gte("scheduled_at", since)
  if (q) {
    // Match the term across the useful text columns.
    const like = `%${q.replace(/[%_]/g, "")}%`
    query = query.or(
      `title.ilike.${like},summary.ilike.${like},transcript.ilike.${like},recorded_by_name.ilike.${like}`,
    )
  }
  const { data: rows, error } = await query
  if (error) throw new Error(error.message)

  const calls = (rows ?? []).map((r) => ({
    title: r.title,
    date: r.scheduled_at ? String(r.scheduled_at).slice(0, 10) : null,
    type: r.meeting_type,
    recordedBy: r.recorded_by_name,
    team: r.recorded_by_team,
    summary: r.summary ? String(r.summary).slice(0, 2000) : null,
    // Cap transcript so a handful of calls doesn't blow the token budget.
    transcriptExcerpt: r.transcript ? String(r.transcript).slice(0, 6000) : null,
  }))
  return {
    ok: true,
    summary: calls.length
      ? `${calls.length} meeting(s)${q ? ` matching "${q}"` : ""}. Transcripts are search-matched, not a per-person tracker.`
      : `No meetings found${q ? ` matching "${q}"` : ""}.`,
    data: calls,
  }
}
