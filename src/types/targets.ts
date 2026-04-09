// ─── Configurable targets ───

export interface TargetsConfig {
  calls: number
  qualifiedCalls: number
  takenCalls: number
  deals: number
  revenue: number
  cbc: number
  cqc: number
  ctc: number
  cpd: number
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

export interface FinanceOverview {
  total: CategoryBreakdown
  serviceFee: CategoryBreakdown
  adBudget: CategoryBreakdown
  invoiceCount: number
}

// ─── Delivery types ───

export interface CustomerRevenue {
  customerId: string
  customerName: string
  invoiced: number
  collected: number
  isNewBusiness: boolean
  category: "service_fee" | "ad_budget" | "unknown"
  accountManager: string | null
}

export interface DeliveryOverview {
  mrr: number
  newBusiness: number
  totalRevenue: number
  activeCustomers: number
  avgRevenuePerCustomer: number
  churnRate: number
  previousPeriodCustomers: number
  currentPeriodCustomers: number
  churned: number
  byAccountManager: AccountManagerRevenue[]
}

export interface AccountManagerRevenue {
  name: string
  revenue: number
  customers: number
  mrr: number
  newBusiness: number
}

// ─── Google Sheets cost types ───

export interface CostData {
  teamCosts: { nl: number; be: number; de: number; total: number }
  marketingCosts: { nl: number; be: number; de: number; total: number }
  hqCosts: { software: number; marketing: number; general: number; total: number }
  totalCosts: number
}

export interface ProfitOverview {
  revenue: number
  costs: number
  netProfit: number
  margin: number
  accountingProfit: number
  cashProfit: number
}
