"use client"

import { useQuery } from "@tanstack/react-query"
import { CampaignSelector } from "./campaign-selector"
import { ColumnOverrides } from "./column-overrides"
import { TargetOverrides } from "./target-overrides"
import { KpiVisibilityToggle } from "./kpi-visibility-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import type { MetaCampaign } from "@/lib/integrations/meta"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
}

export function ClientSettingsTab({ mondayItemId, metaAdAccountId }: Props) {
  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/campaigns?adAccountId=${metaAdAccountId}`).then((r) => r.json()),
    enabled: !!metaAdAccountId,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="space-y-8">
      {/* KPI Visibility */}
      <div>
        <h3 className="text-sm font-medium mb-1">KPI Sections</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Choose which KPI sections are visible for this client. Leads is always on. Enable Afspraken and Deals when Monday CRM data is available.
        </p>
        <KpiVisibilityToggle mondayItemId={mondayItemId} />
      </div>

      {/* Campaign Selection */}
      {metaAdAccountId && (
        <div>
          <h3 className="text-sm font-medium mb-1">Campaign Selection</h3>
          <p className="text-xs text-muted-foreground/60 mb-4">
            Select which campaigns to include in KPI calculations. Only selected campaigns are used for the Campaigns tab.
          </p>
          {campaignsQuery.isLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <CampaignSelector
              campaigns={campaignsQuery.data?.campaigns ?? []}
              isLoading={campaignsQuery.isLoading}
              mondayItemId={mondayItemId}
              onSelectionChange={() => campaignsQuery.refetch()}
            />
          )}
        </div>
      )}

      {/* KPI Targets */}
      <div>
        <h3 className="text-sm font-medium mb-1">KPI Targets</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Override global KPI target thresholds for this client. Derived metrics auto-recalculate. Leave as-is to use global defaults.
        </p>
        <TargetOverrides mondayItemId={mondayItemId} />
      </div>

      {/* Board Column IDs */}
      <div>
        <h3 className="text-sm font-medium mb-1">Board Column IDs</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Override default Monday column IDs for this client. Leave empty to use the global defaults from Settings.
        </p>
        <ColumnOverrides mondayItemId={mondayItemId} />
      </div>
    </div>
  )
}
