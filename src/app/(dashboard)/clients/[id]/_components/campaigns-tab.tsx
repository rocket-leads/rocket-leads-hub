"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DateFilter, defaultDateRange, type DateRange } from "./date-filter"
import { KpiCards } from "./kpi-cards"
import { UtmTable } from "./utm-table"

import { Skeleton } from "@/components/ui/skeleton"

import { Settings2 } from "lucide-react"
import type { KpiResult } from "@/lib/clients/kpis"
import type { MetaCampaign } from "@/lib/integrations/meta"

const AdPerformance = dynamic(() => import("./ad-performance").then((m) => m.AdPerformance), {
  ssr: false,
})
const CampaignAnalysis = dynamic(() => import("./ai-optimization-proposal").then((m) => m.CampaignAnalysis), {
  ssr: false,
})

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  clientName: string
  boardType: "onboarding" | "current"
  onNavigateToSettings?: () => void
}

export function CampaignsTab({ mondayItemId, metaAdAccountId, clientBoardId, clientName, boardType, onNavigateToSettings }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange)

  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/campaigns?adAccountId=${metaAdAccountId}`).then((r) => r.json()),
    enabled: !!metaAdAccountId,
  })

  const selectedIds = useMemo(
    () => (campaignsQuery.data?.campaigns ?? []).filter((c) => c.isSelected).map((c) => c.id),
    [campaignsQuery.data]
  )

  const kpisQuery = useQuery<KpiResult>({
    queryKey: ["kpis", mondayItemId, dateRange.startDate, dateRange.endDate, selectedIds],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        ...(metaAdAccountId ? { adAccountId: metaAdAccountId } : {}),
        ...(clientBoardId ? { clientBoardId } : {}),
        ...(selectedIds.length > 0 ? { selectedCampaignIds: selectedIds.join(",") } : {}),
      })
      return fetch(`/api/clients/${mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled: !!mondayItemId,
  })

  if (!metaAdAccountId && !clientBoardId) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No Meta Ad Account or Client Board linked in Monday.com for this client.
        </CardContent>
      </Card>
    )
  }

  if (metaAdAccountId && campaignsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  // No campaigns selected — prompt to go to settings
  if (metaAdAccountId && selectedIds.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No campaigns selected yet. Select which campaigns to track in Settings.
          </p>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Go to Settings
            </button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Campaign Analysis — top of page */}
      <CampaignAnalysis
        mondayItemId={mondayItemId}
        metaAdAccountId={metaAdAccountId}
        clientBoardId={clientBoardId}
        selectedCampaignIds={selectedIds}
        clientName={clientName}
        boardType={boardType}
      />

      {/* Date filter + KPIs */}
      <div>
        <DateFilter value={dateRange} onChange={(r) => setDateRange(r)} />
      </div>
      <Separator />

      {kpisQuery.isError && (
        <p className="text-sm text-destructive">Failed to load KPI data. Check your API tokens.</p>
      )}

      <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} />

      {/* UTM breakdown */}
      {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
        <div>
          <h3 className="text-base font-semibold mb-3">UTM / Ad Performance Breakdown</h3>
          <UtmTable rows={kpisQuery.data?.utmBreakdown ?? []} isLoading={kpisQuery.isLoading} />
        </div>
      ) : null}

      {/* Ad performance chart */}
      {!kpisQuery.isLoading && kpisQuery.data && (kpisQuery.data.utmBreakdown?.length ?? 0) >= 2 && (
        <AdPerformance rows={kpisQuery.data.utmBreakdown} />
      )}
    </div>
  )
}
