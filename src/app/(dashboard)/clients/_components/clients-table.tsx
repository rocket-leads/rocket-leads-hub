"use client"

import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
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
import type { MondayClient } from "@/lib/monday"
import type { BillingSummary } from "@/lib/stripe-client"
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

type SortKey = "client" | "accountManager" | "campaignManager" | "status" | "kickOff" | "adspend" | "leads" | "cpl" | "appointments" | "cpa" | "paymentStatus" | "outstanding"
type SortDir = "asc" | "desc"

type Props = {
  clients: MondayClient[]
  boardType: "onboarding" | "current"
  billingSummaries?: Record<string, BillingSummary>
  kpiSummaries?: Record<string, KpiSummary>
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

export function ClientsTable({ clients, boardType, billingSummaries, kpiSummaries }: Props) {
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")
  const [accountManagerFilter, setAccountManagerFilter] = useState("All")
  const [campaignManagerFilter, setCampaignManagerFilter] = useState("All")
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("All")
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
      return matchesSearch && matchesStatus && matchesAM && matchesCM && matchesPayment
    })
  }, [clients, search, statusFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, getPaymentStatus])

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
        case "appointments": valA = kpiA?.appointments ?? 0; valB = kpiB?.appointments ?? 0; break
        case "cpa": valA = kpiA?.costPerAppointment ?? 0; valB = kpiB?.costPerAppointment ?? 0; break
        case "paymentStatus": valA = billingA?.status ?? ""; valB = billingB?.status ?? ""; break
        case "outstanding": valA = billingA?.outstanding ?? 0; valB = billingB?.outstanding ?? 0; break
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
  }, [search, statusFilter, accountManagerFilter, campaignManagerFilter, paymentStatusFilter, sortKey, sortDir])

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

  const colSpan = boardType === "onboarding" ? 8 : 12

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Search clients..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "All")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue>{statusFilter === "All" ? "Campaign Status" : statusFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountManagerFilter} onValueChange={(v) => setAccountManagerFilter(v ?? "All")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue>{accountManagerFilter === "All" ? "Account Manager" : accountManagerFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Account Managers</SelectItem>
            {accountManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={campaignManagerFilter} onValueChange={(v) => setCampaignManagerFilter(v ?? "All")}>
          <SelectTrigger className="w-[190px]">
            <SelectValue>{campaignManagerFilter === "All" ? "Campaign Manager" : campaignManagerFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Campaign Managers</SelectItem>
            {campaignManagers.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={paymentStatusFilter} onValueChange={(v) => setPaymentStatusFilter(v ?? "All")}>
          <SelectTrigger className="w-[170px]">
            <SelectValue>{paymentStatusFilter === "All" ? "Payment Status" : paymentStatusFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Payment Statuses</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="flex items-center text-sm text-muted-foreground">
          {sorted.length} client{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: "#DADEE7", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Account Manager</TableHead>
              <TableHead className="text-center">Campaign Manager</TableHead>
              <TableHead className="text-center">Appointment Setter</TableHead>
              {boardType === "onboarding" && (
                <SortableHead label="Kick-off Date" sortKey="kickOff" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              )}
              <TableHead>Payment Status</TableHead>
              <TableHead>Outstanding</TableHead>
              {boardType === "current" && (
                <>
                  <SortableHead label="Adspend" sortKey="adspend" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableHead label="Leads" sortKey="leads" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableHead label="CPL" sortKey="cpl" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableHead label="Appointments" sortKey="appointments" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
                  <SortableHead label="CPA" sortKey="cpa" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} className="text-right" />
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
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/clients/${client.mondayItemId}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{client.name}</p>
                        {client.firstName && (
                          <p className="text-sm text-muted-foreground">{client.firstName}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {client.campaignStatus ? (
                        <Badge variant="outline" className={STATUS_COLORS[client.campaignStatus] ?? ""}>
                          {client.campaignStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell><ManagerAvatar name={client.accountManager} /></TableCell>
                    <TableCell><ManagerAvatar name={client.campaignManager} /></TableCell>
                    <TableCell>{client.appointmentSetter ? <ManagerAvatar name={client.appointmentSetter} /> : null}</TableCell>
                    {boardType === "onboarding" && (
                      <TableCell className="text-sm tabular-nums">{client.kickOffDate || "—"}</TableCell>
                    )}
                    <TableCell>
                      {!client.stripeCustomerId ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : !billingSummaries ? (
                        <span className="text-muted-foreground text-sm">...</span>
                      ) : summary ? (
                        <Badge variant="outline" className={PAYMENT_STATUS_COLORS[summary.status]}>
                          {summary.status.charAt(0).toUpperCase() + summary.status.slice(1)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {!client.stripeCustomerId ? (
                        <span className="text-muted-foreground">—</span>
                      ) : !billingSummaries ? (
                        <span className="text-muted-foreground">...</span>
                      ) : summary && summary.outstanding > 0 ? (
                        <span className={summary.status === "overdue" ? "text-red-400" : ""}>{fmt(summary.outstanding)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {boardType === "current" && (
                      <>
                        <TableCell className="text-sm text-right tabular-nums">
                          {kpiLoading ? "..." : kpi ? fmtKpi(kpi.adSpend, "currency") : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {kpiLoading ? "..." : kpi ? fmtKpi(kpi.leads, "integer") : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {kpiLoading ? "..." : kpi ? fmtKpi(kpi.cpl, "currency") : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {kpiLoading ? "..." : kpi ? fmtKpi(kpi.appointments, "integer") : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-right tabular-nums">
                          {kpiLoading ? "..." : kpi ? fmtKpi(kpi.costPerAppointment, "currency") : "—"}
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
