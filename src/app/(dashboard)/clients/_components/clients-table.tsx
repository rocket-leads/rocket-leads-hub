"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

const ONBOARDING_STATUSES = ["Kick off", "In development", "On hold"]
const CURRENT_STATUSES = ["Live", "On hold", "Churned"]

const STATUS_COLORS: Record<string, string> = {
  "Kick off": "bg-blue-50 text-blue-600 border-blue-100",
  "In development": "bg-amber-50 text-amber-600 border-amber-100",
  "On hold": "bg-gray-100 text-gray-500 border-gray-200",
  Live: "bg-green-50 text-green-600 border-green-100",
  Churned: "bg-red-50 text-red-500 border-red-100",
}

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  complete: "bg-green-50 text-green-600 border-green-100",
  open: "bg-amber-50 text-amber-600 border-amber-100",
  overdue: "bg-red-50 text-red-500 border-red-100",
}

const PAYMENT_STATUSES = ["Complete", "Open", "Overdue"]

// --- Campaign Health ---
type HealthStatus = "critical" | "warning" | "good" | "no-data"

type HealthResult = {
  status: HealthStatus
  reasons: string[]
}

function getCampaignHealth(kpi: KpiSummary | undefined): HealthResult {
  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { status: "no-data", reasons: ["No campaign data available"] }
  }

  const reasons: string[] = []
  let status: HealthStatus = "good"

  // Trend-based: compare current 7d CPL vs previous 7d CPL
  if (kpi.cpl > 0 && kpi.prevCpl > 0) {
    const cplChange = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100

    if (cplChange > 50) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} — up ${cplChange.toFixed(0)}% vs prev 7d (€${kpi.prevCpl.toFixed(2)})`)
      status = "critical"
    } else if (cplChange > 25) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} — up ${cplChange.toFixed(0)}% vs prev 7d (€${kpi.prevCpl.toFixed(2)})`)
      status = "warning"
    } else if (cplChange < -10) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} — down ${Math.abs(cplChange).toFixed(0)}% vs prev 7d`)
    } else {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} — stable vs prev 7d`)
    }
  }

  // Spend with zero leads = always critical
  if (kpi.adSpend > 50 && kpi.leads === 0) {
    reasons.push(`€${kpi.adSpend.toFixed(0)} spent with 0 leads`)
    status = "critical"
  }

  // CPA trend (when available)
  if (kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0) {
    const cpaChange = ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
    if (cpaChange > 50) {
      reasons.push(`CPA €${kpi.costPerAppointment.toFixed(0)} — up ${cpaChange.toFixed(0)}% vs prev 7d`)
      if (status !== "critical") status = "critical"
    } else if (cpaChange > 25) {
      reasons.push(`CPA €${kpi.costPerAppointment.toFixed(0)} — up ${cpaChange.toFixed(0)}% vs prev 7d`)
      if (status === "good") status = "warning"
    }
  }

  // Good summary
  if (status === "good" && reasons.length === 0) {
    if (kpi.leads > 0) {
      reasons.push(`CPL €${kpi.cpl.toFixed(2)} — ${kpi.leads} leads`)
    } else {
      reasons.push("Campaign running normally")
    }
  }

  return { status, reasons }
}

const HEALTH_STYLES: Record<HealthStatus, { dot: string; bg: string; text: string; label: string }> = {
  critical: { dot: "bg-red-500", bg: "bg-red-50", text: "text-red-600", label: "Critical" },
  warning: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-600", label: "Warning" },
  good: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-600", label: "Good" },
  "no-data": { dot: "bg-gray-300", bg: "bg-gray-50", text: "text-gray-400", label: "—" },
}

const HEALTH_FILTER_OPTIONS = ["Good", "Warning", "Critical"]

function HealthBadge({ health }: { health: HealthResult }) {
  const style = HEALTH_STYLES[health.status]
  if (health.status === "no-data") {
    return <span className="text-muted-foreground text-sm">—</span>
  }
  return (
    <div className="relative group">
      <div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${style.bg} ${style.text}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {style.label}
      </div>
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

type SortKey = "client" | "accountManager" | "campaignManager" | "status" | "kickOff" | "adspend" | "leads" | "cpl" | "cplDelta" | "appointments" | "cpa" | "cpaDelta" | "paymentStatus" | "outstanding" | "health"
type SortDir = "asc" | "desc"

type Props = {
  clients: MondayClient[]
  boardType: "onboarding" | "current"
  billingSummaries?: Record<string, BillingSummary>
  kpiSummaries?: Record<string, KpiSummary>
  mondayActiveMap?: Record<string, boolean>
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function fmt(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtKpi(value: number, type: "currency" | "integer"): string {
  if (type === "currency") return `€${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return value.toLocaleString("en-GB")
}

const SKIP_PARTS = new Set(["van", "de", "der", "den", "het", "het", "ten", "ter"])

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return ""
  const first = parts[0][0]?.toUpperCase() ?? ""
  const lastPart = parts.findLast((p) => !SKIP_PARTS.has(p.toLowerCase()) && p !== parts[0])
  const last = lastPart?.[0]?.toUpperCase() ?? ""
  return first + last
}

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
  "bg-amber-100 text-amber-700",
  "bg-rose-100 text-rose-700",
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-orange-100 text-orange-700",
]

function avatarColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function ManagerAvatar({ name }: { name: string }) {
  if (!name) return <span className="text-muted-foreground">—</span>
  const initials = getInitials(name)
  return (
    <div className="flex justify-center" title={name}>
      <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(name)}`}>
        {initials}
      </span>
    </div>
  )
}

function SortableHead({ label, sortKey, currentKey, currentDir, onSort, className }: {
  label: string
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
        className="flex items-center gap-1 hover:text-foreground transition-colors"
        onClick={() => onSort(sortKey)}
      >
        {label}
        {active ? (
          currentDir === "asc"
            ? <ArrowUp className="h-2.5 w-2.5 text-gray-500" />
            : <ArrowDown className="h-2.5 w-2.5 text-gray-500" />
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 text-gray-400" />
        )}
      </button>
    </TableHead>
  )
}

export function ClientsTable({ clients, boardType, billingSummaries, kpiSummaries, mondayActiveMap }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [accountManagerFilter, setAccountManagerFilter] = useState("All")
  const [campaignManagerFilter, setCampaignManagerFilter] = useState("All")
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("All")
  const [healthFilter, setHealthFilter] = useState("All")
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const statuses = boardType === "onboarding" ? ONBOARDING_STATUSES : CURRENT_STATUSES
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
      const matchesStatus = statusFilter === "All" || c.campaignStatus === statusFilter
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
      return matchesSearch && matchesStatus && matchesAM && matchesCM && matchesPayment && matchesHealth
    })
  }, [clients, search, statusFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, healthFilter, boardType, kpiSummaries, getPaymentStatus])

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
        case "status": valA = a.campaignStatus.toLowerCase(); valB = b.campaignStatus.toLowerCase(); break
        case "kickOff": valA = a.kickOffDate; valB = b.kickOffDate; break
        case "adspend": valA = kpiA?.adSpend ?? 0; valB = kpiB?.adSpend ?? 0; break
        case "leads": valA = kpiA?.leads ?? 0; valB = kpiB?.leads ?? 0; break
        case "cpl": valA = kpiA?.cpl ?? 0; valB = kpiB?.cpl ?? 0; break
        case "cplDelta": {
          valA = (kpiA?.cpl && kpiA?.prevCpl) ? ((kpiA.cpl - kpiA.prevCpl) / kpiA.prevCpl) * 100 : 0
          valB = (kpiB?.cpl && kpiB?.prevCpl) ? ((kpiB.cpl - kpiB.prevCpl) / kpiB.prevCpl) * 100 : 0
          break
        }
        case "appointments": valA = kpiA?.appointments ?? 0; valB = kpiB?.appointments ?? 0; break
        case "cpa": valA = kpiA?.costPerAppointment ?? 0; valB = kpiB?.costPerAppointment ?? 0; break
        case "cpaDelta": {
          valA = (kpiA?.costPerAppointment && kpiA?.prevCostPerAppointment) ? ((kpiA.costPerAppointment - kpiA.prevCostPerAppointment) / kpiA.prevCostPerAppointment) * 100 : 0
          valB = (kpiB?.costPerAppointment && kpiB?.prevCostPerAppointment) ? ((kpiB.costPerAppointment - kpiB.prevCostPerAppointment) / kpiB.prevCostPerAppointment) * 100 : 0
          break
        }
        case "paymentStatus": valA = billingA?.status ?? ""; valB = billingB?.status ?? ""; break
        case "outstanding": valA = billingA?.outstanding ?? 0; valB = billingB?.outstanding ?? 0; break
        case "health": {
          const order: Record<string, number> = { critical: 0, warning: 1, good: 2, "no-data": 3 }
          valA = order[getCampaignHealth(kpiA).status] ?? 3
          valB = order[getCampaignHealth(kpiB).status] ?? 3
          break
        }
      }

      if (valA < valB) return -1 * dir
      if (valA > valB) return 1 * dir
      return 0
    })
  }, [filtered, sortKey, sortDir, kpiSummaries, getPaymentStatus])

  const PAGE_SIZE = 25
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef<HTMLDivElement>(null)

  const visibleRows = sorted.slice(0, visibleCount)
  const hasMore = visibleCount < sorted.length

  // Reset visible count when filters/sort change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [search, statusFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, healthFilter, sortKey, sortDir])

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

  const colSpan = boardType === "onboarding" ? 8 : 15

  const filterTriggerClass = "!h-8 !border-0 !bg-muted/40 hover:!bg-muted !rounded-lg !text-xs !px-3 !shadow-none dark:!bg-white/5 dark:hover:!bg-white/10"
  const activeFilterClass = "!bg-primary/10 !text-primary dark:!bg-primary/15 dark:!text-primary"

  return (
    <div className="space-y-5">
      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-52 h-8 border-0 bg-muted/40 dark:bg-white/5 rounded-lg text-xs text-foreground placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 px-3"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "All")}>
          <SelectTrigger className={`${filterTriggerClass} ${statusFilter !== "All" ? activeFilterClass : ""}`}>
            <SelectValue>{statusFilter === "All" ? "Status" : statusFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountManagerFilter} onValueChange={(v) => setAccountManagerFilter(v ?? "All")}>
          <SelectTrigger className={`${filterTriggerClass} ${accountManagerFilter !== "All" ? activeFilterClass : ""}`}>
            <SelectValue>{accountManagerFilter === "All" ? "AM" : accountManagerFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Account Managers</SelectItem>
            {accountManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campaignManagerFilter} onValueChange={(v) => setCampaignManagerFilter(v ?? "All")}>
          <SelectTrigger className={`${filterTriggerClass} ${campaignManagerFilter !== "All" ? activeFilterClass : ""}`}>
            <SelectValue>{campaignManagerFilter === "All" ? "CM" : campaignManagerFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Campaign Managers</SelectItem>
            {campaignManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentStatusFilter} onValueChange={(v) => setPaymentStatusFilter(v ?? "All")}>
          <SelectTrigger className={`${filterTriggerClass} ${paymentStatusFilter !== "All" ? activeFilterClass : ""}`}>
            <SelectValue>{paymentStatusFilter === "All" ? "Payment" : paymentStatusFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Payment Statuses</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {boardType === "current" && (
          <Select value={healthFilter} onValueChange={(v) => setHealthFilter(v ?? "All")}>
            <SelectTrigger className={`${filterTriggerClass} ${healthFilter !== "All" ? activeFilterClass : ""}`}>
              <SelectValue>{healthFilter === "All" ? "Health" : healthFilter}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Health Statuses</SelectItem>
              {HEALTH_FILTER_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-[11px] text-muted-foreground/60 ml-1">
          {sorted.length} client{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/30 overflow-hidden">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow className="border-b border-border/30 hover:bg-transparent">
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium w-[220px]">Client</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium w-[100px]">Status</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-center w-[50px]">AM</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-center w-[50px]">CM</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-center w-[50px]">AS</TableHead>
              {boardType === "onboarding" && (
                <SortableHead label="Kick-off" sortKey="kickOff" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium w-[100px]" />
              )}
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium w-[95px]">Payment</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium w-[100px]">Outstanding</TableHead>
              {boardType === "current" && (
                <>
                  <SortableHead label="Health" sortKey="health" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-center w-[90px]" />
                  <SortableHead label="Adspend" sortKey="adspend" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[90px]" />
                  <SortableHead label="Leads" sortKey="leads" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[65px]" />
                  <SortableHead label="CPL" sortKey="cpl" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[80px]" />
                  <SortableHead label="CPL % 7d" sortKey="cplDelta" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[85px]" />
                  <SortableHead label="Appts" sortKey="appointments" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[65px]" />
                  <SortableHead label="CPA" sortKey="cpa" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[80px]" />
                  <SortableHead label="CPA % 7d" sortKey="cpaDelta" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-[11px] uppercase tracking-wider text-muted-foreground/60 font-medium text-right w-[85px]" />
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colSpan} className="text-center py-12 text-muted-foreground">
                  No clients found
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((client) => {
                const summary = client.stripeCustomerId ? billingSummaries?.[client.stripeCustomerId] : undefined
                const kpi = kpiSummaries?.[client.mondayItemId]
                const kpiLoading = !kpiSummaries && (!!client.metaAdAccountId || !!client.clientBoardId)
                return (
                  <TableRow
                    key={client.mondayItemId}
                    className="cursor-pointer row-hover border-b border-border/20"
                    onClick={() => router.push(`/clients/${client.mondayItemId}`)}
                  >
                    <TableCell>
                      <p className="font-medium text-sm">{client.name}</p>
                      {client.firstName && (
                        <p className="text-[11px] text-muted-foreground/60">{client.firstName}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {client.campaignStatus && (
                        <Badge variant="outline" className={STATUS_COLORS[client.campaignStatus] ?? ""}>
                          {client.campaignStatus}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{client.accountManager && <ManagerAvatar name={client.accountManager} />}</TableCell>
                    <TableCell>{client.campaignManager && <ManagerAvatar name={client.campaignManager} />}</TableCell>
                    <TableCell>{client.appointmentSetter && <ManagerAvatar name={client.appointmentSetter} />}</TableCell>
                    {boardType === "onboarding" && (
                      <TableCell className="text-xs text-muted-foreground tabular-nums">{client.kickOffDate || ""}</TableCell>
                    )}
                    <TableCell>
                      {billingSummaries && summary && (
                        <Badge variant="outline" className={PAYMENT_STATUS_COLORS[summary.status]}>
                          {summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}
                        </Badge>
                      )}
                      {!billingSummaries && client.stripeCustomerId && (
                        <span className="text-muted-foreground/40 text-xs">...</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {summary && summary.outstanding > 0 && (
                        <span className={summary.status === "overdue" ? "text-red-400 font-medium" : "text-muted-foreground"}>{fmt(summary.outstanding)}</span>
                      )}
                      {!billingSummaries && client.stripeCustomerId && (
                        <span className="text-muted-foreground/40">...</span>
                      )}
                    </TableCell>
                    {boardType === "current" && (
                      <>
                        <TableCell>
                          {kpiLoading ? (
                            <span className="text-muted-foreground/40 text-xs">...</span>
                          ) : (
                            <HealthBadge health={getCampaignHealth(kpi)} />
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums text-muted-foreground">
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.adSpend > 0 ? fmtKpi(kpi.adSpend, "currency") : ""}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.leads > 0 ? fmtKpi(kpi.leads, "integer") : ""}
                        </TableCell>
                        <TableCell className={`text-xs text-right tabular-nums font-medium ${kpi && kpi.cpl > 50 ? "text-red-400" : kpi && kpi.cpl > 30 ? "text-amber-400" : ""}`}>
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.cpl > 0 ? fmtKpi(kpi.cpl, "currency") : ""}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {kpiLoading ? (
                            <span className="text-muted-foreground/40">...</span>
                          ) : kpi && kpi.cpl > 0 && kpi.prevCpl > 0 ? (() => {
                            const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
                            return (
                              <span className={pct < 0 ? "text-green-500" : pct >= 25 ? "text-red-400" : pct > 0 ? "text-amber-400" : "text-muted-foreground"}>
                                {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                              </span>
                            )
                          })() : ""}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums font-medium">
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.appointments > 0 ? fmtKpi(kpi.appointments, "integer") : ""}
                        </TableCell>
                        <TableCell className={`text-xs text-right tabular-nums ${kpi && kpi.costPerAppointment > 200 ? "text-red-400" : ""}`}>
                          {kpiLoading ? <span className="text-muted-foreground/40">...</span> : kpi && kpi.costPerAppointment > 0 ? fmtKpi(kpi.costPerAppointment, "currency") : ""}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {kpiLoading ? (
                            <span className="text-muted-foreground/40">...</span>
                          ) : kpi && kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0 ? (() => {
                            const pct = ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
                            return (
                              <span className={pct < 0 ? "text-green-500" : pct >= 25 ? "text-red-400" : pct > 0 ? "text-amber-400" : "text-muted-foreground"}>
                                {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                              </span>
                            )
                          })() : ""}
                        </TableCell>
                      </>
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
          <span className="text-xs text-muted-foreground">Loading more...</span>
        </div>
      )}
    </div>
  )
}
