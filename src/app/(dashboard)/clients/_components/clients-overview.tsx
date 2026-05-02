"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { RefreshCw, Users, Sparkles } from "lucide-react"
import { format, subDays } from "date-fns"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { Panel } from "@/components/ui/panel"
import { ClientsTable } from "./clients-table"
import { useDateRange } from "@/app/(dashboard)/targets/_hooks/use-date-range"
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
  const dateRange = useDateRange()
  const startDateStr = format(dateRange.range.startDate, "yyyy-MM-dd")
  const endDateStr = format(dateRange.range.endDate, "yyyy-MM-dd")
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])

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
    queryKey: ["kpi-summaries", kpiClients.map((c) => c.mondayItemId), startDateStr, endDateStr],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients, startDate: startDateStr, endDate: endDateStr }),
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

  const tabItems: TopTab<"current" | "onboarding">[] = [
    { id: "current", label: "Current Clients", icon: Users, count: visibleCurrent.length },
    { id: "onboarding", label: "Onboarding", icon: Sparkles, count: onboarding.length },
  ]

  return (
    <div className="space-y-6">
      <TopTabs<"current" | "onboarding">
        tabs={tabItems}
        value={activeTab}
        onChange={setActiveTab}
        rightContent={
          <>
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
          </>
        }
      />

      {/* Content */}
      {activeTab === "current" && (
        <Panel className="p-5">
          <ClientsTable
            clients={visibleCurrent}
            boardType="current"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
            mondayActiveMap={mondayActiveQuery.data}
            showAllToggle={{
              showAll,
              setShowAll,
              totalCount: current.length,
            }}
            dateRangeControl={{
              startDate: dateRange.range.startDate,
              endDate: dateRange.range.endDate,
              setRange: dateRange.setRange,
              presets: dateRange.presets,
              applyPreset: dateRange.applyPreset,
              maxDate: maxPickerDate,
            }}
          />
        </Panel>
      )}

      {activeTab === "onboarding" && (
        <Panel className="p-5">
          <ClientsTable
            clients={onboarding}
            boardType="onboarding"
            billingSummaries={summariesQuery.data}
            kpiSummaries={kpiQuery.data}
            mondayActiveMap={mondayActiveQuery.data}
          />
        </Panel>
      )}
    </div>
  )
}
