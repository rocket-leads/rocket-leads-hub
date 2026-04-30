// ─── Configurable targets ───

export interface TargetsConfig {
  // Marketing / Sales — volume targets for booked / qualified / taken calls are derived
  // from (deals × cpd) ÷ {cbc, cqc, ctc}; ratios are derived from the cost ladder.
  deals: number
  revenue: number
  cbc: number
  cqc: number
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
  avgRevenuePerCustomer: number
  maxChurnRate: number // as decimal, e.g. 0.05 = 5%
}


// ─── Marketing/Sales KPI types (ported from targets-import) ───

export interface MondayTargetsData {
  leads: number
  calls: number
  qualifiedCalls: number
  rejections: number
  noShows: number
  takenCalls: number
  deals: number
  closedRevenue: number
  totalItems: number
  weekly: WeeklyData[]
  industries: IndustryData[]
  closers: CloserData[]
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
  qualified: number
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
  activeCustomers: number
  avgRevenuePerCustomer: number
  churnRate: number
  previousPeriodCustomers: number
  currentPeriodCustomers: number
  churned: number
  byAccountManager: AccountManagerRevenue[]
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
  /** Ad budget pass-through for this AM. */
  adBudget: number
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
