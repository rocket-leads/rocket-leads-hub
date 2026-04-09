"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RefreshCw, AlertCircle, TrendingUp, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Sparkles } from "lucide-react"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

type WatchCategory = "action" | "watch" | "good" | "no-data"

type CategorizedClient = {
  client: MondayClient
  category: WatchCategory
  issue: string
  kpi: KpiSummary | undefined
}

function categorize(client: MondayClient, kpi: KpiSummary | undefined): { category: WatchCategory; issue: string } {
  if (!kpi || (kpi.adSpend === 0 && kpi.leads === 0)) {
    return { category: "no-data", issue: "No campaign data" }
  }

  if (kpi.adSpend > 50 && kpi.leads === 0) {
    return { category: "action", issue: `0 leads — €${kpi.adSpend.toFixed(0)} spent` }
  }

  if (kpi.cpl > 0 && kpi.prevCpl > 0) {
    const cplChange = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
    if (cplChange >= 30) return { category: "action", issue: `CPL +${cplChange.toFixed(0)}%` }
    if (cplChange >= 10) return { category: "watch", issue: `CPL +${cplChange.toFixed(0)}%` }
  }

  if (kpi.costPerAppointment > 0 && kpi.prevCostPerAppointment > 0) {
    const cpaChange = ((kpi.costPerAppointment - kpi.prevCostPerAppointment) / kpi.prevCostPerAppointment) * 100
    if (cpaChange >= 30) return { category: "action", issue: `CPA +${cpaChange.toFixed(0)}%` }
    if (cpaChange >= 10) return { category: "watch", issue: `CPA +${cpaChange.toFixed(0)}%` }
  }

  if (kpi.leads > 0) {
    const parts: string[] = []
    if (kpi.cpl > 0 && kpi.prevCpl > 0) {
      const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
      parts.push(`CPL ${pct > 0 ? "+" : ""}${pct.toFixed(0)}%`)
    }
    parts.push(`${kpi.leads} leads`)
    return { category: "good", issue: parts.join(" · ") }
  }

  return { category: "good", issue: "Stable" }
}

function fmtCurrency(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`
  return `€${v.toFixed(0)}`
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

const CATEGORY_CONFIG = {
  action: {
    label: "Action Needed",
    icon: AlertCircle,
    dotColor: "bg-red-500",
    iconColor: "text-red-500",
    headerBg: "bg-red-500/5 border-red-500/20",
    rowBorder: "border-l-red-500/60",
    issueColor: "text-red-400",
  },
  watch: {
    label: "Watch List",
    icon: TrendingUp,
    dotColor: "bg-amber-500",
    iconColor: "text-amber-500",
    headerBg: "bg-amber-500/5 border-amber-500/20",
    rowBorder: "border-l-amber-500/60",
    issueColor: "text-amber-400",
  },
  good: {
    label: "Good Performance",
    icon: CheckCircle2,
    dotColor: "bg-green-500",
    iconColor: "text-green-500",
    headerBg: "bg-green-500/5 border-green-500/20",
    rowBorder: "border-l-green-500/60",
    issueColor: "text-green-500",
  },
} as const

function WatchSection({
  category,
  items,
  aiNotes,
  onNavigate,
  defaultOpen,
}: {
  category: "action" | "watch" | "good"
  items: CategorizedClient[]
  aiNotes: Record<string, string>
  onNavigate: (id: string) => void
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const config = CATEGORY_CONFIG[category]
  const Icon = config.icon

  if (items.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border ${config.headerBg} mb-2 transition-colors hover:opacity-80`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <Icon className={`h-4 w-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{config.label}</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[200px_100px_1fr_70px_55px_65px_55px_28px] gap-0 px-4 py-2 border-b border-border/20 bg-muted/20">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Client</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium">Issue</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5 text-violet-500" /> AI Note
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Spend</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Leads</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">CPL</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium text-right">Appts</span>
            <span />
          </div>

          {/* Rows */}
          {items.map(({ client, issue, kpi }) => {
            const note = aiNotes[client.mondayItemId]

            return (
              <div
                key={client.mondayItemId}
                className={`grid grid-cols-[200px_100px_1fr_70px_55px_65px_55px_28px] gap-0 px-4 py-2.5 border-b border-border/10 border-l-2 ${config.rowBorder} cursor-pointer hover:bg-muted/30 transition-colors items-center`}
                onClick={() => onNavigate(client.mondayItemId)}
              >
                {/* Client */}
                <div className="min-w-0 pr-2">
                  <span className="text-sm font-medium truncate block">{client.name}</span>
                  <span className="text-[10px] text-muted-foreground/40 truncate block">
                    {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                  </span>
                </div>

                {/* Issue */}
                <span className={`text-xs font-medium ${config.issueColor}`}>{issue}</span>

                {/* AI Note */}
                <div className="min-w-0 pr-3">
                  {note ? (
                    <p className="text-[11px] text-muted-foreground leading-snug truncate" title={note}>{note}</p>
                  ) : (
                    <span className="text-[11px] text-muted-foreground/30 italic">Generating...</span>
                  )}
                </div>

                {/* Spend */}
                <span className="text-xs tabular-nums text-muted-foreground text-right">
                  {kpi && kpi.adSpend > 0 ? fmtCurrency(kpi.adSpend) : "—"}
                </span>

                {/* Leads */}
                <span className="text-xs tabular-nums font-medium text-right">
                  {kpi && kpi.leads > 0 ? kpi.leads : kpi && kpi.adSpend > 0 ? "0" : "—"}
                </span>

                {/* CPL */}
                <span className="text-xs tabular-nums text-muted-foreground text-right">
                  {kpi && kpi.cpl > 0 ? `€${kpi.cpl.toFixed(2)}` : "—"}
                </span>

                {/* Appointments */}
                <span className="text-xs tabular-nums text-muted-foreground text-right">
                  {kpi && kpi.appointments > 0 ? kpi.appointments : "—"}
                </span>

                {/* Link */}
                <button
                  onClick={(e) => { e.stopPropagation(); onNavigate(client.mondayItemId) }}
                  className="text-muted-foreground/30 hover:text-primary transition-colors flex justify-center"
                  title="View client"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- Main Dashboard ---

type Props = {
  clients: MondayClient[]
  userName: string
}

export function WatchListDashboard({ clients, userName }: Props) {
  const router = useRouter()
  const [cmFilter, setCmFilter] = useState("All")
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [aiNotes, setAiNotes] = useState<Record<string, string>>({})
  const aiGenerating = useRef(false)

  const campaignManagers = useMemo(() => uniqueSorted(clients.map((c) => c.campaignManager)), [clients])

  const filteredClients = useMemo(
    () => cmFilter === "All" ? clients : clients.filter((c) => c.campaignManager === cmFilter),
    [clients, cmFilter]
  )

  const kpiClients = useMemo(
    () =>
      filteredClients
        .filter((c) => c.metaAdAccountId || c.clientBoardId)
        .map((c) => ({
          mondayItemId: c.mondayItemId,
          metaAdAccountId: c.metaAdAccountId || null,
          clientBoardId: c.clientBoardId || null,
        })),
    [filteredClients]
  )

  const kpiQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
      }).then((r) => r.json()),
    enabled: kpiClients.length > 0,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const lastUpdated = kpiQuery.dataUpdatedAt
    ? new Date(kpiQuery.dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  // Categorize all clients
  const categorized = useMemo(() => {
    const action: CategorizedClient[] = []
    const watch: CategorizedClient[] = []
    const good: CategorizedClient[] = []

    for (const client of filteredClients) {
      const kpi = kpiQuery.data?.[client.mondayItemId]
      const { category, issue } = categorize(client, kpi)
      const item = { client, category, issue, kpi }

      if (category === "action") action.push(item)
      else if (category === "watch") watch.push(item)
      else if (category === "good") good.push(item)
    }

    action.sort((a, b) => (b.kpi?.adSpend ?? 0) - (a.kpi?.adSpend ?? 0))
    watch.sort((a, b) => (b.kpi?.adSpend ?? 0) - (a.kpi?.adSpend ?? 0))
    good.sort((a, b) => (b.kpi?.leads ?? 0) - (a.kpi?.leads ?? 0))

    return { action, watch, good }
  }, [filteredClients, kpiQuery.data])

  // Auto-generate AI notes when categorized data is ready
  const allCategorized = useMemo(
    () => [...categorized.action, ...categorized.watch, ...categorized.good],
    [categorized]
  )

  useEffect(() => {
    if (allCategorized.length === 0 || aiGenerating.current) return
    // Only generate if we have KPI data and haven't generated yet
    if (!kpiQuery.data) return

    const clientsForAi = allCategorized
      .filter((c) => c.kpi && (c.kpi.adSpend > 0 || c.kpi.leads > 0))
      .map((c) => ({
        id: c.client.mondayItemId,
        name: c.client.name,
        category: c.category as "action" | "watch" | "good",
        issue: c.issue,
        adSpend: c.kpi?.adSpend ?? 0,
        leads: c.kpi?.leads ?? 0,
        cpl: c.kpi?.cpl ?? 0,
        prevCpl: c.kpi?.prevCpl ?? 0,
        appointments: c.kpi?.appointments ?? 0,
        costPerAppointment: c.kpi?.costPerAppointment ?? 0,
        prevCostPerAppointment: c.kpi?.prevCostPerAppointment ?? 0,
      }))

    if (clientsForAi.length === 0) return

    aiGenerating.current = true

    fetch("/api/watchlist-summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clients: clientsForAi }),
    })
      .then((r) => r.ok ? r.json() : {})
      .then((notes: Record<string, string>) => {
        if (Object.keys(notes).length > 0) setAiNotes(notes)
      })
      .catch(() => {})
      .finally(() => { aiGenerating.current = false })
  }, [allCategorized, kpiQuery.data])

  async function handleRefresh() {
    setIsRefreshing(true)
    aiGenerating.current = false
    setAiNotes({})
    router.refresh()
    await kpiQuery.refetch()
    setIsRefreshing(false)
  }

  const isFetching = kpiQuery.isFetching || isRefreshing

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-heading font-semibold tracking-tight">Watch List</h1>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-[11px] text-muted-foreground/40">Updated {lastUpdated}</span>
            )}
            <button
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Campaign performance monitor — {filteredClients.length} active clients
        </p>
      </div>

      {/* Summary pills + CM filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-500/10 text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Action
            <span className="tabular-nums">{categorized.action.length}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-amber-500/10 text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Watch
            <span className="tabular-nums">{categorized.watch.length}</span>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-green-500/10 text-green-500">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Good
            <span className="tabular-nums">{categorized.good.length}</span>
          </div>
        </div>

        <Select value={cmFilter} onValueChange={(v) => setCmFilter(v ?? "All")}>
          <SelectTrigger className="!h-8 !w-auto !min-w-[140px] !border-0 !bg-muted/40 !rounded-lg !text-xs !px-3 !shadow-none dark:!bg-white/5">
            <SelectValue>{cmFilter === "All" ? "All Campaign Managers" : cmFilter}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Campaign Managers</SelectItem>
            {campaignManagers.map((cm) => (
              <SelectItem key={cm} value={cm}>{cm}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Three sections */}
      <div className="space-y-5">
        <WatchSection
          category="action"
          items={categorized.action}
          aiNotes={aiNotes}
          onNavigate={(id) => router.push(`/clients/${id}`)}
          defaultOpen={true}
        />
        <WatchSection
          category="watch"
          items={categorized.watch}
          aiNotes={aiNotes}
          onNavigate={(id) => router.push(`/clients/${id}`)}
          defaultOpen={true}
        />
        <WatchSection
          category="good"
          items={categorized.good}
          aiNotes={aiNotes}
          onNavigate={(id) => router.push(`/clients/${id}`)}
          defaultOpen={false}
        />
      </div>
    </div>
  )
}
