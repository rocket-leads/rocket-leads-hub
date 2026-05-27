// ─── Configurable targets ───

export interface TargetsConfig {
  // Marketing / Sales — volume targets for opt-ins / booked / taken calls are
  // derived from (deals × cpd) ÷ {cpOptIn, cbc, ctc}; ratios are derived from
  // the cost ladder (booking rate = cpOptIn / cbc, show-up rate = cbc / ctc).
  // 2026-05-27: qualification stage dropped — cqc removed.
  deals: number
  revenue: number
  /** Max cost per opt-in (€) — top-of-funnel form submission. Derives the
   *  opt-ins volume target (adSpend / cpOptIn) and the appointment booking
   *  rate target (cpOptIn / cbc). */
  cpOptIn: number
  cbc: number
  ctc: number
  cpd: number
  // Finance — net profit € and max total costs € are derived from serviceFeeRevenue × profitMargin
  serviceFeeRevenue: number
  teamCosts: number
  profitMargin: number // as decimal, e.g. 0.30 = 30%
  // Delivery
  mrr: number
  newBusiness: number
  activeCustomers: number
  serviceFeePerCustomer: number
  maxChurnRate: number // as decimal, e.g. 0.05 = 5%
}


// ─── Marketing/Sales KPI types (ported from targets-import) ───

export interface MondayTargetsData {
  leads: number
  /** Top-of-funnel opt-ins from a separate Monday board (form submissions
   *  before they become booked calls). Counted on date_created within the
   *  period. Has no country attribution — only populated on the "all" bucket. */
  optIns: number
  /** Total booked calls in the period (every lead row with date_created in range). */
  calls: number
  /** Subset of booked calls that did NOT happen because the lead canceled
   *  before the call (4 status variants including "Not interested"). */
  cancellations: number
  /** Subset of booked calls where the lead didn't show up. */
  noShows: number
  /** Subset of booked calls that actually took place (Deal/Signed/No-deal-*). */
  takenCalls: number
  /** Closed-positive subset of taken (Deal + Signed). */
  deals: number
  closedRevenue: number
  totalItems: number
  weekly: WeeklyData[]
  industries: IndustryData[]
  closers: CloserData[]
  /**
   * Stripe-side cross-check: total New Business invoiced this period (service fee, after
   * credits, override-aware). Only populated on the "all" country bucket — Stripe has no
   * country attribution. Compare against `closedRevenue` to surface a gap (deals invoiced
   * in Stripe but not yet logged in Monday).
   */
  stripeNewBusinessRevenue: number
  /**
   * The individual Stripe NB invoices behind `stripeNewBusinessRevenue`, so the UI can
   * offer a drilldown when there's a gap. Only the "all" bucket is populated.
   */
  stripeNewBusinessInvoices: StripeNewBusinessInvoice[]
  /**
   * Monday closed deals (status=DEAL, dateDeal in period) behind `closedRevenue`. Surfaced
   * alongside the Stripe NB list so a CM can eyeball both sides of the gap: deals logged
   * in Monday but not yet invoiced in Stripe → unpaid; Stripe invoices not yet logged in
   * Monday → missing CRM entry.
   */
  closedDeals: ClosedDeal[]
}

export interface StripeNewBusinessInvoice {
  customerName: string
  invoiceNumber: string | null
  date: string
  amount: number
  hostedUrl: string | null
  /** True when fuzzy-matched to a Monday closed deal — UI hides matched rows by default. */
  matched: boolean
}

export interface ClosedDeal {
  /** Monday item name = lead/company name. */
  name: string
  /** Optional company name (separate `bedrijfsnaam` column on the targets board). */
  companyName: string | null
  closer: string | null
  /** YYYY-MM-DD when the deal was closed. */
  dateDeal: string
  dealValue: number
  mondayItemId: string
  /** True when fuzzy-matched to a Stripe NB invoice — UI hides matched rows by default. */
  matched: boolean
}

export interface CloserData {
  closer: string
  /** All past appointments scheduled with this closer in the period (regardless of status). */
  qualifiedCalls: number
  /** Future appointments scheduled in the period — visible workload but not yet measurable. */
  upcomingCalls: number
  /** Subset that was actually held (status in taken set: No deal/FU, No deal, DEAL). */
  takenCalls: number
  /** Past appointments still sitting in pre-call status (Qualified / Gepland) — closer hasn't updated. */
  notUpdated: number
  deals: number
  revenue: number
}

export interface WeeklyData {
  weekStart: string
  calls: number
  taken: number
  deals: number
  revenue: number
}

export interface IndustryData {
  industry: string
  deals: number
  revenue: number
}

export interface MetaTargetsData {
  spend: number
  impressions: number
  clicks: number
  cpc: number
  cpm: number
  ctr: number
}

export type CountryKey = "all" | "nl" | "be" | "de" | "other"
export type MondayTargetsByCountry = Record<CountryKey, MondayTargetsData>
export type MetaTargetsByCountry = Record<CountryKey, MetaTargetsData>

export interface DateRange {
  startDate: Date
  endDate: Date
}

export interface KpiCardData {
  label: string
  value: number | null
  formatted: string
  target?: number
  targetFormatted?: string
  variant: "cost" | "volume" | "neutral"
  isLoading: boolean
  error?: string | null
}

export interface KpiGroup {
  title: string
  kpis: KpiCardData[]
}

export type QuickPreset = {
  label: string
  getRange: () => DateRange
}

// ─── Finance types (Stripe-based) ───

export interface CategoryBreakdown {
  invoiced: number
  cashCollected: number
  open: number
  overdue: number
}

export interface InvoiceDetail {
  invoiceId: string
  invoiceNumber: string | null
  customerName: string | null
  date: string
  amount: number
  status: "paid" | "open" | "overdue" | "credit" | "credit_prev" | "credit_old"
  category: "service_fee" | "ad_budget"
  subCategory: "new_business" | "mrr"
  /** Stripe hosted invoice page URL (https://invoice.stripe.com/...). Null for credit notes whose original invoice is outside the period. */
  hostedUrl?: string | null
}

export interface FinanceOverview {
  total: CategoryBreakdown
  serviceFee: CategoryBreakdown
  serviceFeeNewBusiness: CategoryBreakdown
  serviceFeeMrr: CategoryBreakdown
  adBudget: CategoryBreakdown
  invoiceCount: number
  details: InvoiceDetail[]
}

// ─── Delivery types ───

export interface UnassignedCustomer {
  customerId: string
  customerName: string
  /** Total revenue for this customer in the period: fee (incl. credits) + adBudget (incl. credits). */
  revenue: number
  fee: number
  adBudget: number
  /**
   * Why this customer ended up under "Unassigned":
   * - "no_monday_match": the Stripe customer ID is not present on any Monday item's stripe_customer_id column.
   * - "empty_am": a Monday item links this Stripe customer, but its Account Manager column is empty.
   */
  reason: "no_monday_match" | "empty_am"
  /** When `reason === "empty_am"`: the Monday item ID so the UI can deep-link to it. Null otherwise. */
  mondayItemId: string | null
  /** Top fuzzy matches against unlinked Monday items, only for `no_monday_match` rows. */
  suggestions?: MatchSuggestion[]
}

export interface MatchSuggestion {
  mondayItemId: string
  itemName: string
  boardType: "onboarding" | "current"
  /** Match score 0-1, higher = better. */
  score: number
}

export interface UnlinkedMondayItem {
  id: string
  name: string
  boardType: "onboarding" | "current"
  /** First name from the Monday client board — fed into fuzzy matching alongside `name`. */
  firstName: string
  /** Optional `bedrijfsnaam` column when configured — used for fuzzy matching when present. */
  companyName: string
  /**
   * Raw `stripe_customer_id` column value (may be empty, single, or comma-separated).
   * Carried in the payload so the assign-customer endpoint can append the new ID without
   * needing an extra Monday read round-trip — that read was the main source of slowness.
   */
  stripeCustomerId: string
}

export interface DeliveryOverview {
  /** Service-fee revenue for returning customers (no earlier invoice). */
  mrr: number
  /** Service-fee revenue for new customers (first invoice this period). */
  newBusiness: number
  /** Service fee total = mrr + newBusiness. */
  serviceFeeRevenue: number
  /** Ad budget pass-through revenue. Not split into MRR/NB by design. */
  adBudget: number
  /** All invoiced revenue including ad budget = serviceFeeRevenue + adBudget. */
  totalRevenue: number
  /** Service fee revenue divided by active customers. */
  serviceFeePerCustomer: number
  activeCustomers: number
  churnRate: number
  previousPeriodCustomers: number
  currentPeriodCustomers: number
  /** Customers in current period not in previous period. */
  newClients: number
  /** Customers in previous period not in current period. */
  churned: number
  byAccountManager: AccountManagerRevenue[]
  /** Same shape as AM rollup but grouped by delivery team. Excludes Unassigned. */
  byTeam: AccountManagerRevenue[]
  /** Customer-level breakdown of the "Unassigned" AM bucket so it can be acted on directly. */
  unassignedCustomers: UnassignedCustomer[]
  /** Monday items without a stripe_customer_id — picker pool for manual assignment. */
  unlinkedMondayItems: UnlinkedMondayItem[]
}

export interface AccountManagerRevenue {
  name: string
  /** Total revenue for this AM = mrr + newBusiness + adBudget. */
  revenue: number
  customers: number
  /** Service-fee MRR for this AM. */
  mrr: number
  /** Service-fee new business for this AM. */
  newBusiness: number
  /** Service fee total for this AM = mrr + newBusiness. */
  serviceFee: number
  /** Ad budget pass-through for this AM. */
  adBudget: number
  /** Service fee divided by this AM's customer count. */
  serviceFeePerCustomer: number
}

// ─── Google Sheets cost types ───

export interface CostData {
  teamCosts: number
  marketingCosts: number
  hqCosts: number
  totalCosts: number
  /** Average cash collection rate from prior 3 months (collected / invoiced) */
  avgCollectionRate: number
  /** Per-category flags indicating whether the value is actual (from sheet) or estimated */
  estimated: {
    teamCosts: boolean
    marketingCosts: boolean
    hqCosts: boolean
  }
}

export interface ProfitOverview {
  revenue: number
  costs: number
  netProfit: number
  margin: number
  accountingProfit: number
  cashProfit: number
}
