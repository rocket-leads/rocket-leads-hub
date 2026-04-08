"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { ClientsTable } from "./clients-table"
import type { MondayClient } from "@/lib/integrations/monday"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

const ACTIVE_STATUSES = ["Live", "On hold"]

type Props = {
  onboarding: MondayClient[]
  current: MondayClient[]
}

export function ClientsOverview({ onboarding, current }: Props) {
  const router = useRouter()
  const [showAll, setShowAll] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeTab, setActiveTab] = useState<"current" | "onboarding">("current")

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

  const isFetching = summariesQuery.isFetching || kpiQuery.isFetching || isRefreshing

  async function handleRefresh() {
    setIsRefreshing(true)
    router.refresh()
    await Promise.all([summariesQuery.refetch(), kpiQuery.refetch()])
    setIsRefreshing(false)
  }

  const lastUpdated = Math.max(summariesQuery.dataUpdatedAt || 0, kpiQuery.dataUpdatedAt || 0)
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  const tabItems = [
    { id: "current" as const, label: "Current Clients", count: visibleCurrent.length },
    { id: "onboarding" as const, label: "Onboarding", count: onboarding.length },
  ]

  return (
    <div className="space-y-6">
      {/* Tab bar + refresh */}
      <div className="flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-0">
          {tabItems.map(({ id, label, count }) => (
            <button
              key={id}
              className={`relative px-5 py-3 text-sm font-medium transition-all duration-150 ${
                activeTab === id
                  ? "text-foreground"
                  : "text-muted-foreground/60 hover:text-foreground"
              }`}
              onClick={() => setActiveTab(id)}
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

        <div className="flex items-center gap-3 mb-1">
          {lastUpdatedLabel && (
            <span className="text-[11px] text-muted-foreground/40">Updated {lastUpdatedLabel}</span>
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

      {/* Content */}
      {activeTab === "current" && (
        <div className="space-y-4">
          {hiddenCount > 0 && (
            <div className="flex items-center justify-between">
              {!showAll && (
                <p className="text-xs text-muted-foreground/50">
                  Showing Live and On hold — {hiddenCount} hidden
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
                className="ml-auto text-xs text-muted-foreground/60 hover:text-foreground"
              >
                {showAll ? "Show active only" : `Show all ${current.length}`}
              </Button>
            </div>
          )}
          <ClientsTable
            clients={visibleCurrent}
            boardType="current"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
            mondayActiveMap={mondayActiveQuery.data}
          />
        </div>
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
  )
}
