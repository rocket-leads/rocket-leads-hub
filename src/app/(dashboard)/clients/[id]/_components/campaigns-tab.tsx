"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DateFilter, defaultDateRange, type DateRange } from "./date-filter"
import { KpiCards } from "./kpi-cards"
import { UtmTable } from "./utm-table"
import { CampaignSelector } from "./campaign-selector"
import type { KpiResult } from "@/lib/kpis"
import type { MetaCampaign } from "@/lib/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
}

export function CampaignsTab({ mondayItemId, metaAdAccountId, clientBoardId }: Props) {
  const [dateRange, setDateRange] = useState<DateRange>(defaultDateRange)

  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/campaigns`).then((r) => r.json()),
    enabled: !!metaAdAccountId,
  })

  const kpisQuery = useQuery<KpiResult>({
    queryKey: ["kpis", mondayItemId, dateRange.startDate, dateRange.endDate],
    queryFn: () =>
      fetch(
        `/api/clients/${mondayItemId}/kpis?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`
      ).then((r) => r.json()),
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

  return (
    <div className="space-y-6">
      {/* Campaign selector */}
      {metaAdAccountId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Campaign Selection</CardTitle>
          </CardHeader>
          <CardContent>
            <CampaignSelector
              campaigns={campaignsQuery.data?.campaigns ?? []}
              isLoading={campaignsQuery.isLoading}
              mondayItemId={mondayItemId}
              onSelectionChange={() => {
                campaignsQuery.refetch()
                kpisQuery.refetch()
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Date filter */}
      <div>
        <DateFilter value={dateRange} onChange={(r) => setDateRange(r)} />
      </div>

      <Separator />

      {/* KPI error */}
      {kpisQuery.isError && (
        <p className="text-sm text-destructive">Failed to load KPI data. Check your API tokens.</p>
      )}

      {/* KPI cards */}
      <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} />

      {/* UTM breakdown */}
      {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
        <div>
          <h3 className="text-base font-semibold mb-3">UTM / Ad Performance Breakdown</h3>
          <UtmTable
            rows={kpisQuery.data?.utmBreakdown ?? []}
            isLoading={kpisQuery.isLoading}
          />
        </div>
      ) : null}
    </div>
  )
}
