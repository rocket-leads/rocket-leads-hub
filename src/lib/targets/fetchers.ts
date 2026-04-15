/**
 * Reusable data fetchers for the Targets dashboard.
 * Used by both the cron job (for cache warming) and API routes (for live fallback).
 */

import Stripe from "stripe"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { getToken as getMondayToken, fetchAllItems, fetchBothBoards } from "@/lib/integrations/monday"
import { getToken as getMetaToken } from "@/lib/integrations/meta"
import type {
  MondayTargetsData,
  MondayTargetsByCountry,
  MetaTargetsData,
  MetaTargetsByCountry,
  CountryKey,
  CategoryBreakdown,
  FinanceOverview,
  CostData,
  DeliveryOverview,
  AccountManagerRevenue,
} from "@/types/targets"

// ─── Constants ──────────────────────────────────────────────────────────────

const TARGETS_BOARD_ID = "3762696870"
const META_AD_ACCOUNT_ID = "act_701293097368776"
const META_GRAPH_VERSION = "v20.0"
const HQ_COSTS_MONTHLY = 5000
const MONTH_NAMES_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

const STATUS_MAP = {
  qualified: ["Qualified", "No show", "No deal/FU", "No deal", "DEAL"],
  taken: ["No deal/FU", "No deal", "DEAL"],
  deals: ["DEAL"],
  rejections: ["Not interested", "Lead cancelation"],
  noShows: ["No show"],
}

const AD_BUDGET_KEYWORDS = [
  "advertentiebudget", "advertising budget", "adspend", "ad spend",
  "ad budget", "mediabudget", "media budget", "budget",
]

// ─── Helpers ────────────────────────────────────────────────────────────────

function getColumnValue(item: { column_values: Array<{ id: string; text: string }> }, columnId: string): string {
  return item.column_values.find((c) => c.id === columnId)?.text ?? ""
}

function getNumericValue(item: { column_values: Array<{ id: string; text: string }> }, columnId: string): number {
  const text = getColumnValue(item, columnId)
  const num = parseFloat(text.replace(/[^0-9.-]/g, ""))
  return isNaN(num) ? 0 : num
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null
  const match = dateStr.match(/(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function isInRange(dateStr: string | null, startDate: string, endDate: string): boolean {
  if (!dateStr) return false
  return dateStr >= startDate && dateStr <= endDate
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(d.setDate(diff))
  return monday.toISOString().split("T")[0]
}

function isAdBudget(description: string | null): boolean {
  if (!description) return false
  const lower = description.toLowerCase()
  return AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))
}

function emptyBreakdown(): CategoryBreakdown {
  return { invoiced: 0, cashCollected: 0, open: 0, overdue: 0 }
}

function addToBreakdown(bucket: CategoryBreakdown, amount: number, isPaid: boolean, isOverdue: boolean, isOpen: boolean) {
  bucket.invoiced += amount
  if (isPaid) bucket.cashCollected += amount
  else if (isOverdue) bucket.overdue += amount
  else if (isOpen) bucket.open += amount
}

function parseEuro(val: string | undefined): number {
  if (!val) return 0
  const cleaned = val.replace(/[€\s]/g, "").replace(/\./g, "").replace(",", ".")
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function getMonthCol(monthKey: string): number {
  const parts = monthKey.split("-")
  const mIdx = MONTH_NAMES_NL.indexOf(parts[0])
  return mIdx >= 0 ? mIdx + 1 : -1
}

function monthKey(year: number, month: number): string {
  return `${MONTH_NAMES_NL[month - 1]}-${String(year).slice(2)}`
}

async function getStripe(): Promise<Stripe> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "stripe")
    .single()
  if (!data) throw new Error("Stripe token not configured.")
  return new Stripe(decrypt(data.token_encrypted))
}

async function getGoogleAuth() {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "google_drive")
    .single()
  if (!data) throw new Error("Google service account not configured.")
  const keyJson = JSON.parse(decrypt(data.token_encrypted))
  return new google.auth.GoogleAuth({
    credentials: keyJson,
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  })
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

const COUNTRY_KEYS: CountryKey[] = ["all", "nl", "be", "de", "other"]

function getCountryKey(countryValue: string): CountryKey {
  const upper = countryValue.trim().toUpperCase()
  if (upper === "NL") return "nl"
  if (upper === "BE") return "be"
  if (upper === "DE") return "de"
  return "other"
}

/** Marketing / Sales — Monday board data, grouped by country */
export async function fetchMondayTargets(startDate: string, endDate: string): Promise<MondayTargetsByCountry> {
  const token = await getMondayToken()
  const allItems = await fetchAllItems(TARGETS_BOARD_ID, token)

  // Per-country accumulators
  type Acc = { leads: number; calls: number; qualifiedCalls: number; rejections: number; noShows: number; takenCalls: number; deals: number; closedRevenue: number; totalItems: number; industryMap: Record<string, { deals: number; revenue: number }> }
  const acc: Record<CountryKey, Acc> = {} as Record<CountryKey, Acc>
  for (const k of COUNTRY_KEYS) {
    acc[k] = { leads: 0, calls: 0, qualifiedCalls: 0, rejections: 0, noShows: 0, takenCalls: 0, deals: 0, closedRevenue: 0, totalItems: 0, industryMap: {} }
  }

  // Weekly maps per country
  const currentMonday = getMondayOfWeek(new Date().toISOString().split("T")[0])
  const targetWeeks = new Set<string>()
  for (let i = 0; i < 4; i++) {
    const d = new Date(currentMonday)
    d.setDate(d.getDate() - i * 7)
    targetWeeks.add(d.toISOString().split("T")[0])
  }
  type WeekRow = { calls: number; qualified: number; taken: number; deals: number; revenue: number }
  const weeklyMaps: Record<CountryKey, Record<string, WeekRow>> = {} as Record<CountryKey, Record<string, WeekRow>>
  for (const k of COUNTRY_KEYS) {
    weeklyMaps[k] = {}
    for (const ws of targetWeeks) weeklyMaps[k][ws] = { calls: 0, qualified: 0, taken: 0, deals: 0, revenue: 0 }
  }

  // Helper: add to "all" + specific country bucket
  const addTo = (country: CountryKey, fn: (a: Acc) => void) => { fn(acc.all); if (country !== "all") fn(acc[country]) }
  const addWeek = (country: CountryKey, ws: string, fn: (w: WeekRow) => void) => { fn(weeklyMaps.all[ws]); if (country !== "all") fn(weeklyMaps[country][ws]) }

  for (const item of allItems) {
    const country = getCountryKey(getColumnValue(item, "color"))
    const datumCreated = parseDate(getColumnValue(item, "datum_created"))
    const datumAfspraak = parseDate(getColumnValue(item, "datum_afspraak"))
    const dateDeal = parseDate(getColumnValue(item, "date3"))
    const status = getColumnValue(item, "status")
    const dealValue = getNumericValue(item, "numbers")
    const industry = getColumnValue(item, "status_17") || "Unknown"

    addTo(country, (a) => a.totalItems++)

    if (isInRange(datumCreated, startDate, endDate)) {
      addTo(country, (a) => { a.leads++; a.calls++ })
      if (STATUS_MAP.rejections.includes(status)) addTo(country, (a) => a.rejections++)
      if (STATUS_MAP.qualified.includes(status)) addTo(country, (a) => a.qualifiedCalls++)
      if (STATUS_MAP.noShows.includes(status)) addTo(country, (a) => a.noShows++)
    }
    if (isInRange(datumAfspraak, startDate, endDate) && STATUS_MAP.taken.includes(status)) {
      addTo(country, (a) => a.takenCalls++)
    }
    if (isInRange(dateDeal, startDate, endDate) && STATUS_MAP.deals.includes(status)) {
      addTo(country, (a) => {
        a.deals++; a.closedRevenue += dealValue
        if (!a.industryMap[industry]) a.industryMap[industry] = { deals: 0, revenue: 0 }
        a.industryMap[industry].deals++
        a.industryMap[industry].revenue += dealValue
      })
    }

    // Weekly
    if (datumCreated) {
      const ws = getMondayOfWeek(datumCreated)
      if (targetWeeks.has(ws)) {
        addWeek(country, ws, (w) => { w.calls++ })
        if (STATUS_MAP.qualified.includes(status)) addWeek(country, ws, (w) => w.qualified++)
      }
    }
    if (datumAfspraak) {
      const ws = getMondayOfWeek(datumAfspraak)
      if (targetWeeks.has(ws) && STATUS_MAP.taken.includes(status)) addWeek(country, ws, (w) => w.taken++)
    }
    if (dateDeal && STATUS_MAP.deals.includes(status)) {
      const ws = getMondayOfWeek(dateDeal)
      if (targetWeeks.has(ws)) addWeek(country, ws, (w) => { w.deals++; w.revenue += getNumericValue(item, "numbers") })
    }
  }

  // Build final result
  const result = {} as MondayTargetsByCountry
  for (const k of COUNTRY_KEYS) {
    const a = acc[k]
    const weekly = Object.entries(weeklyMaps[k])
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([weekStart, data]) => ({ weekStart, ...data }))
    const industries = Object.entries(a.industryMap)
      .sort(([, x], [, y]) => y.revenue - x.revenue)
      .map(([industry, data]) => ({ industry, ...data }))
    result[k] = { ...a, weekly, industries }
  }
  return result
}

function getMetaCountryKey(campaignName: string): CountryKey {
  const upper = campaignName.toUpperCase()
  if (upper.includes("NL")) return "nl"
  if (upper.includes("BE")) return "be"
  if (upper.includes("DE")) return "de"
  return "other"
}

function computeDerivedMetaMetrics(acc: { spend: number; impressions: number; clicks: number }): MetaTargetsData {
  return {
    spend: acc.spend,
    impressions: acc.impressions,
    clicks: acc.clicks,
    cpc: acc.clicks > 0 ? acc.spend / acc.clicks : 0,
    cpm: acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : 0,
    ctr: acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : 0,
  }
}

/** Marketing / Sales — Meta ad spend, grouped by country (campaign name contains NL/BE/DE) */
export async function fetchMetaTargets(startDate: string, endDate: string): Promise<MetaTargetsByCountry> {
  const token = await getMetaToken()
  const timeRange = JSON.stringify({ since: startDate, until: endDate })
  const fields = "campaign_name,spend,impressions,clicks"

  // Accumulate raw spend/impressions/clicks per country
  const raw: Record<CountryKey, { spend: number; impressions: number; clicks: number }> = {} as Record<CountryKey, { spend: number; impressions: number; clicks: number }>
  for (const k of COUNTRY_KEYS) raw[k] = { spend: 0, impressions: 0, clicks: 0 }

  let nextUrl: string | null = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_AD_ACCOUNT_ID}/insights?time_range=${encodeURIComponent(timeRange)}&fields=${fields}&level=campaign&limit=500&access_token=${token}`

  while (nextUrl) {
    const resp: Response = await fetch(nextUrl)
    const data: { data?: Array<{ campaign_name?: string; spend?: string; impressions?: string; clicks?: string }>; paging?: { next?: string }; error?: { message?: string } } = await resp.json()
    if (data.error) throw new Error(data.error.message || "Meta API error")

    for (const row of data.data ?? []) {
      const country = getMetaCountryKey(row.campaign_name || "")
      const spend = parseFloat(row.spend || "0")
      const impressions = parseInt(row.impressions || "0", 10)
      const clicks = parseInt(row.clicks || "0", 10)

      // Add to "all" + specific country
      raw.all.spend += spend; raw.all.impressions += impressions; raw.all.clicks += clicks
      raw[country].spend += spend; raw[country].impressions += impressions; raw[country].clicks += clicks
    }

    nextUrl = data.paging?.next ?? null
  }

  // Compute derived metrics (cpc, cpm, ctr) from aggregated raw values
  const result = {} as MetaTargetsByCountry
  for (const k of COUNTRY_KEYS) result[k] = computeDerivedMetaMetrics(raw[k])
  return result
}

/** Finance — Stripe revenue with NB/MRR split, excl. VAT, incl. credit notes */
export async function fetchFinance(startDate: string, endDate: string): Promise<FinanceOverview> {
  const stripe = await getStripe()
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)

  // Fetch all invoices in period (including credit notes which have negative amounts)
  const allInvoices: Stripe.Invoice[] = []
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const page = await stripe.invoices.list({
      created: { gte: startTs, lte: endTs },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const inv of page.data) {
      if (inv.status !== "draft" && inv.status !== "void") allInvoices.push(inv)
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  // Also fetch credit notes in the period — these are separate objects in Stripe
  const creditNotes: Stripe.CreditNote[] = []
  hasMore = true
  startingAfter = undefined
  while (hasMore) {
    const page: Stripe.ApiList<Stripe.CreditNote> = await stripe.creditNotes.list({
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const cn of page.data) {
      if (cn.created >= startTs && cn.created <= endTs) {
        creditNotes.push(cn)
      }
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
    // Stop early if we've gone past our date range
    if (page.data.length > 0 && page.data[page.data.length - 1].created < startTs) break
  }

  // For each unique customer: check if they had an invoice before the period (= MRR), else New Business
  const customerIds = [...new Set(allInvoices.map((inv) => inv.customer as string).filter(Boolean))]
  const isNewBusinessCustomer = new Map<string, boolean>()

  for (const customerId of customerIds) {
    const earlier = await stripe.invoices.list({
      customer: customerId,
      created: { lt: startTs },
      limit: 1,
    })
    const hasEarlier = earlier.data.some((inv) => inv.status !== "draft" && inv.status !== "void")
    isNewBusinessCustomer.set(customerId, !hasEarlier)
  }

  const total = emptyBreakdown()
  const serviceFee = emptyBreakdown()
  const serviceFeeNewBusiness = emptyBreakdown()
  const serviceFeeMrr = emptyBreakdown()
  const adBudget = emptyBreakdown()

  for (const inv of allInvoices) {
    const isOverdue = inv.status === "open" && inv.due_date != null && inv.due_date < now
    const isOpen = inv.status === "open" && !isOverdue
    const isPaid = inv.status === "paid"
    const custId = inv.customer as string
    const isNew = isNewBusinessCustomer.get(custId) ?? false

    for (const line of inv.lines?.data ?? []) {
      const isAd = isAdBudget(line.description)
      // Use amount EXCLUDING tax. line.amount is pre-tax in Stripe.
      // For the invoice-level total, use subtotal (excl tax) not total (incl tax).
      const amount = line.amount / 100
      addToBreakdown(total, amount, isPaid, isOverdue, isOpen)
      if (isAd) {
        addToBreakdown(adBudget, amount, isPaid, isOverdue, isOpen)
      } else {
        addToBreakdown(serviceFee, amount, isPaid, isOverdue, isOpen)
        if (isNew) addToBreakdown(serviceFeeNewBusiness, amount, isPaid, isOverdue, isOpen)
        else addToBreakdown(serviceFeeMrr, amount, isPaid, isOverdue, isOpen)
      }
    }
  }

  // Apply credit notes as negative amounts (subtract from totals)
  for (const cn of creditNotes) {
    // Credit note amount is positive in Stripe — we subtract it
    // Use subtotal (excl tax) to stay consistent with invoice amounts
    const creditAmount = (cn.subtotal ?? cn.amount) / 100
    const custId = cn.customer as string
    const isNew = isNewBusinessCustomer.get(custId) ?? false

    // Determine category from credit note line items
    let serviceFeeCredit = 0
    let adBudgetCredit = 0
    for (const line of cn.lines?.data ?? []) {
      const lineAmount = line.amount / 100
      if (isAdBudget(line.description)) {
        adBudgetCredit += lineAmount
      } else {
        serviceFeeCredit += lineAmount
      }
    }

    // If no line items, attribute entire credit to service fee
    if (cn.lines?.data?.length === 0 || (!serviceFeeCredit && !adBudgetCredit)) {
      serviceFeeCredit = creditAmount
    }

    // Subtract from breakdowns (credit notes reduce invoiced + cashCollected)
    const isPaid = cn.status === "issued" || cn.status === "void"
    total.invoiced -= creditAmount
    if (isPaid) total.cashCollected -= creditAmount

    if (adBudgetCredit > 0) {
      adBudget.invoiced -= adBudgetCredit
      if (isPaid) adBudget.cashCollected -= adBudgetCredit
    }
    if (serviceFeeCredit > 0) {
      serviceFee.invoiced -= serviceFeeCredit
      if (isPaid) serviceFee.cashCollected -= serviceFeeCredit
      if (isNew) {
        serviceFeeNewBusiness.invoiced -= serviceFeeCredit
        if (isPaid) serviceFeeNewBusiness.cashCollected -= serviceFeeCredit
      } else {
        serviceFeeMrr.invoiced -= serviceFeeCredit
        if (isPaid) serviceFeeMrr.cashCollected -= serviceFeeCredit
      }
    }
  }

  return {
    total, serviceFee, serviceFeeNewBusiness, serviceFeeMrr,
    adBudget, invoiceCount: allInvoices.length,
  }
}

/** Costs — Google Sheets only, with 3-month average estimation if current month is empty */
export async function fetchCosts(year: number, month: number): Promise<CostData> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!spreadsheetId) throw new Error("Spreadsheet ID not configured.")

  const authClient = await getGoogleAuth()
  const sheets = google.sheets({ version: "v4", auth: authClient })

  const profitsRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "Profits!A1:N30",
  })
  const profitsRows = profitsRes.data.values as string[][] | undefined

  const readMonth = (col: number) => ({
    invoicedRevenue: profitsRows ? parseEuro(profitsRows[5]?.[col]) : 0, // row 6 (Invoiced Revenue Total)
    collectedRevenue: profitsRows ? parseEuro(profitsRows[12]?.[col]) : 0, // row 13 (Total Cash Collected)
    teamCosts: profitsRows ? parseEuro(profitsRows[18]?.[col]) : 0, // row 19
    marketingCosts: profitsRows ? parseEuro(profitsRows[24]?.[col]) : 0, // row 25
  })

  const currentKey = monthKey(year, month)
  const currentCol = getMonthCol(currentKey)
  const current = currentCol >= 0 ? readMonth(currentCol) : { invoicedRevenue: 0, collectedRevenue: 0, teamCosts: 0, marketingCosts: 0 }

  let teamCosts = current.teamCosts
  let marketingCosts = current.marketingCosts
  const hqCosts = HQ_COSTS_MONTHLY
  const estimated = { teamCosts: false, marketingCosts: false, hqCosts: false }

  // Always build prior 3 months (needed for cost estimation AND collection rate)
  const priorMonths: Array<{ year: number; month: number; key: string }> = []
  let py = year, pm = month
  for (let i = 0; i < 3; i++) {
    pm--
    if (pm === 0) { pm = 12; py-- }
    priorMonths.push({ year: py, month: pm, key: monthKey(py, pm) })
  }

  const priorData = priorMonths.map((p) => {
    const c = getMonthCol(p.key)
    return c >= 0 ? readMonth(c) : { invoicedRevenue: 0, collectedRevenue: 0, teamCosts: 0, marketingCosts: 0 }
  })

  // Cost estimation: 3-month average (costs are mostly fixed, not revenue-dependent)
  if (teamCosts === 0 || marketingCosts === 0) {
    const validTeam = priorData.filter((d) => d.teamCosts > 0)
    const validMarketing = priorData.filter((d) => d.marketingCosts > 0)

    const avgTeam = validTeam.length > 0 ? validTeam.reduce((s, d) => s + d.teamCosts, 0) / validTeam.length : 0
    const avgMarketing = validMarketing.length > 0 ? validMarketing.reduce((s, d) => s + d.marketingCosts, 0) / validMarketing.length : 0

    if (teamCosts === 0) {
      teamCosts = Math.round(avgTeam)
      estimated.teamCosts = true
    }
    if (marketingCosts === 0) {
      marketingCosts = Math.round(avgMarketing)
      estimated.marketingCosts = true
    }
  }

  // Cash collection rate: avg(collected / invoiced) over prior 3 months
  const validCollectionMonths = priorData.filter((d) => d.invoicedRevenue > 0)
  const avgCollectionRate = validCollectionMonths.length > 0
    ? validCollectionMonths.reduce((s, d) => s + d.collectedRevenue / d.invoicedRevenue, 0) / validCollectionMonths.length
    : 0

  return {
    teamCosts,
    marketingCosts,
    hqCosts,
    totalCosts: teamCosts + marketingCosts + hqCosts,
    avgCollectionRate,
    estimated,
  }
}

/** Delivery — MRR/NB analysis + revenue per account manager */
export async function fetchDelivery(startDate: string, endDate: string): Promise<DeliveryOverview> {
  const stripe = await getStripe()
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)

  const periodMs = (endTs - startTs) * 1000
  const prevStartTs = startTs - Math.floor(periodMs / 1000)
  const prevEndTs = startTs - 1

  async function getInvoices(start: number, end: number): Promise<Stripe.Invoice[]> {
    const invoices: Stripe.Invoice[] = []
    let hasMore = true
    let startingAfter: string | undefined
    while (hasMore) {
      const page = await stripe.invoices.list({
        created: { gte: start, lte: end },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      invoices.push(...page.data.filter((inv) => inv.status !== "draft" && inv.status !== "void"))
      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }
    return invoices
  }

  const [currentInvoices, prevInvoices, mondayData] = await Promise.all([
    getInvoices(startTs, endTs),
    getInvoices(prevStartTs, prevEndTs),
    fetchBothBoards(),
  ])

  // Build Stripe customer ID → account manager map from Monday
  const amMap = new Map<string, string>()
  const allClients = [...mondayData.onboarding, ...mondayData.current]
  for (const client of allClients) {
    if (client.stripeCustomerId) amMap.set(client.stripeCustomerId, client.accountManager || "Unassigned")
  }

  const currentCustomerIds = new Set(currentInvoices.map((inv) => inv.customer as string).filter(Boolean))
  const prevCustomerIds = new Set(prevInvoices.map((inv) => inv.customer as string).filter(Boolean))

  // Check first-invoice for each current customer
  const firstInvoiceDates = new Map<string, number>()
  for (const customerId of currentCustomerIds) {
    if (firstInvoiceDates.has(customerId)) continue
    const page = await stripe.invoices.list({
      customer: customerId,
      limit: 1,
      status: "paid",
    })
    if (page.data.length > 0) firstInvoiceDates.set(customerId, page.data[0].created)
  }

  const customerRevenue = new Map<string, { invoiced: number; isNew: boolean; am: string }>()
  for (const inv of currentInvoices) {
    const custId = inv.customer as string
    if (!custId) continue
    const existing = customerRevenue.get(custId) || { invoiced: 0, isNew: false, am: "Unassigned" }
    existing.invoiced += inv.amount_due / 100
    existing.am = amMap.get(custId) || "Unassigned"
    const firstCreated = firstInvoiceDates.get(custId)
    if (firstCreated && firstCreated >= startTs && firstCreated <= endTs) existing.isNew = true
    customerRevenue.set(custId, existing)
  }

  let mrr = 0, newBusiness = 0, totalRevenue = 0
  const amRevenue = new Map<string, { revenue: number; customers: number; mrr: number; newBusiness: number }>()

  for (const [, data] of customerRevenue) {
    totalRevenue += data.invoiced
    if (data.isNew) newBusiness += data.invoiced
    else mrr += data.invoiced

    const amData = amRevenue.get(data.am) || { revenue: 0, customers: 0, mrr: 0, newBusiness: 0 }
    amData.revenue += data.invoiced
    amData.customers++
    if (data.isNew) amData.newBusiness += data.invoiced
    else amData.mrr += data.invoiced
    amRevenue.set(data.am, amData)
  }

  const churned = [...prevCustomerIds].filter((id) => !currentCustomerIds.has(id)).length

  const byAccountManager: AccountManagerRevenue[] = [...amRevenue.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([name, data]) => ({ name, ...data }))

  const activeCustomers = currentCustomerIds.size
  return {
    mrr,
    newBusiness,
    totalRevenue,
    activeCustomers,
    avgRevenuePerCustomer: activeCustomers > 0 ? totalRevenue / activeCustomers : 0,
    churnRate: prevCustomerIds.size > 0 ? churned / prevCustomerIds.size : 0,
    previousPeriodCustomers: prevCustomerIds.size,
    currentPeriodCustomers: activeCustomers,
    churned,
    byAccountManager,
  }
}

// ─── MTD helpers ────────────────────────────────────────────────────────────

export function getMtdRange(): { startDate: string; endDate: string; year: number; month: number } {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const start = new Date(Date.UTC(year, month - 1, 1))
  return { startDate: fmt(start), endDate: fmt(now), year, month }
}
