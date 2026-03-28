"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"
import { ClientsTable } from "./clients-table"
import type { MondayClient } from "@/lib/monday"
import type { BillingSummary } from "@/lib/stripe-client"
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
    router.refresh() // re-runs server component (Monday board data)
    await Promise.all([summariesQuery.refetch(), kpiQuery.refetch()])
    setIsRefreshing(false)
  }

  const lastUpdated = Math.max(summariesQuery.dataUpdatedAt || 0, kpiQuery.dataUpdatedAt || 0)
  const lastUpdatedLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  const [activeTab, setActiveTab] = useState<"current" | "onboarding">("current")

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
          <button
            className={`inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-all ${activeTab === "current" ? "bg-background text-foreground shadow-sm" : ""}`}
            onClick={() => setActiveTab("current")}
          >
            Current Clients
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
              {visibleCurrent.length}
            </span>
          </button>
          <button
            className={`inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-all ${activeTab === "onboarding" ? "bg-background text-foreground shadow-sm" : ""}`}
            onClick={() => setActiveTab("onboarding")}
          >
            Onboarding
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
              {onboarding.length}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdatedLabel && (
            <span className="text-xs text-muted-foreground">Updated {lastUpdatedLabel}</span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {activeTab === "current" && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-4">
            {!showAll && hiddenCount > 0 && (
              <p className="text-sm text-muted-foreground">
                Showing Live and On hold only — {hiddenCount} client{hiddenCount !== 1 ? "s" : ""} hidden (Churned / other)
              </p>
            )}
            {hiddenCount > 0 && (
              <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)} className="ml-auto">
                {showAll ? "Show active only" : `Show all ${current.length} clients`}
              </Button>
            )}
          </div>
          <ClientsTable
            clients={visibleCurrent}
            boardType="current"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
          />
        </div>
      )}

      {activeTab === "onboarding" && (
        <div className="mt-6">
          <ClientsTable
            clients={onboarding}
            boardType="onboarding"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
          />
        </div>
      )}
    </div>
  )
}
