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

/** Marketing / Sales — Monday board data */
export async function fetchMondayTargets(startDate: string, endDate: string): Promise<MondayTargetsData> {
  const token = await getMondayToken()
  const allItems = await fetchAllItems(TARGETS_BOARD_ID, token)

  let leads = 0, calls = 0, qualifiedCalls = 0, rejections = 0
  let noShows = 0, takenCalls = 0, deals = 0, closedRevenue = 0
  const industryMap: Record<string, { deals: number; revenue: number }> = {}

  for (const item of allItems) {
    const datumCreated = parseDate(getColumnValue(item, "datum_created"))
    const datumAfspraak = parseDate(getColumnValue(item, "datum_afspraak"))
    const dateDeal = parseDate(getColumnValue(item, "date3"))
    const status = getColumnValue(item, "status")
    const dealValue = getNumericValue(item, "numbers")
    const industry = getColumnValue(item, "status_17") || "Unknown"

    if (isInRange(datumCreated, startDate, endDate)) {
      leads++; calls++
      if (STATUS_MAP.rejections.includes(status)) rejections++
      if (STATUS_MAP.qualified.includes(status)) qualifiedCalls++
      if (STATUS_MAP.noShows.includes(status)) noShows++
    }
    if (isInRange(datumAfspraak, startDate, endDate)) {
      if (STATUS_MAP.taken.includes(status)) takenCalls++
    }
    // Deals are counted by their CLOSING date (date3), not by appointment date.
    // This prevents deals from being attributed to the wrong month.
    if (isInRange(dateDeal, startDate, endDate) && STATUS_MAP.deals.includes(status)) {
      deals++; closedRevenue += dealValue
      if (!industryMap[industry]) industryMap[industry] = { deals: 0, revenue: 0 }
      industryMap[industry].deals++
      industryMap[industry].revenue += dealValue
    }
  }

  // Weekly aggregation: last 4 ISO weeks
  const weeklyMap: Record<string, { calls: number; qualified: number; taken: number; deals: number; revenue: number }> = {}
  const currentMonday = getMondayOfWeek(new Date().toISOString().split("T")[0])
  const targetWeeks = new Set<string>()
  for (let i = 0; i < 4; i++) {
    const d = new Date(currentMonday)
    d.setDate(d.getDate() - i * 7)
    const ws = d.toISOString().split("T")[0]
    targetWeeks.add(ws)
    weeklyMap[ws] = { calls: 0, qualified: 0, taken: 0, deals: 0, revenue: 0 }
  }

  for (const item of allItems) {
    const datumCreated = parseDate(getColumnValue(item, "datum_created"))
    const datumAfspraak = parseDate(getColumnValue(item, "datum_afspraak"))
    const dateDeal = parseDate(getColumnValue(item, "date3"))
    const status = getColumnValue(item, "status")
    if (datumCreated) {
      const ws = getMondayOfWeek(datumCreated)
      if (targetWeeks.has(ws)) {
        weeklyMap[ws].calls++
        if (STATUS_MAP.qualified.includes(status)) weeklyMap[ws].qualified++
      }
    }
    if (datumAfspraak) {
      const ws = getMondayOfWeek(datumAfspraak)
      if (targetWeeks.has(ws) && STATUS_MAP.taken.includes(status)) {
        weeklyMap[ws].taken++
      }
    }
    if (dateDeal && STATUS_MAP.deals.includes(status)) {
      const ws = getMondayOfWeek(dateDeal)
      if (targetWeeks.has(ws)) {
        weeklyMap[ws].deals++
        weeklyMap[ws].revenue += getNumericValue(item, "numbers")
      }
    }
  }

  const weekly = Object.entries(weeklyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, data]) => ({ weekStart, ...data }))

  const industries = Object.entries(industryMap)
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([industry, data]) => ({ industry, ...data }))

  return {
    leads, calls, qualifiedCalls, rejections, noShows, takenCalls,
    deals, closedRevenue, totalItems: allItems.length, weekly, industries,
  }
}

/** Marketing / Sales — Meta ad spend */
export async function fetchMetaTargets(startDate: string, endDate: string): Promise<MetaTargetsData> {
  const token = await getMetaToken()
  const timeRange = JSON.stringify({ since: startDate, until: endDate })
  const fields = "spend,impressions,clicks,cpc,cpm,ctr"
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_AD_ACCOUNT_ID}/insights?time_range=${encodeURIComponent(timeRange)}&fields=${fields}&level=account&access_token=${token}`

  const resp = await fetch(url)
  const data = await resp.json()
  if (data.error) throw new Error(data.error.message || "Meta API error")

  const insights = data.data?.[0]
  return insights
    ? {
        spend: parseFloat(insights.spend || "0"),
        impressions: parseInt(insights.impressions || "0", 10),
        clicks: parseInt(insights.clicks || "0", 10),
        cpc: parseFloat(insights.cpc || "0"),
        cpm: parseFloat(insights.cpm || "0"),
        ctr: parseFloat(insights.ctr || "0"),
      }
    : { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 }
}

/** Finance — Stripe revenue with NB/MRR split */
export async function fetchFinance(startDate: string, endDate: string): Promise<FinanceOverview> {
  const stripe = await getStripe()
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)

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
    teamCosts: profitsRows ? parseEuro(profitsRows[18]?.[col]) : 0, // row 19
    marketingCosts: profitsRows ? parseEuro(profitsRows[24]?.[col]) : 0, // row 25
  })

  const currentKey = monthKey(year, month)
  const currentCol = getMonthCol(currentKey)
  const current = currentCol >= 0 ? readMonth(currentCol) : { invoicedRevenue: 0, teamCosts: 0, marketingCosts: 0 }

  let teamCosts = current.teamCosts
  let marketingCosts = current.marketingCosts
  const hqCosts = HQ_COSTS_MONTHLY
  const estimated = { teamCosts: false, marketingCosts: false, hqCosts: false }

  if (teamCosts === 0 || marketingCosts === 0) {
    // Build prior 3 month list
    const priorMonths: Array<{ year: number; month: number; key: string }> = []
    let py = year, pm = month
    for (let i = 0; i < 3; i++) {
      pm--
      if (pm === 0) { pm = 12; py-- }
      priorMonths.push({ year: py, month: pm, key: monthKey(py, pm) })
    }

    // Read costs + revenue from sheet for these months
    const priorData = priorMonths.map((p) => {
      const c = getMonthCol(p.key)
      return c >= 0 ? readMonth(c) : { invoicedRevenue: 0, teamCosts: 0, marketingCosts: 0 }
    })

    // Sum across the 3 prior months
    const sumTeam = priorData.reduce((s, d) => s + d.teamCosts, 0)
    const sumMarketing = priorData.reduce((s, d) => s + d.marketingCosts, 0)
    const sumRevenue = priorData.reduce((s, d) => s + d.invoicedRevenue, 0)

    const teamRatio = sumRevenue > 0 ? sumTeam / sumRevenue : 0
    const marketingRatio = sumRevenue > 0 ? sumMarketing / sumRevenue : 0

    // Apply ratio to current month's invoiced revenue from the same sheet
    const currentRevenue = current.invoicedRevenue

    if (teamCosts === 0) {
      teamCosts = Math.round(currentRevenue * teamRatio)
      estimated.teamCosts = true
    }
    if (marketingCosts === 0) {
      marketingCosts = Math.round(currentRevenue * marketingRatio)
      estimated.marketingCosts = true
    }
  }

  return {
    teamCosts,
    marketingCosts,
    hqCosts,
    totalCosts: teamCosts + marketingCosts + hqCosts,
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
