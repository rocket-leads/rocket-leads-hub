/**
 * Reusable data fetchers for the Targets dashboard.
 * Used by both the cron job (for cache warming) and API routes (for live fallback).
 */

import Stripe from "stripe"
import { google } from "googleapis"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { getToken as getMondayToken, fetchAllItems, fetchBothBoards, parseStripeCustomerIds } from "@/lib/integrations/monday"
import { getToken as getMetaToken } from "@/lib/integrations/meta"
import { TEAMS, teamForMember } from "@/lib/teams"
import type {
  MondayTargetsData,
  MondayTargetsByCountry,
  MetaTargetsData,
  MetaTargetsByCountry,
  CountryKey,
  CategoryBreakdown,
  FinanceOverview,
  InvoiceDetail,
  CostData,
  DeliveryOverview,
  AccountManagerRevenue,
  UnassignedCustomer,
  MatchSuggestion,
  UnlinkedMondayItem,
  StripeNewBusinessInvoice,
  ClosedDeal,
} from "@/types/targets"

// ─── Constants ──────────────────────────────────────────────────────────────

const TARGETS_BOARD_ID = "3762696870"
// The only Targets-board columns the marketing/sales aggregation reads. Passed
// to fetchAllItems so each page fetches ~9 columns instead of all ~30 - a big
// cut in payload + Monday query complexity, which is what makes the cold board
// scrape slow. Keep in sync with the getColumnValue/getNumericValue calls in
// fetchMondayTargets.
const TARGETS_BOARD_COLUMNS = [
  "color",
  "datum_created",
  "datum_afspraak",
  "date3",
  "status",
  "numbers",
  "status_17",
  "wie_",
  "bedrijfsnaam",
  // Collected revenue - actually-collected cash on a deal (e.g. €1k upfront of a
  // €3k close), attributed on the deal close date like closedRevenue. Roy 2026-07-23.
  "numeric_mm5bv69m",
]

// In-process cache for the raw Targets board items. The board is huge (full lead
// history across all clients) and pagination dominates the wall-clock time of
// /api/targets/monday - a cold fetch is ~3min while the per-range aggregation
// loop afterwards is sub-second. The items are identical regardless of date
// range, so caching them in memory lets range-switching reuse the same fetch.
//
// TTL is intentionally short (5 min) so freshly-created leads or status changes
// surface within a refresh-button click. The Supabase per-range cache layer in
// the route handler covers longer windows.
type TargetsBoardItem = Awaited<ReturnType<typeof fetchAllItems>>[number]
let targetsBoardCache: { items: TargetsBoardItem[]; fetchedAt: number; inflight: Promise<TargetsBoardItem[]> | null } = {
  items: [],
  fetchedAt: 0,
  inflight: null,
}
const TARGETS_BOARD_TTL_MS = 5 * 60 * 1000
/** Drop the in-process Targets board items cache - used by the refresh button to
 *  guarantee the next read paginates fresh from Monday. */
export function invalidateTargetsBoardItems(): void {
  targetsBoardCache = { items: [], fetchedAt: 0, inflight: null }
}
async function getTargetsBoardItems(token: string): Promise<TargetsBoardItem[]> {
  const fresh = Date.now() - targetsBoardCache.fetchedAt < TARGETS_BOARD_TTL_MS && targetsBoardCache.items.length > 0
  if (fresh) return targetsBoardCache.items
  // Coalesce concurrent cold fetches - if two requests land while the board is
  // being paginated, both await the same promise instead of triggering two
  // 3-minute parallel scrapes against Monday.
  if (targetsBoardCache.inflight) return targetsBoardCache.inflight
  const promise = fetchAllItems(TARGETS_BOARD_ID, token, 4, { columnIds: TARGETS_BOARD_COLUMNS })
    .then((items) => {
      targetsBoardCache = { items, fetchedAt: Date.now(), inflight: null }
      return items
    })
    .catch((err) => {
      targetsBoardCache = { ...targetsBoardCache, inflight: null }
      throw err
    })
  targetsBoardCache.inflight = promise
  return promise
}

// ─── Opt-ins board (separate from the targets / leads board) ───────────────
//
// Opt-ins = top-of-funnel form submissions before they're qualified into a
// lead row on the targets board. Each item has a `date4` column carrying its
// creation date - counting items with date4 in [startDate, endDate] gives the
// period's opt-in volume. Pair with ad spend → cost per opt-in.
//
// The board is small relative to the targets board (only form submissions,
// not the full lead history) but we cache it the same way for symmetry and
// so range-switching on the Marketing tab stays instant.
const OPT_INS_BOARD_ID = "6488483465"
const OPT_INS_DATE_COLUMN = "date4"
let optInsBoardCache: { items: TargetsBoardItem[]; fetchedAt: number; inflight: Promise<TargetsBoardItem[]> | null } = {
  items: [],
  fetchedAt: 0,
  inflight: null,
}
export function invalidateOptInsBoardItems(): void {
  optInsBoardCache = { items: [], fetchedAt: 0, inflight: null }
}
async function getOptInsBoardItems(token: string): Promise<TargetsBoardItem[]> {
  const fresh = Date.now() - optInsBoardCache.fetchedAt < TARGETS_BOARD_TTL_MS && optInsBoardCache.items.length > 0
  if (fresh) return optInsBoardCache.items
  if (optInsBoardCache.inflight) return optInsBoardCache.inflight
  const promise = fetchAllItems(OPT_INS_BOARD_ID, token, 4, { columnIds: [OPT_INS_DATE_COLUMN] })
    .then((items) => {
      optInsBoardCache = { items, fetchedAt: Date.now(), inflight: null }
      return items
    })
    .catch((err) => {
      optInsBoardCache = { ...optInsBoardCache, inflight: null }
      throw err
    })
  optInsBoardCache.inflight = promise
  return promise
}

/** Count items on the opt-ins board whose `date4` column lands in
 *  [startDate, endDate]. Used by fetchMondayTargets to populate the
 *  per-period opt-ins KPI on the Marketing tab. */
async function countOptInsInRange(token: string, startDate: string, endDate: string): Promise<number> {
  const items = await getOptInsBoardItems(token)
  let n = 0
  for (const item of items) {
    const raw = getColumnValue(item, OPT_INS_DATE_COLUMN)
    const day = parseDate(raw)
    if (day && day >= startDate && day <= endDate) n++
  }
  return n
}
const META_AD_ACCOUNT_ID = "act_701293097368776"
const META_GRAPH_VERSION = "v20.0"
const HQ_COSTS_MONTHLY = 5000
const MONTH_NAMES_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

// Targets-board lead-status buckets - used to slice the appointment funnel
// into "actually happened" (taken), "didn't happen" (no-show / cancellation)
// and "still pending" (notUpdated). Pipeline is Opt-in → Booked → Taken → Deal.
//
// Booked  = every row with an appointment date (datum_afspraak) in range.
// Taken   = booked (past appointments only) minus the "not-taken" statuses:
//           no-shows, cancellations, and still-to-qualify (Qualified).
// Deals   = rows with a Date-deal (date3) in range in a closed-positive status.
//
// Roy 2026-07-07: these label lists were rewritten to match the board's ACTUAL
// status options (queried live). The previous lists referenced labels that
// never existed on the board ("No deal not interested", "Not interested",
// "No deal follow up"), so Taken was silently undercounted - the real labels are
// "No deal/NI", "No deal/UQ", "No deal/FU" and "Not interesting". Old /
// deactivated labels (DEAL - AE, Lead cancelation, Gepland, No show automation)
// are kept in their buckets so historical ranges still count correctly.
const STATUS_MAP = {
  /** Call actually happened. Outcome may be positive (DEAL/Signed) or negative
   *  (No deal/* variants - call took place, just didn't close). */
  taken: [
    "DEAL", "Signed", "DEAL - AE",
    "No deal/FU", "No deal/NI", "No deal/UQ",
    // Back-compat with pre-2026 status labels:
    "Deal", "No deal",
  ],
  /** Closed-positive subset. Gated on Date-deal (date3), not appointment. */
  deals: ["DEAL", "Signed", "DEAL - AE", "Deal"],
  /** Booked but didn't show up. */
  noShows: ["No show", "No show automation"],
  /** Lead canceled/declined BEFORE the call took place - different from
   *  "No deal/NI" (call DID happen, they then said no). "Not interesting" is
   *  the standalone cancel-status (lead pulled out before the call). Old label
   *  "Lead cancelation" stays here for historical items. */
  cancellations: [
    "Cancelled", "Cancelled/TBR", "Cancelled No deal", "Not interesting",
    // Back-compat:
    "Lead cancelation", "Not interested",
  ],
  /** Booked but the call did NOT (yet) take place: no-show, cancellation, or
   *  still-pending qualification. Taken = booked (past) minus these. Kept as one
   *  set so Taken means "everything that isn't clearly a non-event" - robust to
   *  new outcome labels being added to the board. */
  notTaken: [
    "No show", "No show automation",
    "Cancelled", "Cancelled/TBR", "Cancelled No deal", "Not interesting", "Not interested", "Lead cancelation",
    "Qualified",
  ],
  /** Past-appointment statuses that mean the closer hasn't processed the call
   *  yet - surfaced as a "X not updated" data-quality warning on the closer
   *  table. Not counted as taken (Qualified/Planned are pre-outcome). */
  notUpdated: ["Planned", "Qualified", "Gepland"],
}

const AD_BUDGET_KEYWORDS = [
  "advertentiebudget", "advertising budget", "adspend", "ad spend",
  "ad budget", "mediabudget", "media budget", "budget",
]

/** Common company-form suffixes stripped during name normalization to make matching robust. */
const COMPANY_SUFFIXES = new Set([
  "bv", "nv", "ltd", "limited", "gmbh", "inc", "llc",
  "holding", "holdings", "group", "groep", "the",
  "company", "co", "sa", "sl", "ag", "ek", "ug", "sro",
])

/** Lowercase, drop punctuation, strip company-form noise so "Acme B.V." == "acme". */
function normalizeCompanyName(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  return cleaned
    .split(/\s+/)
    .filter((tok) => tok && !COMPANY_SUFFIXES.has(tok))
    .join(" ")
}

/** 0–1 similarity. Exact normalized match → 1. Substring containment → 0.9. Otherwise token Jaccard. */
function nameSimilarity(a: string, b: string): number {
  const na = normalizeCompanyName(a)
  const nb = normalizeCompanyName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return 0.9
  const aTokens = new Set(na.split(" ").filter(Boolean))
  const bTokens = new Set(nb.split(" ").filter(Boolean))
  if (aTokens.size === 0 || bTokens.size === 0) return 0
  let intersection = 0
  for (const t of aTokens) if (bTokens.has(t)) intersection++
  const unionSize = aTokens.size + bTokens.size - intersection
  return unionSize > 0 ? intersection / unionSize : 0
}

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

/**
 * Marketing / Sales - Monday board data, grouped by country.
 *
 * When `closerFilter` is provided, the top-level / weekly / industries / closed-deals
 * aggregations only include items where the `wie_` column matches. The per-closer
 * rollup always uses every item regardless of the filter - that's what populates the
 * "Closer" dropdown options on the dashboard, so we can't strip it down.
 */
export async function fetchMondayTargets(
  startDate: string,
  endDate: string,
  closerFilter?: string | null,
): Promise<MondayTargetsByCountry> {
  const token = await getMondayToken()
  // Kick off Stripe NB cross-check in parallel with the Monday board fetch - the two are
  // independent (Stripe results only join back at the fuzzy-matching step below) so there's
  // no reason to serialize them. Was the dominant wall-clock cost on this endpoint.
  const stripeCrossCheckPromise = (async (): Promise<{
    stripeNewBusinessRevenue: number
    stripeNewBusinessInvoices: StripeNewBusinessInvoice[]
  }> => {
    try {
      const stripe = await getStripe()
      const overrides = await loadInvoiceOverrides()
      const breakdown = await buildInvoiceBreakdown(stripe, startDate, endDate, overrides)
      const stripeNewBusinessRevenue = breakdown.serviceFeeNewBusiness.invoiced

      // Aggregate per invoice: a single invoice can contribute multiple line items in
      // `details`. Sum line amounts under the same invoiceId (positive only - credits
      // are handled by the aggregate above) and emit one row per invoice for the UI.
      const byInvoice = new Map<string, StripeNewBusinessInvoice>()
      for (const d of breakdown.details) {
        if (d.category !== "service_fee" || d.subCategory !== "new_business") continue
        if (d.amount <= 0) continue // credits land as negative; surface only positive lines
        const existing = byInvoice.get(d.invoiceId)
        if (existing) {
          existing.amount += d.amount
        } else {
          byInvoice.set(d.invoiceId, {
            customerName: d.customerName ?? "Unknown",
            invoiceNumber: d.invoiceNumber,
            date: d.date,
            amount: d.amount,
            hostedUrl: d.hostedUrl ?? null,
            matched: false, // filled in below after the fuzzy pairing
          })
        }
      }
      const stripeNewBusinessInvoices = [...byInvoice.values()].sort((a, b) => b.amount - a.amount)
      return { stripeNewBusinessRevenue, stripeNewBusinessInvoices }
    } catch (err) {
      console.warn("[fetchMondayTargets] Stripe NB cross-check failed:", err instanceof Error ? err.message : String(err))
      return { stripeNewBusinessRevenue: 0, stripeNewBusinessInvoices: [] }
    }
  })()
  // Opt-ins lives on a separate Monday board - kick it off in parallel with
  // the targets board fetch and the Stripe cross-check. Failure logs and
  // returns 0 so a missing-board / access issue degrades to "no opt-ins
  // surfaced" rather than failing the whole Marketing tab.
  const optInsPromise = countOptInsInRange(token, startDate, endDate).catch((err) => {
    console.warn("[fetchMondayTargets] opt-ins board fetch failed:", err instanceof Error ? err.message : String(err))
    return 0
  })
  const allItems = await getTargetsBoardItems(token)
  // Today (UTC, YYYY-MM-DD) - used to split closer appointments into past vs future.
  const todayStr = new Date().toISOString().slice(0, 10)
  const filter = closerFilter?.trim() || null
  const matchesFilter = (closerKey: string): boolean => !filter || closerKey === filter

  // Per-country accumulators
  type CloserAcc = { qualifiedCalls: number; upcomingCalls: number; takenCalls: number; notUpdated: number; deals: number; revenue: number }
  type Acc = {
    leads: number; calls: number; cancellations: number; noShows: number;
    takenCalls: number; deals: number; closedRevenue: number; collectedRevenue: number; totalItems: number;
    industryMap: Record<string, { deals: number; revenue: number }>;
    closerMap: Record<string, CloserAcc>;
  }
  const acc: Record<CountryKey, Acc> = {} as Record<CountryKey, Acc>
  for (const k of COUNTRY_KEYS) {
    acc[k] = { leads: 0, calls: 0, cancellations: 0, noShows: 0, takenCalls: 0, deals: 0, closedRevenue: 0, collectedRevenue: 0, totalItems: 0, industryMap: {}, closerMap: {} }
  }
  // Per-deal list (only populated for "all") so the gap modal can show every Monday-side
  // deal alongside the Stripe-side invoices.
  const closedDealsAll: ClosedDeal[] = []

  // Weekly maps per country
  const currentMonday = getMondayOfWeek(new Date().toISOString().split("T")[0])
  const targetWeeks = new Set<string>()
  for (let i = 0; i < 4; i++) {
    const d = new Date(currentMonday)
    d.setDate(d.getDate() - i * 7)
    targetWeeks.add(d.toISOString().split("T")[0])
  }
  type WeekRow = { calls: number; taken: number; deals: number; revenue: number }
  const weeklyMaps: Record<CountryKey, Record<string, WeekRow>> = {} as Record<CountryKey, Record<string, WeekRow>>
  for (const k of COUNTRY_KEYS) {
    weeklyMaps[k] = {}
    for (const ws of targetWeeks) weeklyMaps[k][ws] = { calls: 0, taken: 0, deals: 0, revenue: 0 }
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
    // Actually-collected cash on this deal (may be a partial upfront of dealValue).
    const collectedValue = getNumericValue(item, "numeric_mm5bv69m")
    const industry = getColumnValue(item, "status_17") || "Unknown"
    const closer = getColumnValue(item, "wie_").trim()
    const closerKey = closer || "Unassigned"
    // Top-level + weekly + industries + closed-deals all respect the closer filter.
    // The per-closer block further down ignores it on purpose so the dropdown always
    // sees every closer.
    const includeInTopLevel = matchesFilter(closerKey)

    if (includeInTopLevel) addTo(country, (a) => a.totalItems++)

    // Leads = rows CREATED in range - the CPL denominator (spend / leads).
    // Kept on creation date; it's "how many leads did our spend generate this
    // period", independent of when/if they later booked a call.
    if (includeInTopLevel && isInRange(datumCreated, startDate, endDate)) {
      addTo(country, (a) => a.leads++)
    }
    // Booked → Taken funnel is APPOINTMENT-date based (datum_afspraak), NOT
    // creation date. Booked = every row with an appointment in range. Taken =
    // booked (past appointments) minus the "not-taken" statuses (no-show,
    // cancellation, still-to-qualify). Future appointments are booked but not
    // yet taken. NoShow + Cancellation counters power the "Booked − Taken"
    // breakdown line and are counted on the same appointment basis so they
    // reconcile with Booked.
    if (includeInTopLevel && isInRange(datumAfspraak, startDate, endDate)) {
      addTo(country, (a) => a.calls++)
      if (STATUS_MAP.noShows.includes(status)) addTo(country, (a) => a.noShows++)
      else if (STATUS_MAP.cancellations.includes(status)) addTo(country, (a) => a.cancellations++)
      if (datumAfspraak !== null && datumAfspraak < todayStr && !STATUS_MAP.notTaken.includes(status)) {
        addTo(country, (a) => a.takenCalls++)
      }
    }
    if (includeInTopLevel && isInRange(dateDeal, startDate, endDate) && STATUS_MAP.deals.includes(status)) {
      addTo(country, (a) => {
        a.deals++; a.closedRevenue += dealValue; a.collectedRevenue += collectedValue
        if (!a.industryMap[industry]) a.industryMap[industry] = { deals: 0, revenue: 0 }
        a.industryMap[industry].deals++
        a.industryMap[industry].revenue += dealValue
      })
      // companyName falls back to "" when the targets board doesn't expose a
      // bedrijfsnaam column - the matcher then just uses item.name as today.
      const companyName = getColumnValue(item, "bedrijfsnaam") || ""
      closedDealsAll.push({
        name: item.name,
        companyName: companyName || null,
        closer: closer || null,
        dateDeal: dateDeal ?? "",
        dealValue,
        mondayItemId: item.id,
        matched: false, // filled in below after the fuzzy pairing
      })
    }

    // Per-closer aggregation. Any action in range counts:
    //   - past appointment   → qualifiedCalls (and notUpdated/taken subsets)
    //   - future appointment → upcomingCalls (visible workload, but excluded from show-up math)
    //   - deal closed        → deals + revenue
    //
    // Items without `wie_` populated are bucketed under "Unassigned" so the closer
    // table totals always equal global closedRevenue (no silent leakage).
    //
    // Show-up rate is computed downstream as taken / (qualifiedCalls − notUpdated).
    // NOTE: this block intentionally ignores `closerFilter` so the closers map stays
    // complete and the dashboard's Closer dropdown can list every option.
    const apptInRange = isInRange(datumAfspraak, startDate, endDate)
    const dealInRangeForCloser = isInRange(dateDeal, startDate, endDate) && STATUS_MAP.deals.includes(status)

    if (apptInRange || dealInRangeForCloser) {
      const ensureCloser = (a: Acc) => {
        if (!a.closerMap[closerKey]) {
          a.closerMap[closerKey] = { qualifiedCalls: 0, upcomingCalls: 0, takenCalls: 0, notUpdated: 0, deals: 0, revenue: 0 }
        }
        return a.closerMap[closerKey]
      }

      if (apptInRange) {
        const isPastAppointment = !!datumAfspraak && datumAfspraak < todayStr
        if (isPastAppointment) {
          addTo(country, (a) => { ensureCloser(a).qualifiedCalls++ })
          if (STATUS_MAP.notUpdated.includes(status)) {
            // Past + un-processed: count as taken AND track as notUpdated so we can
            // flag the data-quality issue without skewing conversion rate.
            addTo(country, (a) => {
              const c = ensureCloser(a)
              c.notUpdated++
              c.takenCalls++
            })
          } else if (STATUS_MAP.taken.includes(status)) {
            addTo(country, (a) => { ensureCloser(a).takenCalls++ })
          }
        } else {
          addTo(country, (a) => { ensureCloser(a).upcomingCalls++ })
        }
      }

      if (dealInRangeForCloser) {
        addTo(country, (a) => {
          const c = ensureCloser(a)
          c.deals++
          c.revenue += dealValue
        })
      }
    }

    // Weekly - same filter rule as the top-level: no contribution when the closer
    // doesn't match. Without this, a filtered view would still show team-wide
    // weekly bars next to a single closer's KPI cards.
    if (includeInTopLevel) {
      // Weekly bars mirror the top-level funnel: Booked (calls) + Taken are both
      // appointment-date based so the chart reconciles with the KPI cards.
      if (datumAfspraak) {
        const ws = getMondayOfWeek(datumAfspraak)
        if (targetWeeks.has(ws)) {
          addWeek(country, ws, (w) => { w.calls++ })
          if (datumAfspraak < todayStr && !STATUS_MAP.notTaken.includes(status)) addWeek(country, ws, (w) => w.taken++)
        }
      }
      if (dateDeal && STATUS_MAP.deals.includes(status)) {
        const ws = getMondayOfWeek(dateDeal)
        if (targetWeeks.has(ws)) addWeek(country, ws, (w) => { w.deals++; w.revenue += getNumericValue(item, "numbers") })
      }
    }
  }

  // Stripe NB cross-check was kicked off in parallel at the top of this function.
  // Result is country-agnostic - only the "all" bucket gets it. Independent of the
  // Monday aggregation; only joins back via the fuzzy matcher below.
  const { stripeNewBusinessRevenue, stripeNewBusinessInvoices } = await stripeCrossCheckPromise
  const optInsCount = await optInsPromise

  // Bidirectional fuzzy matching between Monday closed deals and Stripe NB invoices.
  // Greedy - sort all candidate pairs by similarity, claim the highest first, never let
  // either side be claimed twice. Anything still unclaimed is a real gap and shows in the UI.
  // Threshold 0.6 is permissive enough to catch most genuine matches (substring + Jaccard
  // both score 0.6+ on real-world variations) without false-pairing on weak overlaps.
  if (closedDealsAll.length > 0 && stripeNewBusinessInvoices.length > 0) {
    type Pair = { dealIdx: number; invIdx: number; score: number }
    const pairs: Pair[] = []
    const PAIR_THRESHOLD = 0.6
    for (let dIdx = 0; dIdx < closedDealsAll.length; dIdx++) {
      const d = closedDealsAll[dIdx]
      // Score against the deal's name AND companyName (when present) - pick the best.
      const dealVariants = [d.name, d.companyName].filter((s): s is string => !!s)
      for (let iIdx = 0; iIdx < stripeNewBusinessInvoices.length; iIdx++) {
        const inv = stripeNewBusinessInvoices[iIdx]
        let best = 0
        for (const variant of dealVariants) {
          const s = nameSimilarity(variant, inv.customerName)
          if (s > best) best = s
        }
        if (best >= PAIR_THRESHOLD) pairs.push({ dealIdx: dIdx, invIdx: iIdx, score: best })
      }
    }
    pairs.sort((a, b) => b.score - a.score)
    const claimedDeals = new Set<number>()
    const claimedInvoices = new Set<number>()
    for (const p of pairs) {
      if (claimedDeals.has(p.dealIdx) || claimedInvoices.has(p.invIdx)) continue
      claimedDeals.add(p.dealIdx)
      claimedInvoices.add(p.invIdx)
      closedDealsAll[p.dealIdx].matched = true
      stripeNewBusinessInvoices[p.invIdx].matched = true
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
    const closers = Object.entries(a.closerMap)
      .sort(([, x], [, y]) => y.revenue - x.revenue)
      .map(([closer, data]) => ({ closer, ...data }))
    // Only the "all" bucket carries Stripe data - Stripe is country-agnostic.
    result[k] = {
      ...a,
      weekly,
      industries,
      closers,
      // Opt-ins board has no country attribution - populate only on "all".
      optIns: k === "all" ? optInsCount : 0,
      stripeNewBusinessRevenue: k === "all" ? stripeNewBusinessRevenue : 0,
      stripeNewBusinessInvoices: k === "all" ? stripeNewBusinessInvoices : [],
      closedDeals: k === "all" ? [...closedDealsAll].sort((x, y) => y.dealValue - x.dealValue) : [],
    }
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

/** Marketing / Sales - Meta ad spend, grouped by country (campaign name contains NL/BE/DE) */
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
    // Previously only checked `data.error`; a non-200 with a different error
    // shape (token expired, rate-limited, etc.) slipped through and silently
    // returned zeros - the cron then cached the zeros and the Targets page
    // showed "all 0 spend" the rest of the day. Always throw on !ok so the
    // failure is surfaced via the route's catch block instead of poisoning
    // the cache.
    if (!resp.ok) {
      throw new Error(`Meta API ${resp.status}: ${data.error?.message ?? resp.statusText ?? "unknown error"}`)
    }
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

/** Finance - Stripe revenue with NB/MRR split, excl. VAT, incl. credit notes */
/**
 * Shared invoice-breakdown core. Both `fetchFinance` and `fetchDelivery` consume this so
 * the line-item classification (service fee vs ad budget) and credit-note handling live
 * in exactly one place.
 *
 * The credit logic mirrors what's surfaced in the Finance tab - same-month and
 * previous-month credits reduce totals; older credits are visible in `details` only.
 * Credits are split fee-vs-ad based on the credit note's own line items, falling back
 * to the original invoice's line proportions (fetching it if it sits outside the range).
 */
type CustomerLineRollup = {
  customerId: string
  customerName: string
  /** Default classification used when no per-invoice override exists. */
  isNewByDefault: boolean
  /** Service-fee invoiced classified as MRR (minus same-/prev-month MRR credits). */
  feeMrr: number
  /** Service-fee invoiced classified as New Business (minus same-/prev-month NB credits). */
  feeNewBusiness: number
  /** Ad budget invoiced minus same-/prev-month ad-budget credits. */
  adAmount: number
}

/**
 * Loads all per-invoice MRR/NB overrides keyed by stripe invoice id. Empty map
 * means "no overrides - use auto-detection everywhere". Cheap query (small
 * table - only manually-classified invoices).
 */
async function loadInvoiceOverrides(): Promise<Map<string, "mrr" | "new_business">> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("finance_invoice_overrides")
      .select("stripe_invoice_id, sub_category")
    const map = new Map<string, "mrr" | "new_business">()
    for (const row of data ?? []) {
      if (row.sub_category === "mrr" || row.sub_category === "new_business") {
        map.set(row.stripe_invoice_id, row.sub_category)
      }
    }
    return map
  } catch {
    return new Map()
  }
}

interface InvoiceBreakdown {
  total: CategoryBreakdown
  serviceFee: CategoryBreakdown
  serviceFeeNewBusiness: CategoryBreakdown
  serviceFeeMrr: CategoryBreakdown
  adBudget: CategoryBreakdown
  invoiceCount: number
  details: InvoiceDetail[]
  perCustomer: CustomerLineRollup[]
  currentCustomerIds: Set<string>
}

async function buildInvoiceBreakdown(
  stripe: Stripe,
  startDate: string,
  endDate: string,
  /**
   * Optional per-invoice MRR/NB overrides. When an entry exists, it wins over
   * the customer-level auto-detection for that invoice's lines (and any credit
   * notes that reference it). Allows the user to correct edge cases like
   * "this customer's 8th invoice triggered NB but is really MRR".
   */
  subCategoryOverrides: Map<string, "mrr" | "new_business"> = new Map(),
): Promise<InvoiceBreakdown> {
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)
  const now = Math.floor(Date.now() / 1000)

  // Invoices in period
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

  // Credit notes in period - Stripe doesn't support a `created` filter on creditNotes.list,
  // so we paginate reverse-chronologically and break out once we drop below startTs.
  const creditNotes: Stripe.CreditNote[] = []
  let cnHasMore = true
  let cnStartingAfter: string | undefined
  let cnPagesScanned = 0
  const CN_MAX_PAGES = 10
  while (cnHasMore && cnPagesScanned < CN_MAX_PAGES) {
    const page: Stripe.ApiList<Stripe.CreditNote> = await stripe.creditNotes.list({
      limit: 100,
      ...(cnStartingAfter ? { starting_after: cnStartingAfter } : {}),
    })
    cnPagesScanned++
    for (const cn of page.data) {
      if (cn.created >= startTs && cn.created <= endTs) creditNotes.push(cn)
    }
    cnHasMore = page.has_more
    cnStartingAfter = page.data[page.data.length - 1]?.id
    if (page.data.length > 0 && page.data[page.data.length - 1].created < startTs) break
  }

  // New-business detection: a customer with no earlier (non-draft/non-void) invoice is "new" this period.
  // Parallelized with a worker pool (concurrency 5) - the previous sequential loop was the
  // dominant cost on /api/targets/monday, ~300ms × N customers serialized end-to-end.
  const customerIds = [...new Set(allInvoices.map((inv) => inv.customer as string).filter(Boolean))]
  const isNewBusinessCustomer = new Map<string, boolean>()
  {
    const queue = [...customerIds]
    async function worker() {
      while (queue.length > 0) {
        const customerId = queue.shift()
        if (!customerId) return
        const earlier = await stripe.invoices.list({
          customer: customerId,
          created: { lt: startTs },
          limit: 1,
        })
        const hasEarlier = earlier.data.some((inv) => inv.status !== "draft" && inv.status !== "void")
        isNewBusinessCustomer.set(customerId, !hasEarlier)
      }
    }
    await Promise.all(Array.from({ length: 5 }, worker))
  }

  // For each "new" customer, identify the FIRST invoice they had in this period -
  // that single invoice gets the New Business label. Subsequent invoices for the
  // same customer in the same period are MRR (auto), even though the customer is
  // new-this-period overall. Without this, ArcadeLab/ProsperBiz-style cases where
  // a fresh customer has 2+ invoices in their first month would all be tagged NB.
  const firstInvoiceInPeriodByCustomer = new Map<string, string>()
  for (const customerId of customerIds) {
    if (!isNewBusinessCustomer.get(customerId)) continue
    let earliest: Stripe.Invoice | null = null
    for (const inv of allInvoices) {
      if (inv.customer !== customerId) continue
      if (!earliest || inv.created < earliest.created) earliest = inv
    }
    if (earliest) firstInvoiceInPeriodByCustomer.set(customerId, earliest.id)
  }

  // Customer name cache (used for details + perCustomer)
  const customerNameCache = new Map<string, string>()
  for (const inv of allInvoices) {
    const custId = inv.customer as string
    if (custId && !customerNameCache.has(custId)) {
      customerNameCache.set(custId, inv.customer_name || inv.customer_email || custId)
    }
  }

  const total = emptyBreakdown()
  const serviceFee = emptyBreakdown()
  const serviceFeeNewBusiness = emptyBreakdown()
  const serviceFeeMrr = emptyBreakdown()
  const adBudget = emptyBreakdown()
  const details: InvoiceDetail[] = []
  const perCustomer = new Map<string, CustomerLineRollup>()

  function ensureCustomer(custId: string, isNewByDefault: boolean): CustomerLineRollup {
    let row = perCustomer.get(custId)
    if (!row) {
      row = {
        customerId: custId,
        customerName: customerNameCache.get(custId) || custId,
        isNewByDefault,
        feeMrr: 0,
        feeNewBusiness: 0,
        adAmount: 0,
      }
      perCustomer.set(custId, row)
    }
    return row
  }

  /**
   * Resolve invoice → "mrr" | "new_business". Override wins; otherwise:
   * - Customer not new this period → MRR
   * - Customer new this period AND this is their first invoice in the period → New Business
   * - Customer new this period BUT this is a later invoice → MRR
   */
  function resolveSubCategory(
    invoiceId: string | undefined,
    customerId: string | undefined,
    customerIsNewDefault: boolean,
  ): "mrr" | "new_business" {
    const override = invoiceId ? subCategoryOverrides.get(invoiceId) : undefined
    if (override) return override
    if (!customerIsNewDefault) return "mrr"
    if (customerId && invoiceId && firstInvoiceInPeriodByCustomer.get(customerId) === invoiceId) {
      return "new_business"
    }
    return "mrr"
  }

  // Walk invoice line items
  for (const inv of allInvoices) {
    const isOverdue = inv.status === "open" && inv.due_date != null && inv.due_date < now
    const isOpen = inv.status === "open" && !isOverdue
    const isPaid = inv.status === "paid"
    const custId = inv.customer as string
    const isNewByDefault = isNewBusinessCustomer.get(custId) ?? false
    const subCategory = resolveSubCategory(inv.id, custId, isNewByDefault)
    const invDate = new Date(inv.created * 1000).toISOString().slice(0, 10)
    const invStatus: InvoiceDetail["status"] = isPaid ? "paid" : isOverdue ? "overdue" : "open"
    const customerRow = custId ? ensureCustomer(custId, isNewByDefault) : null

    for (const line of inv.lines?.data ?? []) {
      const isAd = isAdBudget(line.description)
      const amount = line.amount / 100
      addToBreakdown(total, amount, isPaid, isOverdue, isOpen)
      if (isAd) {
        addToBreakdown(adBudget, amount, isPaid, isOverdue, isOpen)
        if (customerRow) customerRow.adAmount += amount
      } else {
        addToBreakdown(serviceFee, amount, isPaid, isOverdue, isOpen)
        if (subCategory === "new_business") {
          addToBreakdown(serviceFeeNewBusiness, amount, isPaid, isOverdue, isOpen)
          if (customerRow) customerRow.feeNewBusiness += amount
        } else {
          addToBreakdown(serviceFeeMrr, amount, isPaid, isOverdue, isOpen)
          if (customerRow) customerRow.feeMrr += amount
        }
      }

      details.push({
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        customerName: customerNameCache.get(custId) || null,
        date: invDate,
        amount,
        status: invStatus,
        category: isAd ? "ad_budget" : "service_fee",
        subCategory,
        hostedUrl: inv.hosted_invoice_url ?? null,
      })
    }
  }

  // Apply credit notes
  // - "credit": same-month original (in current period) → counts against totals
  // - "credit_prev": previous-month original → counts against totals
  // - "credit_old": older than previous month → visible in details, does NOT affect totals
  const periodStart = new Date(startDate)
  const prevMonthStart = new Date(Date.UTC(periodStart.getFullYear(), periodStart.getMonth() - 1, 1))
  const prevMonthStartTs = Math.floor(prevMonthStart.getTime() / 1000)

  for (const cn of creditNotes) {
    const creditAmount = (cn.subtotal ?? cn.amount) / 100
    const custId = cn.customer as string
    const isNewByDefault = isNewBusinessCustomer.get(custId) ?? false
    const isPaid = cn.status === "issued" || cn.status === "void"

    const invoiceId = typeof cn.invoice === "string" ? cn.invoice : cn.invoice?.id
    let originalInv: Stripe.Invoice | null = invoiceId
      ? allInvoices.find((inv) => inv.id === invoiceId) ?? null
      : null
    // The credit's MRR/NB classification follows its original invoice - so an
    // override on the original applies to the credit too. We pass the *original
    // invoice's* id (not the credit note's id) because resolveSubCategory checks
    // whether that id is the customer's first-in-period.
    const cnSubCategory = resolveSubCategory(invoiceId, custId, isNewByDefault)

    let creditTier: "credit" | "credit_prev" | "credit_old"
    if (originalInv) {
      creditTier = "credit"
    } else if (invoiceId) {
      // Original invoice is outside the current period - fetch it once so we can both
      // determine the credit tier AND use its line items for the fee/ad split when the
      // credit note itself has no line breakdown (Stripe lets you create line-less CNs).
      try {
        const origInv = await stripe.invoices.retrieve(invoiceId)
        originalInv = origInv
        creditTier = origInv.created >= prevMonthStartTs ? "credit_prev" : "credit_old"
      } catch {
        creditTier = "credit_old"
      }
    } else {
      creditTier = "credit_old"
    }

    const countsAgainstTotal = creditTier === "credit" || creditTier === "credit_prev"

    // Split fee vs ad: prefer the credit note's own line items; otherwise pro-rate against
    // the original invoice's line items (now works for older originals too - was previously
    // a "all service fee" fallback that under-credited ad-budget). Last-resort fallback is
    // unchanged: assume service fee.
    let serviceFeeCredit = 0
    let adBudgetCredit = 0
    if (cn.lines?.data && cn.lines.data.length > 0) {
      for (const line of cn.lines.data) {
        const lineAmount = line.amount / 100
        if (isAdBudget(line.description)) adBudgetCredit += lineAmount
        else serviceFeeCredit += lineAmount
      }
    } else if (originalInv) {
      let origFee = 0, origAd = 0
      for (const line of originalInv.lines?.data ?? []) {
        if (isAdBudget(line.description)) origAd += line.amount / 100
        else origFee += line.amount / 100
      }
      const origTotal = origFee + origAd
      if (origTotal > 0) {
        serviceFeeCredit = creditAmount * (origFee / origTotal)
        adBudgetCredit = creditAmount * (origAd / origTotal)
      } else {
        serviceFeeCredit = creditAmount
      }
    } else {
      serviceFeeCredit = creditAmount
    }

    if (countsAgainstTotal) {
      total.invoiced -= creditAmount
      if (isPaid) total.cashCollected -= creditAmount

      if (adBudgetCredit > 0) {
        adBudget.invoiced -= adBudgetCredit
        if (isPaid) adBudget.cashCollected -= adBudgetCredit
      }
      if (serviceFeeCredit > 0) {
        serviceFee.invoiced -= serviceFeeCredit
        if (isPaid) serviceFee.cashCollected -= serviceFeeCredit
        if (cnSubCategory === "new_business") {
          serviceFeeNewBusiness.invoiced -= serviceFeeCredit
          if (isPaid) serviceFeeNewBusiness.cashCollected -= serviceFeeCredit
        } else {
          serviceFeeMrr.invoiced -= serviceFeeCredit
          if (isPaid) serviceFeeMrr.cashCollected -= serviceFeeCredit
        }
      }

      // Mirror credit application onto the per-customer rollup so AM totals net out properly.
      // The credit reduces the same MRR/NB bucket the original invoice belongs to.
      if (custId && perCustomer.has(custId)) {
        const row = perCustomer.get(custId)!
        if (cnSubCategory === "new_business") row.feeNewBusiness -= serviceFeeCredit
        else row.feeMrr -= serviceFeeCredit
        row.adAmount -= adBudgetCredit
      }
    }

    const cnDate = new Date(cn.created * 1000).toISOString().slice(0, 10)
    const cnCustomerName = customerNameCache.get(custId) || null
    const cnHostedUrl = originalInv?.hosted_invoice_url ?? null
    if (serviceFeeCredit > 0) {
      details.push({
        invoiceId: cn.id, invoiceNumber: cn.number, customerName: cnCustomerName,
        date: cnDate, amount: -serviceFeeCredit, status: creditTier,
        category: "service_fee", subCategory: cnSubCategory,
        hostedUrl: cnHostedUrl,
      })
    }
    if (adBudgetCredit > 0) {
      details.push({
        invoiceId: cn.id, invoiceNumber: cn.number, customerName: cnCustomerName,
        date: cnDate, amount: -adBudgetCredit, status: creditTier,
        category: "ad_budget", subCategory: cnSubCategory,
        hostedUrl: cnHostedUrl,
      })
    }
  }

  return {
    total, serviceFee, serviceFeeNewBusiness, serviceFeeMrr, adBudget,
    invoiceCount: allInvoices.length,
    details,
    perCustomer: [...perCustomer.values()],
    currentCustomerIds: new Set(customerIds),
  }
}

export async function fetchFinance(startDate: string, endDate: string): Promise<FinanceOverview> {
  const stripe = await getStripe()
  const overrides = await loadInvoiceOverrides()
  const breakdown = await buildInvoiceBreakdown(stripe, startDate, endDate, overrides)
  return {
    total: breakdown.total,
    serviceFee: breakdown.serviceFee,
    serviceFeeNewBusiness: breakdown.serviceFeeNewBusiness,
    serviceFeeMrr: breakdown.serviceFeeMrr,
    adBudget: breakdown.adBudget,
    invoiceCount: breakdown.invoiceCount,
    details: breakdown.details,
  }
}

/** Costs - Google Sheets only, with per-team-member augmentation when current month is partially filled. */
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

  // ── Team-cost augmentation ────────────────────────────────────────────────
  // If the current month is empty entirely → fall back to 3-month average.
  // If some team members have invoiced but others haven't yet → for each member
  // who's absent this month but invoiced in any of the last 3 months, add their
  // most-recent value as an "expected" amount. Without this, current team costs
  // look artificially low (e.g. 5 of 9 invoiced = 28k of expected ~50k) and the
  // resulting margin is way off.
  if (teamCosts === 0) {
    const validTeam = priorData.filter((d) => d.teamCosts > 0)
    if (validTeam.length > 0) {
      teamCosts = Math.round(validTeam.reduce((s, d) => s + d.teamCosts, 0) / validTeam.length)
      estimated.teamCosts = true
    }
  } else if (profitsRows && currentCol >= 0) {
    // Scan rows above the team-total (row 19, idx 18) for individual member rows.
    // Detection: non-empty label in col A, and not one of the known total/header rows.
    const SKIP_LABELS = new Set([
      "invoiced revenue total", "total cash collected", "team costs total",
      "team costs", "marketing costs total", "marketing costs", "hq costs",
      "total costs", "net profit", "margin",
    ])
    const priorCols = priorMonths.map((p) => getMonthCol(p.key)).filter((c) => c >= 0)
    let expectedFromMissing = 0
    for (let i = 0; i < 18; i++) {
      const row = profitsRows[i]
      if (!row) continue
      const label = (row[0] ?? "").trim()
      if (!label || SKIP_LABELS.has(label.toLowerCase())) continue
      const currentVal = parseEuro(row[currentCol])
      if (currentVal > 0) continue // already invoiced this month
      // Find their most recent prior-month value (last month → 2 months ago → 3 months ago).
      let lastKnown = 0
      for (const c of priorCols) {
        const v = parseEuro(row[c])
        if (v > 0) { lastKnown = v; break }
      }
      if (lastKnown > 0) expectedFromMissing += lastKnown
    }
    if (expectedFromMissing > 0) {
      teamCosts += Math.round(expectedFromMissing)
      estimated.teamCosts = true
    }
  }

  // Marketing - same simple 3-month-average fallback (no per-person logic).
  if (marketingCosts === 0) {
    const validMarketing = priorData.filter((d) => d.marketingCosts > 0)
    if (validMarketing.length > 0) {
      marketingCosts = Math.round(validMarketing.reduce((s, d) => s + d.marketingCosts, 0) / validMarketing.length)
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

/**
 * Delivery - service-fee MRR/NB + ad budget (kept separate) + revenue per account manager.
 *
 * Builds on the same `buildInvoiceBreakdown` core as Finance so the line-item split
 * (service fee vs ad budget) and credit-note handling are identical between the two tabs.
 * The only Delivery-specific work is: fetch the previous-period customer set for churn,
 * map customers → account managers via Monday, and roll up per-AM totals from the core's
 * per-customer breakdown.
 */
export async function fetchDelivery(startDate: string, endDate: string): Promise<DeliveryOverview> {
  const stripe = await getStripe()
  const startTs = Math.floor(new Date(startDate).getTime() / 1000)
  const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)

  const periodSeconds = endTs - startTs
  const prevStartTs = startTs - periodSeconds
  const prevEndTs = startTs - 1

  // Previous-period customers (for churn) - only the customer set is needed, no line detail.
  async function fetchPrevCustomerIds(): Promise<Set<string>> {
    const ids = new Set<string>()
    let hasMore = true
    let startingAfter: string | undefined
    while (hasMore) {
      const page = await stripe.invoices.list({
        created: { gte: prevStartTs, lte: prevEndTs },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const inv of page.data) {
        if (inv.status !== "draft" && inv.status !== "void" && inv.customer) {
          ids.add(inv.customer as string)
        }
      }
      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }
    return ids
  }

  const overrides = await loadInvoiceOverrides()
  const [breakdown, prevCustomerIds, mondayData] = await Promise.all([
    buildInvoiceBreakdown(stripe, startDate, endDate, overrides),
    fetchPrevCustomerIds(),
    fetchBothBoards(),
  ])

  // Stripe customer ID → Monday entry (account manager + item id). One Monday item can
  // map to MULTIPLE Stripe customer IDs - entity changes, alt payment methods, the same
  // client billed via two Stripe customers. The Monday `stripe_customer_id` column holds
  // them comma-separated; `parseStripeCustomerIds` splits them.
  type MondayLink = { accountManager: string; mondayItemId: string }
  const amMap = new Map<string, MondayLink>()
  const allClients = [...mondayData.onboarding, ...mondayData.current]
  for (const client of allClients) {
    const ids = parseStripeCustomerIds(client.stripeCustomerId)
    for (const id of ids) {
      amMap.set(id, {
        accountManager: client.accountManager,
        mondayItemId: client.mondayItemId,
      })
    }
  }

  // Picker pool - every Monday item, regardless of whether it already has a Stripe link.
  // Already-linked items must remain pickable so the user can attach a SECOND Stripe
  // customer to the same client (the assign endpoint appends rather than overwrites).
  // Carrying the existing `stripeCustomerId` value lets the assign endpoint skip its own
  // Monday read - saves one round-trip per assign click.
  // `firstName` + `companyName` are passed through so the suggestion scorer can match on
  // multiple fields (Stripe name vs Monday item / first name / company), not just item.name.
  const unlinkedMondayItems: UnlinkedMondayItem[] = allClients
    .map((c) => ({
      id: c.mondayItemId,
      name: c.name,
      boardType: c.boardType,
      firstName: c.firstName ?? "",
      companyName: c.companyName ?? "",
      stripeCustomerId: c.stripeCustomerId ?? "",
    }))

  // Per-AM rollup. mrr / newBusiness are service-fee only; adBudget is the pass-through bucket.
  // revenue is the total across all three so it stays usable for ranking.
  type AmAcc = { revenue: number; customers: number; mrr: number; newBusiness: number; adBudget: number }
  const amRevenue = new Map<string, AmAcc>()
  const unassignedCustomers: UnassignedCustomer[] = []

  for (const c of breakdown.perCustomer) {
    const link = amMap.get(c.customerId)
    const amName = link?.accountManager?.trim() || "Unassigned"
    const acc = amRevenue.get(amName) ?? { revenue: 0, customers: 0, mrr: 0, newBusiness: 0, adBudget: 0 }
    acc.customers++
    acc.adBudget += c.adAmount
    // perCustomer now splits fees by per-invoice classification (override-aware),
    // so we just add MRR / NB directly instead of bucketing by a single isNew flag.
    acc.mrr += c.feeMrr
    acc.newBusiness += c.feeNewBusiness
    acc.revenue = acc.mrr + acc.newBusiness + acc.adBudget
    amRevenue.set(amName, acc)

    if (amName === "Unassigned") {
      // Smart suggestions only make sense when there's no Monday match yet - otherwise the
      // fix is "fill the AM column", not "pick a Monday item".
      let suggestions: MatchSuggestion[] | undefined
      if (!link) {
        const SUGGESTION_THRESHOLD = 0.4
        const TOP_N = 3
        // Score against every available Monday-side variant - item.name, firstName,
        // companyName, and combined "first name + item name" - and pick the best.
        // Captures cases where Stripe customer is a person ("John Smith") while Monday
        // splits the same client into name=Acme BV / firstName=John, or where Monday
        // has the company name in a separate `bedrijfsnaam` column.
        suggestions = unlinkedMondayItems
          .map((item) => {
            const variants = [item.name, item.firstName, item.companyName].filter(Boolean)
            if (item.firstName && item.name) variants.push(`${item.firstName} ${item.name}`)
            let best = 0
            for (const v of variants) {
              const s = nameSimilarity(c.customerName, v)
              if (s > best) best = s
            }
            return {
              mondayItemId: item.id,
              itemName: item.name,
              boardType: item.boardType,
              score: best,
            }
          })
          .filter((s) => s.score >= SUGGESTION_THRESHOLD)
          .sort((a, b) => b.score - a.score)
          .slice(0, TOP_N)
      }

      const customerFee = c.feeMrr + c.feeNewBusiness
      unassignedCustomers.push({
        customerId: c.customerId,
        customerName: c.customerName,
        fee: customerFee,
        adBudget: c.adAmount,
        revenue: customerFee + c.adAmount,
        reason: link ? "empty_am" : "no_monday_match",
        mondayItemId: link?.mondayItemId ?? null,
        suggestions,
      })
    }
  }

  // Sort unassigned by revenue desc - highest-impact gaps surface first.
  unassignedCustomers.sort((a, b) => b.revenue - a.revenue)

  const byAccountManager: AccountManagerRevenue[] = [...amRevenue.entries()]
    .sort(([, a], [, b]) => b.revenue - a.revenue)
    .map(([name, data]) => ({
      name,
      revenue: data.revenue,
      customers: data.customers,
      mrr: data.mrr,
      newBusiness: data.newBusiness,
      serviceFee: data.mrr + data.newBusiness,
      adBudget: data.adBudget,
      serviceFeePerCustomer: data.customers > 0 ? (data.mrr + data.newBusiness) / data.customers : 0,
    }))

  // Roll AMs into delivery teams. Unassigned is excluded - it's surfaced separately
  // at the bottom of the dashboard. AMs that don't match any TEAMS member fall into
  // a synthetic "Other" bucket so nothing gets dropped silently.
  const teamAcc = new Map<string, { revenue: number; customers: number; mrr: number; newBusiness: number; adBudget: number }>()
  for (const am of byAccountManager) {
    if (am.name === "Unassigned") continue
    const teamName = teamForMember(am.name) ?? "Other"
    const acc = teamAcc.get(teamName) ?? { revenue: 0, customers: 0, mrr: 0, newBusiness: 0, adBudget: 0 }
    acc.revenue += am.revenue
    acc.customers += am.customers
    acc.mrr += am.mrr
    acc.newBusiness += am.newBusiness
    acc.adBudget += am.adBudget
    teamAcc.set(teamName, acc)
  }

  // Order: TEAMS list first (display order), then "Other" pinned last.
  const teamOrder = [...TEAMS.map((t) => t.name), "Other"]
  const byTeam: AccountManagerRevenue[] = teamOrder
    .filter((name) => teamAcc.has(name))
    .map((name) => {
      const data = teamAcc.get(name)!
      return {
        name,
        revenue: data.revenue,
        customers: data.customers,
        mrr: data.mrr,
        newBusiness: data.newBusiness,
        serviceFee: data.mrr + data.newBusiness,
        adBudget: data.adBudget,
        serviceFeePerCustomer: data.customers > 0 ? (data.mrr + data.newBusiness) / data.customers : 0,
      }
    })

  // Top-level totals come straight from the breakdown - keeps Delivery and Finance aligned.
  const mrr = breakdown.serviceFeeMrr.invoiced
  const newBusiness = breakdown.serviceFeeNewBusiness.invoiced
  const adBudget = breakdown.adBudget.invoiced
  const serviceFeeRevenue = breakdown.serviceFee.invoiced
  const totalRevenue = breakdown.total.invoiced

  const activeCustomers = breakdown.currentCustomerIds.size
  const churned = [...prevCustomerIds].filter((id) => !breakdown.currentCustomerIds.has(id)).length
  const newClients = [...breakdown.currentCustomerIds].filter((id) => !prevCustomerIds.has(id)).length

  return {
    mrr,
    newBusiness,
    serviceFeeRevenue,
    adBudget,
    totalRevenue,
    serviceFeePerCustomer: activeCustomers > 0 ? serviceFeeRevenue / activeCustomers : 0,
    activeCustomers,
    churnRate: prevCustomerIds.size > 0 ? churned / prevCustomerIds.size : 0,
    previousPeriodCustomers: prevCustomerIds.size,
    currentPeriodCustomers: activeCustomers,
    newClients,
    churned,
    byAccountManager,
    byTeam,
    unassignedCustomers,
    unlinkedMondayItems,
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
