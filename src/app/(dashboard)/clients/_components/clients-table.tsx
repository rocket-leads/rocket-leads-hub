"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FiltersPopover, type FilterConfig } from "@/components/ui/filters-popover"
import { ChevronDown, ChevronUp, ChevronsUpDown, TrendingUpDown } from "lucide-react"
import { DateRangePicker } from "@/app/(dashboard)/targets/_components/date-range-picker"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { AgreementSummary } from "@/app/api/clients/agreements-summary/route"
import type { QuickPreset } from "@/types/targets"
import {
  STATUS_LABEL_KEYS,
  STATUS_OPTIONS,
  mondayStatusToHub,
  statusLabel,
  type ClientStatus,
  PHASE_LABEL_KEYS,
  PHASE_OPTIONS,
  mondayLabelToOnboardingPhase,
  type OnboardingPhase,
} from "@/lib/clients/status"
import { StatusEditCell } from "./status-edit-cell"
import { PhaseEditCell } from "./phase-edit-cell"
import { PersonEditCell } from "./person-edit-cell"
import { ClientUpdateButton } from "./client-update-button"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { formatCurrency as formatCurrencyLocale } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"

// 187N bare status label (dot + mono uppercase, no fill) - the campaign-
// performance "● LIVE" treatment. Tones map to design-system status tokens
// via the `.st-label` classes in globals.css.
type StTone = "live" | "warn" | "error" | "idle" | "pending"

function StLabel({ tone, label }: { tone: StTone; label: string }) {
  return (
    <span className={`st-label ${tone}`}>
      <span className="sd" />
      {label}
    </span>
  )
}

const PAYMENT_TONE_KEYS: Record<string, StTone> = {
  complete: "live",
  open: "warn",
  overdue: "error",
}

/**
 * Period-over-period change indicator for CPL/CPA.
 * Down (cheaper) is good → green; up significantly → red; minor up → amber.
 * Chevron alone conveys direction; we drop the +/- to avoid duplication.
 */
function DeltaPill({ pct }: { pct: number }) {
  if (Math.abs(pct) < 0.5) {
    return <span className="text-muted-foreground/60">-</span>
  }
  const isDown = pct < 0
  const isHighUp = pct >= 25
  const colorClass = isDown
    ? "text-emerald-600 dark:text-emerald-400"
    : isHighUp
    ? "text-red-500 dark:text-red-400"
    : "text-amber-600 dark:text-amber-400"
  const Icon = isDown ? ChevronDown : ChevronUp
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${colorClass}`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(0)}%
    </span>
  )
}

/** Canonical payment-status filter values - match the BillingSummary.status
 *  enum (after capitalisation). Display labels are looked up via the
 *  dictionary at render time. */
const PAYMENT_STATUSES = ["Complete", "Open", "Overdue"] as const

const PAYMENT_LABEL_KEYS: Record<string, DictionaryKey> = {
  Complete: "clients.payment.complete",
  Open: "clients.payment.open",
  Overdue: "clients.payment.overdue",
}

/** Heuristic tone mapping for the Meta-connected status label. The exact set
 *  of labels on Monday's `dup__of_status` column may evolve, so we recognise
 *  common signals (connected/yes/done · pending/waiting · no/missing/restricted)
 *  and fall back to a neutral grey for anything else. */
function metaConnectedToneKey(label: string): StTone {
  const n = label.trim().toLowerCase()
  if (!n) return "idle"
  if (/^(connected|yes|done|live|ok|✓)/.test(n) || n === "rl") return "live"
  if (/(pending|waiting|in progress)/.test(n)) return "warn"
  if (/(no|not|missing|restricted|disabled|denied)/.test(n)) return "error"
  return "idle"
}

// --- Campaign Health ---
type HealthStatus = "critical" | "warning" | "good" | "no-data"

type HealthResult = {
  status: HealthStatus
  reasons: string[]
}

function getCampaignHealth(kpi: KpiSummary | undefined, locale: Locale = "en"): HealthResult {
  if (kpi?.rlAccountNoCampaign) {
    return { status: "no-data", reasons: [t("clients.health.reason.no_campaign", locale)] }
  }
  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { status: "no-data", reasons: [t("clients.health.reason.no_data", locale)] }
  }

  const reasons: string[] = []
  let status: HealthStatus = "good"

  // Trend-based: compare current 7d CPL vs previous 7d CPL.
  // Skip when prev period wasn't substantially live - a freshly-launched client
  // would otherwise read as a wild +/-X% swing that's purely an artefact of the
  // launch date. `prevPeriodReliable === false` is set explicitly by the API;
  // older cached entries without the flag default to "show" (undefined check).
  if (kpi.cpl > 0 && kpi.prevCpl > 0 && kpi.prevPeriodReliable !== false) {
    const cplChange = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100

    if (cplChange > 50) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} - up ${cplChange.toFixed(0)}% vs prev 7d (€${kpi.prevCpl.toFixed(2)})`)
      status = "critical"
    } else if (cplChange > 25) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} - up ${cplChange.toFixed(0)}% vs prev 7d (€${kpi.prevCpl.toFixed(2)})`)
      status = "warning"
    } else if (cplChange < -10) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} - down ${Math.abs(cplChange).toFixed(0)}% vs prev 7d`)
    } else {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} - stable vs prev 7d`)
    }
  }

  // Spend with zero leads = always critical
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    reasons.push(`€${kpi.adSpend.toFixed(0)} spent with 0 leads`)
    status = "critical"
  }

  // CPA trend is intentionally NOT a status driver right now - appointment data
  // is too sparse to be reliable (see categorize.ts). The CPA column itself still
  // displays the value; it just doesn't push a client into critical/warning.

  // Good summary
  if (status === "good" && reasons.length === 0) {
    if (kpi.leads > 0) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} - ${kpi.leads} leads`)
    } else {
      reasons.push(t("clients.health.reason.running_normally", locale))
    }
  }

  return { status, reasons }
}

const HEALTH_STYLES: Record<HealthStatus, { dot: string; tone: StTone; labelKey: DictionaryKey | null }> = {
  critical: { dot: "bg-red-500", tone: "error", labelKey: "clients.health.critical" },
  warning: { dot: "bg-amber-500", tone: "warn", labelKey: "clients.health.warning" },
  good: { dot: "bg-emerald-500", tone: "live", labelKey: "clients.health.good" },
  "no-data": { dot: "bg-zinc-400", tone: "idle", labelKey: null },
}

/** Health filter values are the canonical English status names - they map to
 *  the HealthStatus enum at filter-evaluation time. The DISPLAY label is
 *  translated via the dictionary on each filter option. */
const HEALTH_FILTER_VALUES = ["Good", "Warning", "Critical"] as const

function HealthBadge({ health, locale }: { health: HealthResult; locale: Locale }) {
  const style = HEALTH_STYLES[health.status]
  if (health.status === "no-data") {
    return <span className="text-muted-foreground text-sm">-</span>
  }
  return (
    <div className="relative group">
      <span className={`st-label ${style.tone}`}>
        <span className="sd" />
        {style.labelKey ? t(style.labelKey, locale) : "-"}
      </span>
      {health.reasons.length > 0 && (
        <div className="absolute z-50 hidden group-hover:block bottom-full left-0 mb-1.5 w-64 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
          <ul className="space-y-1">
            {health.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type SortKey = "client" | "accountManager" | "campaignManager" | "status" | "phase" | "kickOff" | "adspend" | "leads" | "cpl" | "cplDelta" | "paymentStatus" | "overdue" | "health" | "mrr" | "nextInvoice" | "clientUpdate"
type SortDir = "asc" | "desc"

// Toggleable column groups (current board only). Each user picks which
// blocks they want visible; preference saved per browser via localStorage.
type GroupKey = "status" | "invoice" | "people" | "kpi"
const GROUP_LABEL_KEYS: Record<GroupKey, "clients.group.status" | "clients.group.invoice" | "clients.group.people" | "clients.group.kpi"> = {
  status: "clients.group.status",
  invoice: "clients.group.invoice",
  people: "clients.group.people",
  kpi: "clients.group.kpi",
}

type Props = {
  clients: MondayClient[]
  boardType: "onboarding" | "current"
  billingSummaries?: Record<string, BillingSummary>
  kpiSummaries?: Record<string, KpiSummary>
  agreementSummaries?: Record<string, AgreementSummary>
  mondayActiveMap?: Record<string, boolean>
  /** Most recent "Client update" send timestamp per Monday item, ISO string.
   *  Drives the green "Geüpdatet vandaag" state + grey caption below the
   *  Update button. Missing entry = never sent yet. */
  lastClientUpdates?: Record<string, string>
  defaultSortKey?: SortKey
  defaultSortDir?: SortDir
  /** When provided, renders a "X of Y clients" indicator + show all/active toggle in the search row. */
  showAllToggle?: {
    showAll: boolean
    setShowAll: (next: boolean) => void
    totalCount: number
  }
  /**
   * When provided, renders a date-range picker + preset chips in the search row.
   * The selected range is used by the parent to fetch period-scoped KPI data, so this
   * component only owns the UI control surface - state lives in the parent.
   */
  dateRangeControl?: {
    startDate: Date
    endDate: Date
    setRange: (start: Date, end: Date) => void
    presets: QuickPreset[]
    applyPreset: (preset: QuickPreset) => void
    /** Latest selectable day in the calendar (used to disable today). */
    maxDate?: Date
  }
  /**
   * Row-click handler. When supplied, clicking a row calls this with the
   * Monday item ID and skips full-page navigation - used by the slide-over
   * panel UX on the All Clients page. Falls back to internal `/clients/[id]`
   * navigation when omitted.
   */
  onSelectClient?: (mondayItemId: string) => void
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function fmt(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** YYYY-MM-DD → "5 May" - keep the overview cell narrow. */
function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function fmtKpi(value: number, type: "currency" | "integer"): string {
  if (type === "currency") return `€${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return value.toLocaleString("en-GB")
}

/** True when `iso` falls on/after the most recent Monday 00:00 local time.
 *  The weekly update runs on a Monday-Sunday cadence, so "sent this week"
 *  (not "sent today") is the right signal: on any given Monday an AM wants
 *  one glance at who has already had this week's update and who hasn't.
 *  A send on Monday keeps the row green through the following Sunday, then
 *  the button returns the next Monday. Roy 2026-07-14. */
function isSentThisWeek(iso: string | undefined): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = new Date()
  const monday = new Date(now)
  // getDay(): 0 = Sunday … 6 = Saturday → offset back to this week's Monday.
  const offsetFromMonday = (now.getDay() + 6) % 7
  monday.setDate(now.getDate() - offsetFromMonday)
  monday.setHours(0, 0, 0, 0)
  return d.getTime() >= monday.getTime()
}

/** "Laatste update: 15 mei" - short caption matching the MRR/budget style. */
function fmtLastUpdateLabel(iso: string | undefined, locale: Locale): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "numeric",
    month: "short",
  })
}

/**
 * Combined cell for the Client update column.
 *
 * Renders one of two states:
 *   - Sent this week → green "Deze week verstuurd ✓" pill, blocks accidental
 *     re-send before next Monday (weekly cadence - one update per week).
 *   - Otherwise      → the Update button. Beneath either state we add a
 *     small grey "Laatste update: <date>" caption when there's a prior send,
 *     same visual treatment as the MRR / budget caption.
 */
function ClientUpdateCell({
  mondayItemId,
  clientName,
  lastUpdateAt,
  locale,
}: {
  mondayItemId: string
  clientName: string
  lastUpdateAt: string | undefined
  locale: Locale
}) {
  const sentThisWeek = isSentThisWeek(lastUpdateAt)
  const caption = lastUpdateAt ? fmtLastUpdateLabel(lastUpdateAt, locale) : ""

  return (
    <div className="leading-tight inline-flex flex-col items-center gap-0.5">
      {sentThisWeek ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {t("clients.client_update.sent_this_week", locale)}
        </span>
      ) : (
        <ClientUpdateButton mondayItemId={mondayItemId} clientName={clientName} />
      )}
      {caption && (
        <span className="text-[10px] tabular-nums text-muted-foreground/60">
          {t("clients.client_update.last", locale, { date: caption })}
        </span>
      )}
    </div>
  )
}

function SortableHead({ label, sortKey, currentKey, currentDir, onSort, className }: {
  label: React.ReactNode
  sortKey: SortKey
  currentKey: SortKey | null
  currentDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = currentKey === sortKey
  return (
    <TableHead className={className}>
      <button
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          currentDir === "asc"
            ? <ChevronUp className="h-3 w-3 text-foreground/80" />
            : <ChevronDown className="h-3 w-3 text-foreground/80" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  )
}

export function ClientsTable({ clients, boardType, billingSummaries, kpiSummaries, agreementSummaries, mondayActiveMap, lastClientUpdates, defaultSortKey, defaultSortDir, showAllToggle, dateRangeControl, onSelectClient }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()

  // Hover-prefetch for the slide-over: when the user dwells on a row for >80ms
  // we kick off /api/clients/[id] in the background under the same React Query
  // key the slide-over reads (["client-detail", id]). By the time they click,
  // the Monday round-trip (typically 500-2000ms) is in flight or already cached,
  // so the panel's content fills in much faster. The 80ms debounce keeps mouse
  // wiggles across many rows from firing one Monday call per row.
  const hoverTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const prefetchClient = useCallback(
    (clientId: string) => {
      if (hoverTimersRef.current.has(clientId)) return
      const t = setTimeout(() => {
        hoverTimersRef.current.delete(clientId)
        queryClient.prefetchQuery({
          queryKey: ["client-detail", clientId],
          queryFn: () => fetch(`/api/clients/${clientId}`).then((r) => r.json()),
          staleTime: 60 * 1000,
        })
      }, 80)
      hoverTimersRef.current.set(clientId, t)
    },
    [queryClient],
  )

  const cancelPrefetch = useCallback((clientId: string) => {
    const t = hoverTimersRef.current.get(clientId)
    if (t) {
      clearTimeout(t)
      hoverTimersRef.current.delete(clientId)
    }
  }, [])

  useEffect(() => {
    const timers = hoverTimersRef.current
    return () => {
      for (const t of timers.values()) clearTimeout(t)
      timers.clear()
    }
  }, [])
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [phaseFilter, setPhaseFilter] = useState("All")
  const [accountManagerFilter, setAccountManagerFilter] = useState("All")
  const [campaignManagerFilter, setCampaignManagerFilter] = useState("All")
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("All")
  const [healthFilter, setHealthFilter] = useState("All")
  const [sortKey, setSortKey] = useState<SortKey | null>(defaultSortKey ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir ?? "asc")
  // Per-block visibility toggles. Roy 2026-06-11 round 2: instead of a
  // single Compact / Volledig switch, each user picks which groups to
  // show. Preference saved per user via localStorage (per browser).
  // Onboarding board is unaffected - it has its own column set.
  // Defaults mirror the old Compact mode (Status + Prestaties shown,
  // Facturatie + Personen hidden) so existing muscle memory is preserved.
  const DEFAULT_GROUP_VIS: Record<GroupKey, boolean> = {
    status: true,
    invoice: false,
    people: false,
    kpi: true,
  }
  const [groupVis, setGroupVis] = useState<Record<GroupKey, boolean>>(() => {
    if (typeof window === "undefined") return DEFAULT_GROUP_VIS
    try {
      const stored = window.localStorage.getItem("clients-table-groups.v1")
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<GroupKey, boolean>>
        return { ...DEFAULT_GROUP_VIS, ...parsed }
      }
    } catch {
      // private mode / parse error - fall through to default
    }
    return DEFAULT_GROUP_VIS
  })
  const toggleGroup = useCallback((key: GroupKey) => {
    setGroupVis((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem("clients-table-groups.v1", JSON.stringify(next))
      } catch {}
      return next
    })
  }, [])
  // Onboarding board ignores the toggles - it has a different column set.
  const showStatusGroup = boardType !== "current" || groupVis.status
  const showInvoiceGroup = boardType !== "current" || groupVis.invoice
  const showPeopleGroup = boardType !== "current" || groupVis.people
  const showKpiGroup = boardType !== "current" || groupVis.kpi

  const accountManagers = useMemo(() => uniqueSorted(clients.map((c) => c.accountManager)), [clients])
  const campaignManagers = useMemo(() => uniqueSorted(clients.map((c) => c.campaignManager)), [clients])

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }, [sortKey])

  const getPaymentStatus = useCallback((client: MondayClient) => {
    if (!client.stripeCustomerId || !billingSummaries) return null
    return billingSummaries[client.stripeCustomerId] ?? null
  }, [billingSummaries])

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      const matchesSearch =
        !search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.firstName.toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === "All" ||
        mondayStatusToHub(c.campaignStatus, c.boardType) === statusFilter
      const matchesPhase =
        phaseFilter === "All" ||
        boardType !== "onboarding" ||
        mondayLabelToOnboardingPhase(c.campaignStatus) === phaseFilter
      const matchesAM = accountManagerFilter === "All" || c.accountManager === accountManagerFilter
      const matchesCM = campaignManagerFilter === "All" || c.campaignManager === campaignManagerFilter
      const matchesPayment = paymentStatusFilter === "All" || (() => {
        const summary = getPaymentStatus(c)
        if (!summary) return false
        return summary.status.toLowerCase() === paymentStatusFilter.toLowerCase()
      })()
      const matchesHealth = healthFilter === "All" || (() => {
        if (boardType !== "current") return true
        const health = getCampaignHealth(kpiSummaries?.[c.mondayItemId])
        return health.status.toLowerCase() === healthFilter.toLowerCase()
      })()
      return matchesSearch && matchesStatus && matchesPhase && matchesAM && matchesCM && matchesPayment && matchesHealth
    })
  }, [clients, search, statusFilter, phaseFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, healthFilter, boardType, kpiSummaries, getPaymentStatus])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered

    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      const kpiA = kpiSummaries?.[a.mondayItemId]
      const kpiB = kpiSummaries?.[b.mondayItemId]
      const billingA = getPaymentStatus(a)
      const billingB = getPaymentStatus(b)

      let valA: string | number = 0
      let valB: string | number = 0

      switch (sortKey) {
        case "client": valA = a.name.toLowerCase(); valB = b.name.toLowerCase(); break
        case "accountManager": valA = a.accountManager.toLowerCase(); valB = b.accountManager.toLowerCase(); break
        case "campaignManager": valA = a.campaignManager.toLowerCase(); valB = b.campaignManager.toLowerCase(); break
        case "status":
          valA = statusLabel(mondayStatusToHub(a.campaignStatus, a.boardType)).toLowerCase()
          valB = statusLabel(mondayStatusToHub(b.campaignStatus, b.boardType)).toLowerCase()
          break
        case "phase": {
          // Sort by chronological phase order, with unmapped values trailing.
          const order: Record<OnboardingPhase, number> = {
            kickoff_scheduled: 0,
            waiting_on_client: 1,
            create_campaign: 2,
            waiting_for_feedback: 3,
            launch: 4,
            on_hold: 5,
            debt_collection: 6,
          }
          const pA = mondayLabelToOnboardingPhase(a.campaignStatus)
          const pB = mondayLabelToOnboardingPhase(b.campaignStatus)
          valA = pA ? order[pA] : 99
          valB = pB ? order[pB] : 99
          break
        }
        case "kickOff": valA = a.kickOffDate; valB = b.kickOffDate; break
        case "adspend": valA = kpiA?.adSpend ?? 0; valB = kpiB?.adSpend ?? 0; break
        case "leads": valA = kpiA?.leads ?? 0; valB = kpiB?.leads ?? 0; break
        case "cpl": valA = kpiA?.cpl ?? 0; valB = kpiB?.cpl ?? 0; break
        case "cplDelta": {
          // Rows where the prev period wasn't fully live get sorted as 0 - they're
          // displayed without a delta pill anyway, so giving them a real swing
          // value here would put them where they don't belong in the ranking.
          const reliableA = kpiA?.prevPeriodReliable !== false
          const reliableB = kpiB?.prevPeriodReliable !== false
          valA = (reliableA && kpiA?.cpl && kpiA?.prevCpl) ? ((kpiA.cpl - kpiA.prevCpl) / kpiA.prevCpl) * 100 : 0
          valB = (reliableB && kpiB?.cpl && kpiB?.prevCpl) ? ((kpiB.cpl - kpiB.prevCpl) / kpiB.prevCpl) * 100 : 0
          break
        }
        case "paymentStatus": valA = billingA?.status ?? ""; valB = billingB?.status ?? ""; break
        case "overdue": {
          // Stale cache rows may lack overdueAmount; fall back to outstanding
          // when the row is "overdue" so the column still sorts meaningfully
          // until the next Stripe refresh writes the new field.
          valA = billingA?.overdueAmount ?? (billingA?.status === "overdue" ? billingA.outstanding : 0)
          valB = billingB?.overdueAmount ?? (billingB?.status === "overdue" ? billingB.outstanding : 0)
          break
        }
        case "mrr":
          valA = agreementSummaries?.[a.mondayItemId]?.mrr ?? 0
          valB = agreementSummaries?.[b.mondayItemId]?.mrr ?? 0
          break
        case "nextInvoice":
          // Sorts on the payment date (cycle start), matching the displayed
          // column. Empty dates sort to the end - ISO YYYY-MM-DD sorts naturally.
          valA = a.cycleStartDate || "9999-12-31"
          valB = b.cycleStartDate || "9999-12-31"
          break
        case "health": {
          const order: Record<string, number> = { critical: 0, warning: 1, good: 2, "no-data": 3 }
          valA = order[getCampaignHealth(kpiA).status] ?? 3
          valB = order[getCampaignHealth(kpiB).status] ?? 3
          break
        }
        case "clientUpdate": {
          // Most-recently-updated wins on desc - clients never updated sort
          // to the BOTTOM in both directions so they're never confused with
          // "oldest" entries that have a real (just very old) timestamp.
          const a0 = lastClientUpdates?.[a.mondayItemId]
          const b0 = lastClientUpdates?.[b.mondayItemId]
          if (!a0 && !b0) return 0
          if (!a0) return 1
          if (!b0) return -1
          valA = Date.parse(a0)
          valB = Date.parse(b0)
          break
        }
      }

      if (valA < valB) return -1 * dir
      if (valA > valB) return 1 * dir
      return 0
    })
  }, [filtered, sortKey, sortDir, kpiSummaries, agreementSummaries, lastClientUpdates, getPaymentStatus])

  const PAGE_SIZE = 25
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef<HTMLDivElement>(null)

  const visibleRows = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length

  // Reset visible count when filters/sort change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, statusFilter, phaseFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, healthFilter, sortKey, sortDir])

  useEffect(() => {
    const el = loaderRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sorted.length))
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [sorted.length, visibleCount])

  // colSpan = Client (1) + each visible group + Client Update (1).
  // Current board groups: Status (3) + Invoice (3) + People (3) + KPI (4).
  // Onboarding board has its own 11-column layout that doesn't toggle.
  const colSpan = boardType === "onboarding"
    ? 11
    : 1 // client name
      + (showStatusGroup ? 3 : 0)
      + (showInvoiceGroup ? 3 : 0)
      + (showPeopleGroup ? 3 : 0)
      + (showKpiGroup ? 4 : 0)
      + 1 // client update

  // Status / phase value labels stay as their Monday-canonical English form for
  // now - they're the wire format the dropdown writes back to Monday, and the
  // four buckets ("Live", "On Hold", "Churned") read fine in Dutch business
  // context. The filter LABELS and "All ..." options route through the
  // dictionary so the surrounding chrome flips.
  const filters: FilterConfig[] = [
    ...(boardType === "current"
      ? [{
          key: "status",
          label: t("clients.filter.status", locale),
          value: statusFilter,
          onChange: setStatusFilter,
          options: [
            { value: "All", label: t("clients.filter.status_all", locale) },
            ...STATUS_OPTIONS.map((s) => ({ value: s, label: t(STATUS_LABEL_KEYS[s], locale) })),
          ],
        }]
      : [{
          key: "phase",
          label: t("clients.filter.phase", locale),
          value: phaseFilter,
          onChange: setPhaseFilter,
          options: [
            { value: "All", label: t("clients.filter.phase_all", locale) },
            ...PHASE_OPTIONS.map((p) => ({ value: p, label: t(PHASE_LABEL_KEYS[p], locale) })),
          ],
        }]),
    {
      key: "am",
      label: t("clients.filter.am", locale),
      value: accountManagerFilter,
      onChange: setAccountManagerFilter,
      options: [
        { value: "All", label: t("clients.filter.am_all", locale) },
        ...accountManagers.map((s) => ({ value: s, label: s })),
      ],
    },
    {
      key: "cm",
      label: t("clients.filter.cm", locale),
      value: campaignManagerFilter,
      onChange: setCampaignManagerFilter,
      options: [
        { value: "All", label: t("clients.filter.cm_all", locale) },
        ...campaignManagers.map((s) => ({ value: s, label: s })),
      ],
    },
    {
      key: "payment",
      label: t("clients.filter.payment", locale),
      value: paymentStatusFilter,
      onChange: setPaymentStatusFilter,
      options: [
        { value: "All", label: t("clients.filter.payment_all", locale) },
        ...PAYMENT_STATUSES.map((s) => ({ value: s, label: t(PAYMENT_LABEL_KEYS[s], locale) })),
      ],
    },
    ...(boardType === "current"
      ? [{
          key: "health",
          label: t("clients.filter.health", locale),
          value: healthFilter,
          onChange: setHealthFilter,
          options: [
            { value: "All", label: t("clients.filter.health_all", locale) },
            ...HEALTH_FILTER_VALUES.map((s) => ({
              value: s,
              label:
                s === "Good" ? t("clients.health.good", locale)
                : s === "Warning" ? t("clients.health.warning", locale)
                : t("clients.health.critical", locale),
            })),
          ],
        }]
      : []),
  ]

  return (
    <div className="space-y-5">
      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          placeholder={t("clients.search_placeholder", locale)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60 h-10 border border-border bg-card rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 px-3.5 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
        />
        <FiltersPopover filters={filters} />
        {dateRangeControl && (
          <>
            <DateRangePicker
              startDate={dateRangeControl.startDate}
              endDate={dateRangeControl.endDate}
              onChange={dateRangeControl.setRange}
              maxDate={dateRangeControl.maxDate}
            />
            <div className="flex gap-1 flex-wrap">
              {dateRangeControl.presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => dateRangeControl.applyPreset(preset)}
                  className="h-8 px-2.5 text-[11px] rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        )}
        {/* Visible-of-total count - shows "{shown} van {total} klanten" when
            search / filters are narrowing the list, falls back to plain total
            otherwise. Roy 2026-06-11 v4: "showing 12 out of 20 items" naast
            de filter. */}
        {showAllToggle ? (
          <div className="ml-auto flex items-center gap-2 text-[11px] tabular-nums">
            <span className="text-muted-foreground/70">
              {sorted.length === clients.length
                ? (showAllToggle.showAll
                    ? t(clients.length === 1 ? "clients.count_total_one" : "clients.count_total_many", locale, { n: clients.length })
                    : t("clients.count_of", locale, { shown: clients.length, total: showAllToggle.totalCount }))
                : t("clients.count_of", locale, { shown: sorted.length, total: clients.length })}
            </span>
            {clients.length !== showAllToggle.totalCount || showAllToggle.showAll ? (
              <button
                type="button"
                onClick={() => showAllToggle.setShowAll(!showAllToggle.showAll)}
                className="text-primary hover:underline"
              >
                {showAllToggle.showAll ? t("clients.show_active_only", locale) : t("clients.show_all", locale)}
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground/60 ml-auto tabular-nums">
            {sorted.length === clients.length
              ? t(sorted.length === 1 ? "clients.count_total_one" : "clients.count_total_many", locale, { n: sorted.length })
              : t("clients.count_of", locale, { shown: sorted.length, total: clients.length })}
          </span>
        )}
        {boardType === "current" && (
          <div className="flex items-center gap-1" role="group" aria-label={t("clients.groups.toolbar_label", locale)}>
            {(["status", "invoice", "people", "kpi"] as GroupKey[]).map((key) => {
              const active = groupVis[key]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-pressed={active}
                  title={active
                    ? t("clients.groups.hide", locale, { name: t(GROUP_LABEL_KEYS[key], locale) })
                    : t("clients.groups.show", locale, { name: t(GROUP_LABEL_KEYS[key], locale) })}
                  className={`h-8 px-2.5 text-[11px] rounded-lg font-medium transition-colors border ${
                    active
                      ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                      : "bg-transparent text-muted-foreground/60 border-border hover:bg-muted/60 hover:text-foreground"
                  }`}
                >
                  {t(GROUP_LABEL_KEYS[key], locale)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="-mx-1">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="border-b border-border/60 bg-muted/50 hover:bg-muted/50 [&>th]:h-10">
              {/* Client section */}
              <TableHead className="w-[220px] border-r border-border/60">{t("clients.col.client", locale)}</TableHead>
              {/* Onboarding-only columns (Phase / Meta / Kick-off) - not
                  part of any toggleable group, always shown on the
                  onboarding board. */}
              {boardType === "onboarding" && (
                <>
                  <SortableHead label={t("clients.col.phase", locale)} sortKey="phase" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[150px]" />
                  <TableHead className="w-[120px]">{t("clients.col.meta", locale)}</TableHead>
                  <SortableHead label={t("clients.col.kick_off", locale)} sortKey="kickOff" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[100px]" />
                </>
              )}
              {/* Status group: Status + Health + Payment (current board) */}
              {boardType === "current" && showStatusGroup && (
                <>
                  <TableHead className="w-[100px]">{t("clients.col.status", locale)}</TableHead>
                  <SortableHead label={t("clients.col.health", locale)} sortKey="health" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-center w-[90px]" />
                  <TableHead className="w-[95px] border-r border-border/60">{t("clients.col.payment", locale)}</TableHead>
                </>
              )}
              {/* Invoice group: Overdue + MRR + Next */}
              {boardType === "current" && showInvoiceGroup && (
                <>
                  <SortableHead label={t("clients.col.overdue", locale)} sortKey="overdue" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[110px]" />
                  <SortableHead label={t("clients.col.mrr", locale)} sortKey="mrr" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[110px]" />
                  <SortableHead label={t("clients.col.next", locale)} sortKey="nextInvoice" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[80px] border-r border-border/60" />
                </>
              )}
              {/* People group: AM + CM + AS */}
              {showPeopleGroup && (
                <>
                  <TableHead className="text-center w-[50px]">{t("clients.col.am", locale)}</TableHead>
                  <TableHead className="text-center w-[50px]">{t("clients.col.cm", locale)}</TableHead>
                  <TableHead className={`text-center w-[50px] ${boardType === "current" ? "border-r border-border/60" : ""}`}>{t("clients.col.as", locale)}</TableHead>
                </>
              )}
              {/* KPI group: Ad Spend + Leads + CPL + CPL Δ (current only) */}
              {boardType === "current" && showKpiGroup && (
                <>
                  <SortableHead label={t("clients.col.adspend", locale)} sortKey="adspend" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[90px]" />
                  <SortableHead label={t("clients.col.leads", locale)} sortKey="leads" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[65px]" />
                  <SortableHead label={t("clients.col.cpl", locale)} sortKey="cpl" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="w-[80px]" />
                  <SortableHead
                    label={<span className="inline-flex items-center gap-1.5">{t("clients.col.cpl", locale)} <TrendingUpDown className="h-3.5 w-3.5 text-muted-foreground/70" /></span>}
                    sortKey="cplDelta" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}
                    className="w-[90px] border-r border-border/60"
                  />
                </>
              )}
              {/* Client update - always visible on current board (Roy:
                  not part of the KPI block). */}
              {boardType === "current" && (
                <SortableHead
                  label={t("clients.col.client_update", locale)}
                  sortKey="clientUpdate"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  className="text-center w-[140px]"
                />
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-muted-foreground">
                  {t("clients.empty", locale)}
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((client) => {
                const summary = client.stripeCustomerId ? billingSummaries?.[client.stripeCustomerId] : undefined
                const kpi = kpiSummaries?.[client.mondayItemId]
                const kpiLoading = !kpiSummaries && (!!client.metaAdAccountId || !!client.clientBoardId)
                const href = `/clients/${client.mondayItemId}`
                return (
                  <TableRow
                    key={client.mondayItemId}
                    className={`cursor-pointer row-hover border-b border-border/40 ${
                      boardType === "current" ? (() => {
                        const h = getCampaignHealth(kpi, locale)
                        if (h.status === "critical") return "border-l-2 border-l-red-500/60"
                        if (h.status === "warning") return "border-l-2 border-l-amber-500/60"
                        return ""
                      })() : ""
                    }`}
                    onClick={(e) => {
                      // Only handle plain left-click - let modifier+click and middle-click pass through
                      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
                      if (onSelectClient) {
                        onSelectClient(client.mondayItemId)
                      } else {
                        router.push(href)
                      }
                    }}
                    onMouseEnter={onSelectClient ? () => prefetchClient(client.mondayItemId) : undefined}
                    onMouseLeave={onSelectClient ? () => cancelPrefetch(client.mondayItemId) : undefined}
                    onAuxClick={(e) => {
                      // Middle-click opens in new tab - keep this even with the slide-over
                      // pattern so power users can still pop a full page in another window.
                      if (e.button === 1) {
                        e.preventDefault()
                        window.open(href, "_blank", "noopener,noreferrer")
                      }
                    }}
                  >
                    {/* Client section */}
                    <TableCell className="border-r border-border/40 bg-muted/20 max-w-0">
                      {onSelectClient ? (
                        // In slide-over mode, the row click handles selection - render
                        // the name as plain text so we don't have a Link competing with
                        // the row's onClick.
                        <div className="block min-w-0" title={client.name}>
                          <p className="font-medium text-sm truncate">{client.name}</p>
                          {client.firstName && (
                            <p className="text-[11px] text-muted-foreground/60 truncate">{client.firstName}</p>
                          )}
                        </div>
                      ) : (
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="block hover:text-primary transition-colors min-w-0"
                          title={client.name}
                        >
                          <p className="font-medium text-sm truncate">{client.name}</p>
                          {client.firstName && (
                            <p className="text-[11px] text-muted-foreground/60 truncate">{client.firstName}</p>
                          )}
                        </Link>
                      )}
                    </TableCell>
                    {/* Onboarding-only cells (Phase / Meta / Kick-off) */}
                    {boardType === "onboarding" && (
                      <>
                        <TableCell>
                          <PhaseEditCell
                            mondayItemId={client.mondayItemId}
                            rawLabel={client.campaignStatus}
                          />
                        </TableCell>
                        <TableCell>
                          {client.metaConnected ? (
                            <StLabel tone={metaConnectedToneKey(client.metaConnected)} label={client.metaConnected} />
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">{client.kickOffDate || ""}</TableCell>
                      </>
                    )}
                    {/* Status group: Status + Health + Payment (current board) */}
                    {boardType === "current" && showStatusGroup && (
                      <>
                        <TableCell>
                          <StatusEditCell
                            mondayItemId={client.mondayItemId}
                            status={mondayStatusToHub(client.campaignStatus, client.boardType)}
                            readOnly={client.boardType === "onboarding"}
                          />
                        </TableCell>
                        <TableCell>
                          {kpiLoading ? (
                            <span className="text-muted-foreground/40 text-xs">...</span>
                          ) : (
                            <HealthBadge health={getCampaignHealth(kpi, locale)} locale={locale} />
                          )}
                        </TableCell>
                        <TableCell className="border-r border-border/40">
                          {billingSummaries && summary && PAYMENT_TONE_KEYS[summary.status] && (
                            <StLabel
                              tone={PAYMENT_TONE_KEYS[summary.status]}
                              label={t(PAYMENT_LABEL_KEYS[summary.status.charAt(0).toUpperCase() + summary.status.slice(1)], locale)}
                            />
                          )}
                          {!billingSummaries && client.stripeCustomerId && (
                            <span className="text-muted-foreground/40 text-xs">...</span>
                          )}
                        </TableCell>
                      </>
                    )}
                    {/* Invoice group: Overdue + MRR + Next */}
                    {showInvoiceGroup && (
                      <>
                        <TableCell className="text-xs tabular-nums">
                          {(() => {
                            if (!billingSummaries && client.stripeCustomerId) {
                              return <span className="text-muted-foreground/40">...</span>
                            }
                            if (!summary || summary.outstanding <= 0) return null
                            // Stale cache fallback: rows written before the
                            // overdueAmount field existed only carry the
                            // boolean `status: "overdue"` + total `outstanding`.
                            // Treat the whole outstanding as overdue then so
                            // the column doesn't silently flip to 0 until the
                            // next refresh-stripe cron rewrites the entry.
                            const overdue =
                              summary.overdueAmount ??
                              (summary.status === "overdue" ? summary.outstanding : 0)
                            // MRR-style stacked cell: red bold overdue amount
                            // on top, total outstanding (muted) below so the
                            // AM can read "€1.5k overdue of €3k total" in one
                            // glance without a second column.
                            return (
                              <div className="leading-tight">
                                <p className="text-xs tabular-nums font-medium text-red-400">
                                  {fmt(overdue)}
                                </p>
                                <p className="text-[10px] tabular-nums text-muted-foreground/60">
                                  {t("clients.overdue.of", locale, { total: fmt(summary.outstanding) })}
                                </p>
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const a = agreementSummaries?.[client.mondayItemId]
                            if (!agreementSummaries) {
                              return <span className="text-muted-foreground/40 text-xs">...</span>
                            }
                            if (!a || (a.mrr === 0 && a.adBudget === 0)) {
                              return null
                            }
                            return (
                              <div className="leading-tight">
                                <p className="text-xs tabular-nums font-medium">{formatCurrencyLocale(a.mrr, locale)}</p>
                                <p className="text-[10px] tabular-nums text-muted-foreground/60">
                                  {formatCurrencyLocale(a.adBudget, locale)} {t("clients.budget_suffix", locale)}
                                </p>
                              </div>
                            )
                          })()}
                        </TableCell>
                        <TableCell className="border-r border-border/40">
                          {/* Payment date (cycle start) - the client-facing "next
                              payment" date, consistent with the Billing surfaces.
                              The invoice-out date (−7d) is a finance-ops detail
                              that lives on the Billing page, not here. */}
                          {client.cycleStartDate ? (
                            <span
                              className={`text-xs tabular-nums ${
                                client.cycleStartDate <= todayIso()
                                  ? "text-amber-500 font-medium"
                                  : "text-muted-foreground"
                              }`}
                              title={t("clients.tooltip.next_invoice", locale)}
                            >
                              {fmtDate(client.cycleStartDate)}
                            </span>
                          ) : null}
                        </TableCell>
                      </>
                    )}
                    {/* People group: AM + CM + AS */}
                    {showPeopleGroup && (
                      <>
                        <TableCell>
                          <PersonEditCell
                            mondayItemId={client.mondayItemId}
                            fieldKey="account_manager"
                            value={client.accountManager}
                          />
                        </TableCell>
                        <TableCell>
                          <PersonEditCell
                            mondayItemId={client.mondayItemId}
                            fieldKey="campaign_manager"
                            value={client.campaignManager}
                          />
                        </TableCell>
                        <TableCell className={boardType === "current" ? "border-r border-border/40" : ""}>
                          {boardType === "current" ? (
                            <PersonEditCell
                              mondayItemId={client.mondayItemId}
                              fieldKey="appointment_setter"
                              value={client.appointmentSetter}
                              multi
                            />
                          ) : (
                            client.appointmentSetter && (
                              <span className="text-xs text-muted-foreground">{client.appointmentSetter}</span>
                            )
                          )}
                        </TableCell>
                      </>
                    )}
                    {/* KPI group: Ad Spend + Leads + CPL + CPL Δ */}
                    {boardType === "current" && showKpiGroup && (
                      <>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.adSpend > 0 ? fmtKpi(kpi.adSpend, "currency") : ""}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums font-medium">
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.leads > 0 ? fmtKpi(kpi.leads, "integer") : ""}
                        </TableCell>
                        <TableCell className={`text-xs tabular-nums font-medium ${kpi && kpi.cpl > 50 ? "text-red-400" : kpi && kpi.cpl > 30 ? "text-amber-400" : ""}`}>
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.cpl > 0 ? fmtKpi(kpi.cpl, "currency") : ""}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums border-r border-border/40">
                          {kpiLoading ? (
                            <span className="text-muted-foreground/40">...</span>
                          ) : kpi && kpi.cpl > 0 && kpi.prevCpl > 0 && kpi.prevPeriodReliable !== false ? (
                            <DeltaPill pct={((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100} />
                          ) : kpi && kpi.cpl > 0 && kpi.prevPeriodReliable === false ? (
                            <span
                              className="text-muted-foreground/40"
                              title={t("clients.tooltip.no_prev_period", locale)}
                            >
                              -
                            </span>
                          ) : ""}
                        </TableCell>
                      </>
                    )}
                    {/* Client update - always visible on current board */}
                    {boardType === "current" && (
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <ClientUpdateCell
                          mondayItemId={client.mondayItemId}
                          clientName={client.companyName || client.name}
                          lastUpdateAt={lastClientUpdates?.[client.mondayItemId]}
                          locale={locale}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div ref={loaderRef} className="flex justify-center py-4">
          <span className="text-xs text-muted-foreground">{t("clients.loading_more", locale)}</span>
        </div>
      )}
    </div>
  )
}
