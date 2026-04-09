"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { RefreshCw, AlertTriangle, AlertCircle, TrendingUp, Inbox, CheckCircle2, ExternalLink, ChevronDown, ChevronRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ClientsTable } from "./clients-table"
import { groupByAction, type ActionResult } from "@/lib/clients/action-category"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

type AiSummary = { type: string; title: string }

const ACTIVE_STATUSES = ["Live", "On hold"]

const ACTION_ICONS: Record<string, typeof AlertCircle> = {
  "payment-overdue": AlertCircle,
  "campaign-critical": AlertTriangle,
  "performance-warning": TrendingUp,
  "monday-inactive": Inbox,
  autopilot: CheckCircle2,
}

const ACTION_COLORS: Record<string, { border: string; bg: string; dot: string; text: string }> = {
  red: { border: "border-red-500/30", bg: "bg-red-500/5", dot: "bg-red-500", text: "text-red-500" },
  amber: { border: "border-amber-500/30", bg: "bg-amber-500/5", dot: "bg-amber-500", text: "text-amber-500" },
  green: { border: "border-green-500/30", bg: "bg-green-500/5", dot: "bg-green-500", text: "text-green-500" },
}

function fmtKpi(v: number, type: "currency" | "integer"): string {
  if (type === "currency") return `€${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return v.toLocaleString("en-GB")
}

// --- Zone A: Command Bar ---

function CommandBar({
  totalActive,
  criticalCount,
  warningCount,
  overdueCount,
  onboardingCount,
  activeFilter,
  onFilterChange,
  lastUpdated,
  isFetching,
  onRefresh,
}: {
  totalActive: number
  criticalCount: number
  warningCount: number
  overdueCount: number
  onboardingCount: number
  activeFilter: string | null
  onFilterChange: (filter: string | null) => void
  lastUpdated: string | null
  isFetching: boolean
  onRefresh: () => void
}) {
  const pills = [
    { key: "active", label: "Active", count: totalActive, dot: "bg-foreground/30" },
    { key: "critical", label: "Critical", count: criticalCount, dot: "bg-red-500" },
    { key: "warning", label: "Warning", count: warningCount, dot: "bg-amber-500" },
    { key: "overdue", label: "Overdue", count: overdueCount, dot: "bg-red-500" },
    { key: "onboarding", label: "Onboarding", count: onboardingCount, dot: "bg-blue-500" },
  ]

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {pills.map(({ key, label, count, dot }) => (
          <button
            key={key}
            onClick={() => onFilterChange(activeFilter === key ? null : key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              activeFilter === key
                ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:bg-white/5 dark:hover:bg-white/10"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            {label}
            <span className="tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {lastUpdated && (
          <span className="text-[11px] text-muted-foreground/40">Updated {lastUpdated}</span>
        )}
        <button
          className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
          onClick={onRefresh}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  )
}

// --- Zone B: Action Queue ---

function ActionCard({
  client,
  action,
  kpi,
  aiSummary,
  onClick,
}: {
  client: MondayClient
  action: ActionResult
  kpi: KpiSummary | undefined
  aiSummary: AiSummary | undefined
  onClick: () => void
}) {
  const colors = ACTION_COLORS[action.color]
  const Icon = ACTION_ICONS[action.category] ?? AlertTriangle

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border ${colors.border} ${colors.bg} p-4 cursor-pointer hover:ring-1 hover:ring-primary/20 transition-all group`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${colors.text}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm text-foreground truncate">{client.name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${colors.text} ${colors.bg} border ${colors.border}`}>
                {action.label}
              </span>
            </div>
            {(client.accountManager || client.campaignManager) && (
              <p className="text-[11px] text-muted-foreground/50 mt-0.5">
                {[client.accountManager, client.campaignManager].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>

        {/* Key metrics */}
        <div className="text-right shrink-0">
          {kpi && kpi.adSpend > 0 && (
            <p className="text-xs tabular-nums text-muted-foreground">{fmtKpi(kpi.adSpend, "currency")} spend</p>
          )}
          {kpi && kpi.leads > 0 && (
            <p className="text-xs tabular-nums font-medium">{kpi.leads} leads</p>
          )}
          {kpi && kpi.cpl > 0 && (
            <p className="text-xs tabular-nums text-muted-foreground">
              CPL {fmtKpi(kpi.cpl, "currency")}
              {kpi.prevCpl > 0 && (() => {
                const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
                return (
                  <span className={pct > 0 ? " text-red-400" : " text-green-500"}>
                    {" "}{pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                  </span>
                )
              })()}
            </p>
          )}
        </div>
      </div>

      {/* Action reason */}
      <p className="text-xs text-muted-foreground ml-7">{action.reason}</p>

      {/* AI summary if available */}
      {aiSummary && (
        <div className="mt-2 ml-7 flex items-start gap-1.5 rounded-lg bg-violet-500/5 border border-violet-500/10 px-3 py-2">
          <Sparkles className="h-3 w-3 shrink-0 mt-0.5 text-violet-500" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">{aiSummary.title}</p>
        </div>
      )}

      {/* Footer with quick links */}
      <div className="mt-3 ml-7 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-primary font-medium">View details</span>
        {client.metaAdAccountId && (
          <a
            href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${client.metaAdAccountId.replace("act_", "")}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
          >
            Meta Ads <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  )
}

function ActionSection({
  title,
  icon: SectionIcon,
  iconColor,
  items,
  kpiSummaries,
  aiSummaries,
  onClientClick,
  defaultOpen = true,
}: {
  title: string
  icon: typeof AlertCircle
  iconColor: string
  items: Array<{ client: MondayClient; action: ActionResult }>
  kpiSummaries: Record<string, KpiSummary> | undefined
  aiSummaries: Record<string, AiSummary> | undefined
  onClientClick: (id: string) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (items.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 mb-3 group"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <SectionIcon className={`h-3.5 w-3.5 ${iconColor}`} />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
          {title}
        </span>
        <span className="text-[11px] text-muted-foreground/40 tabular-nums">({items.length})</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {items.map(({ client, action }) => (
            <ActionCard
              key={client.mondayItemId}
              client={client}
              action={action}
              kpi={kpiSummaries?.[client.mondayItemId]}
              aiSummary={aiSummaries?.[client.mondayItemId]}
              onClick={() => onClientClick(client.mondayItemId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main Overview ---

type Props = {
  onboarding: MondayClient[]
  current: MondayClient[]
}

export function ClientsOverview({ onboarding, current }: Props) {
  const router = useRouter()
  const [showAll, setShowAll] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<"current" | "onboarding">("current")
  const [commandFilter, setCommandFilter] = useState<string | null>(null)

  const visibleCurrent = useMemo(
    () => showAll ? current : current.filter((c) => ACTIVE_STATUSES.includes(c.campaignStatus ?? "")),
    [current, showAll]
  )
  const hiddenCount = current.length - visibleCurrent.length

  const activeClients = useMemo(() => [...onboarding, ...visibleCurrent], [onboarding, visibleCurrent])

  const customerIds = useMemo(
    () => activeClients.map((c) => c.stripeCustomerId).filter(Boolean) as string[],
    [activeClients]
  )

  const kpiClients = useMemo(
    () =>
      activeClients
        .filter((c) => c.metaAdAccountId || c.clientBoardId)
        .map((c) => ({
          mondayItemId: c.mondayItemId,
          metaAdAccountId: c.metaAdAccountId || null,
          clientBoardId: c.clientBoardId || null,
        })),
    [activeClients]
  )

  const summariesQuery = useQuery<Record<string, BillingSummary>>({
    queryKey: ["billing-summaries", customerIds],
    queryFn: () => {
      const params = new URLSearchParams({ customerIds: customerIds.join(",") })
      return fetch(`/api/billing-summaries?${params}`).then((r) => r.json())
    },
    enabled: customerIds.length > 0,
    staleTime: 60 * 60 * 1000,
  })

  const mondayActiveQuery = useQuery<Record<string, boolean>>({
    queryKey: ["monday-active-map"],
    queryFn: () => fetch("/api/monday-active").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

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

  const aiSummariesQuery = useQuery<Record<string, AiSummary>>({
    queryKey: ["overview-proposals"],
    queryFn: () => fetch("/api/overview-proposals").then((r) => r.ok ? r.json() : {}),
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const isFetching = summariesQuery.isFetching || kpiQuery.isFetching || isRefreshing

  async function handleRefresh() {
    setIsRefreshing(true)
    router.refresh()
    await Promise.all([summariesQuery.refetch(), kpiQuery.refetch(), aiSummariesQuery.refetch()])
    setIsRefreshing(false)
  }

  const lastUpdated = Math.max(summariesQuery.dataUpdatedAt || 0, kpiQuery.dataUpdatedAt || 0)
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  // Compute action groups for current clients
  const actionGroups = useMemo(
    () => groupByAction(visibleCurrent, kpiQuery.data, summariesQuery.data, mondayActiveQuery.data),
    [visibleCurrent, kpiQuery.data, summariesQuery.data, mondayActiveQuery.data]
  )

  // Command bar counts
  const criticalCount = actionGroups.immediate.length
  const warningCount = actionGroups.monitor.length
  const overdueCount = useMemo(() => {
    if (!summariesQuery.data) return 0
    return visibleCurrent.filter((c) => {
      const b = c.stripeCustomerId ? summariesQuery.data?.[c.stripeCustomerId] : undefined
      return b?.status === "overdue"
    }).length
  }, [visibleCurrent, summariesQuery.data])

  // Filter table based on command bar pill
  const filteredTableClients = useMemo(() => {
    if (!commandFilter) return visibleCurrent
    switch (commandFilter) {
      case "critical":
        return actionGroups.immediate.map((i) => i.client)
      case "warning":
        return actionGroups.monitor.map((i) => i.client)
      case "overdue":
        return visibleCurrent.filter((c) => {
          const b = c.stripeCustomerId ? summariesQuery.data?.[c.stripeCustomerId] : undefined
          return b?.status === "overdue"
        })
      default:
        return visibleCurrent
    }
  }, [commandFilter, visibleCurrent, actionGroups, summariesQuery.data])

  const tabItems = [
    { id: "current" as const, label: "Current Clients", count: visibleCurrent.length },
    { id: "onboarding" as const, label: "Onboarding", count: onboarding.length },
  ]

  const hasActionItems = criticalCount > 0 || warningCount > 0

  return (
    <div className="space-y-6">
      {/* Zone A: Command Bar */}
      <CommandBar
        totalActive={visibleCurrent.length}
        criticalCount={criticalCount}
        warningCount={warningCount}
        overdueCount={overdueCount}
        onboardingCount={onboarding.length}
        activeFilter={commandFilter}
        onFilterChange={(f) => {
          setCommandFilter(f)
          if (f === "onboarding") setActiveTab("onboarding")
          else setActiveTab("current")
        }}
        lastUpdated={lastUpdatedLabel}
        isFetching={isFetching}
        onRefresh={handleRefresh}
      />

      {/* Zone B: Action Queue (only for current clients, only when there are action items) */}
      {activeTab === "current" && hasActionItems && !commandFilter && (
        <div className="space-y-5">
          <ActionSection
            title="Needs Immediate Action"
            icon={AlertCircle}
            iconColor="text-red-500"
            items={actionGroups.immediate}
            kpiSummaries={kpiQuery.data}
            aiSummaries={aiSummariesQuery.data}
            onClientClick={(id) => router.push(`/clients/${id}`)}
          />
          <ActionSection
            title="Monitor Closely"
            icon={AlertTriangle}
            iconColor="text-amber-500"
            items={actionGroups.monitor}
            kpiSummaries={kpiQuery.data}
            aiSummaries={aiSummariesQuery.data}
            onClientClick={(id) => router.push(`/clients/${id}`)}
            defaultOpen={actionGroups.immediate.length === 0}
          />
        </div>
      )}

      {/* Zone C: Full Portfolio */}
      <div>
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-border/40 mb-6">
          <div className="flex items-center gap-0">
            {tabItems.map(({ id, label, count }) => (
              <button
                key={id}
                className={`relative px-5 py-3 text-sm font-medium transition-all duration-150 ${
                  activeTab === id
                    ? "text-foreground"
                    : "text-muted-foreground/60 hover:text-foreground"
                }`}
                onClick={() => { setActiveTab(id); setCommandFilter(null) }}
              >
                {label}
                <span className={`ml-2 text-xs tabular-nums ${
                  activeTab === id ? "text-primary" : "text-muted-foreground/40"
                }`}>
                  {count}
                </span>
                {activeTab === id && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-primary rounded-t-full" />
                )}
              </button>
            ))}
          </div>
          {activeTab === "current" && hiddenCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-muted-foreground/60 hover:text-foreground"
            >
              {showAll ? "Show active only" : `Show all ${current.length}`}
            </Button>
          )}
        </div>

        {activeTab === "current" && (
          <ClientsTable
            clients={commandFilter ? filteredTableClients : visibleCurrent}
            boardType="current"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
            mondayActiveMap={mondayActiveQuery.data}
            defaultSortKey="health"
            defaultSortDir="asc"
          />
        )}

        {activeTab === "onboarding" && (
          <ClientsTable
            clients={onboarding}
            boardType="onboarding"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
            mondayActiveMap={mondayActiveQuery.data}
          />
        )}
      </div>
    </div>
  )
}
