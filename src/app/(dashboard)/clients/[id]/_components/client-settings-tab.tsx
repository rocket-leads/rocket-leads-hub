"use client"

import { useQuery } from "@tanstack/react-query"
import { CampaignSelector } from "./campaign-selector"
import { ColumnOverrides } from "./column-overrides"
import { MondayToggle } from "./monday-toggle"
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
      {/* Monday CRM */}
      <div>
        <h3 className="text-sm font-medium mb-1">Monday CRM</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          Toggle whether this client uses Monday.com for lead tracking. When off, health scoring uses only CPL data.
        </p>
        <MondayToggle mondayItemId={mondayItemId} />
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
