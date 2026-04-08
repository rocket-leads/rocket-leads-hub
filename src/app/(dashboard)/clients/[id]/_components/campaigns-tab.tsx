"use client"

import { useState, useMemo } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DateFilter, defaultDateRange, type DateRange } from "./date-filter"
import { KpiCards } from "./kpi-cards"
import { UtmTable } from "./utm-table"
import { CampaignSelector } from "./campaign-selector"
import { AdBudgetBalance } from "./ad-budget-balance"
import { Skeleton } from "@/components/ui/skeleton"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"
import type { KpiResult } from "@/lib/clients/kpis"
import { scoreRows } from "./ad-performance"
import type { MetaCampaign } from "@/lib/integrations/meta"

const AdPerformance = dynamic(() => import("./ad-performance").then((m) => m.AdPerformance), {
  ssr: false,
})
const CampaignOptimizationProposal = dynamic(() => import("./ai-optimization-proposal").then((m) => m.CampaignOptimizationProposal), {
  ssr: false,
})

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  stripeCustomerId: string | null
  clientName: string
  boardType: "onboarding" | "current"
}

export function CampaignsTab({ mondayItemId, metaAdAccountId, clientBoardId, stripeCustomerId, clientName, boardType }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange)

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

  const defaultTab = metaAdAccountId && !campaignsQuery.isLoading && selectedCount > 0
    ? "selected"
    : "all"

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

      {/* Campaign sub-tabs (only shown when a Meta ad account is linked) */}
      {metaAdAccountId ? (
        <Tabs defaultValue={defaultTab} key={defaultTab}>
          <TabsList>
            <TabsTrigger value="selected">
              Selected Campaigns
              {selectedCount > 0 && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">{selectedCount}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="all">All Campaigns</TabsTrigger>
          </TabsList>

          {/* Selected Campaigns tab — KPI view */}
          <TabsContent value="selected" className="mt-6 space-y-6">
            {selectedCount === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No campaigns selected yet. Go to &ldquo;All Campaigns&rdquo; to select which campaigns to track.
                </CardContent>
              </Card>
            ) : (
              <>
                <div>
                  <DateFilter value={dateRange} onChange={(r) => setDateRange(r)} />
                </div>
                <Separator />
                {kpisQuery.isError && (
                  <p className="text-sm text-destructive">Failed to load KPI data. Check your API tokens.</p>
                )}
                <CampaignOptimizationProposal
                  mondayItemId={mondayItemId}
                  metaAdAccountId={metaAdAccountId}
                  clientBoardId={clientBoardId}
                  selectedCampaignIds={selectedIds}
                  clientName={clientName}
                  boardType={boardType}
                  scored={!kpisQuery.isLoading && kpisQuery.data ? scoreRows(kpisQuery.data.utmBreakdown ?? []) : null}
                  kpis={kpisQuery.data ?? null}
                />
                <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} />
                {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
                  <div>
                    <h3 className="text-base font-semibold mb-3">UTM / Ad Performance Breakdown</h3>
                    <UtmTable rows={kpisQuery.data?.utmBreakdown ?? []} isLoading={kpisQuery.isLoading} />
                  </div>
                ) : null}
                {!kpisQuery.isLoading && kpisQuery.data && (kpisQuery.data.utmBreakdown?.length ?? 0) >= 2 && (
                  <AdPerformance rows={kpisQuery.data.utmBreakdown} />
                )}
              </>
            )}
          </TabsContent>

          {/* All Campaigns tab — selector */}
          <TabsContent value="all" className="mt-6">
            <CampaignSelector
              campaigns={campaignsQuery.data?.campaigns ?? []}
              isLoading={campaignsQuery.isLoading}
              mondayItemId={mondayItemId}
              onSelectionChange={() => campaignsQuery.refetch()}
            />
          </TabsContent>
        </Tabs>
      ) : (
        /* No Meta account — just show KPI data from client board */
        <div className="space-y-6">
          <div>
            <DateFilter value={dateRange} onChange={(r) => setDateRange(r)} />
          </div>
          <Separator />
          {kpisQuery.isError && (
            <p className="text-sm text-destructive">Failed to load KPI data. Check your API tokens.</p>
          )}
          <CampaignOptimizationProposal
            mondayItemId={mondayItemId}
            metaAdAccountId={metaAdAccountId}
            clientBoardId={clientBoardId}
            selectedCampaignIds={[]}
            clientName={clientName}
            boardType={boardType}
            scored={!kpisQuery.isLoading && kpisQuery.data ? scoreRows(kpisQuery.data.utmBreakdown ?? []) : null}
            kpis={kpisQuery.data ?? null}
          />
          <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} />
          {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
            <div>
              <h3 className="text-base font-semibold mb-3">UTM / Ad Performance Breakdown</h3>
              <UtmTable rows={kpisQuery.data?.utmBreakdown ?? []} isLoading={kpisQuery.isLoading} />
            </div>
          ) : null}
          {!kpisQuery.isLoading && kpisQuery.data && (kpisQuery.data.utmBreakdown?.length ?? 0) >= 2 && (
            <AdPerformance rows={kpisQuery.data.utmBreakdown} />
          )}
        </div>
      )}
    </div>
  )
}
