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

  return (
    <div className="space-y-6">
      {/* Tab bar + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 border-b border-border">
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === "current"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("current")}
          >
            Current Clients
            <span className="ml-2 text-xs text-muted-foreground">{visibleCurrent.length}</span>
            {activeTab === "current" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
          <button
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              activeTab === "onboarding"
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("onboarding")}
          >
            Onboarding
            <span className="ml-2 text-xs text-muted-foreground">{onboarding.length}</span>
            {activeTab === "onboarding" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {lastUpdatedLabel && (
            <span className="text-xs text-muted-foreground">Updated {lastUpdatedLabel}</span>
          )}
          <button
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      {activeTab === "current" && (
        <div className="space-y-4">
          {hiddenCount > 0 && (
            <div className="flex items-center justify-between">
              {!showAll && (
                <p className="text-sm text-muted-foreground">
                  Showing Live and On hold — {hiddenCount} hidden
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((v) => !v)}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
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
          />
        </div>
      )}

      {activeTab === "onboarding" && (
        <ClientsTable
          clients={onboarding}
          boardType="onboarding"
          billingSummaries={summariesQuery.data}
          kpiSummaries={kpiQuery.data}
        />
      )}
    </div>
  )
}
