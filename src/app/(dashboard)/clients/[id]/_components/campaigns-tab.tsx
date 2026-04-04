"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DateFilter, defaultDateRange, type DateRange } from "./date-filter"
import { KpiCards, type KpiVisibility } from "./kpi-cards"
import { UtmTable } from "./utm-table"
import { AdBudgetBalance } from "./ad-budget-balance"
import { OptimizationProposal } from "./optimization-proposal"
import { Skeleton } from "@/components/ui/skeleton"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import type { KpiResult } from "@/lib/clients/kpis"
import type { MetaCampaign } from "@/lib/integrations/meta"
import { mergeTargets, deriveTargets, DEFAULT_TARGETS, type KpiTargets } from "@/lib/clients/targets"

const AdPerformance = dynamic(() => import("./ad-performance").then((m) => m.AdPerformance), {
  ssr: false,
})

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  stripeCustomerId: string | null
}

export function CampaignsTab({ mondayItemId, metaAdAccountId, clientBoardId, stripeCustomerId }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange)

  const visibilityQuery = useQuery<{ kpiVisibility: KpiVisibility }>({
    queryKey: ["monday-active", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/monday-active`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const kpiVisibility = visibilityQuery.data?.kpiVisibility ?? { leads: true, appointments: false, deals: false }

  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/campaigns?adAccountId=${metaAdAccountId}`).then((r) => r.json()),
    enabled: !!metaAdAccountId,
  })

  const selectedCampaigns = useMemo(
    () => (campaignsQuery.data?.campaigns ?? []).filter((c) => c.isSelected),
    [campaignsQuery.data]
  )
  const selectedCount = selectedCampaigns.length

  const selectedIds = useMemo(
    () => selectedCampaigns.map((c) => c.id),
    [selectedCampaigns]
  )

  const targetsQuery = useQuery<{ global: KpiTargets; overrides: Partial<KpiTargets> | null }>({
    queryKey: ["target-overrides", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/target-overrides`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const effectiveTargets = useMemo(() => {
    const global = targetsQuery.data?.global ?? DEFAULT_TARGETS
    return deriveTargets(mergeTargets(global, targetsQuery.data?.overrides))
  }, [targetsQuery.data])

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

  return (
    <div className="space-y-6">
      {/* Ad budget balance for Rocket Leads ad account clients */}
      {isRocketLeadsAdAccount(metaAdAccountId) && stripeCustomerId && (
        <AdBudgetBalance
          mondayItemId={mondayItemId}
          metaAdAccountId={metaAdAccountId!}
          stripeCustomerId={stripeCustomerId}
        />
      )}

      {/* KPI data */}
      {metaAdAccountId && selectedCount === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No campaigns selected yet. Go to the <strong>Settings</strong> tab to select which campaigns to track.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <OptimizationProposal
            mondayItemId={mondayItemId}
            metaAdAccountId={metaAdAccountId}
            clientBoardId={clientBoardId}
            selectedCampaignIds={selectedIds}
          />
          <div>
            <DateFilter value={dateRange} onChange={(r) => setDateRange(r)} />
          </div>
          <Separator />
          {kpisQuery.isError && (
            <p className="text-sm text-destructive">Failed to load KPI data. Check your API tokens.</p>
          )}
          <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} visibility={kpiVisibility} targets={effectiveTargets} />
          {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
            <div>
              <h3 className="text-base font-semibold mb-3">UTM / Ad Performance Breakdown</h3>
              <UtmTable rows={kpisQuery.data?.utmBreakdown ?? []} isLoading={kpisQuery.isLoading} />
            </div>
          ) : null}
          {!kpisQuery.isLoading && kpisQuery.data && (kpisQuery.data.utmBreakdown?.length ?? 0) >= 2 && (
            <AdPerformance rows={kpisQuery.data.utmBreakdown} kpis={kpisQuery.data} />
          )}
        </div>
      )}
    </div>
  )
}
