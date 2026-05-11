"use client"

import { useQuery } from "@tanstack/react-query"
import { CampaignSelector } from "./campaign-selector"
import { ColumnOverrides } from "./column-overrides"
import { KpiVisibilityToggle } from "./kpi-visibility-toggle"
import { Skeleton } from "@/components/ui/skeleton"
import { ClientInformationPanel } from "@/components/client-information-panel"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { MetaCampaign } from "@/lib/integrations/meta"
import type { MondayClient } from "@/lib/integrations/monday"

type CampaignWithSelection = MetaCampaign & { isSelected: boolean; isSuggested?: boolean }

type Props = {
  client: MondayClient
}

export function ClientSettingsTab({ client }: Props) {
  const locale = useLocale()
  const mondayItemId = client.mondayItemId
  const metaAdAccountId = client.metaAdAccountId || null

  const campaignsQuery = useQuery<{ campaigns: CampaignWithSelection[] }>({
    queryKey: ["campaigns", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/campaigns?adAccountId=${metaAdAccountId}`).then((r) => r.json()),
    enabled: !!metaAdAccountId,
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div className="space-y-8">
      {/* Client Information — name, IDs, financials, team. Edits write back to Monday. */}
      <div>
        <h3 className="text-sm font-medium mb-1">{t("client.settings.info.title", locale)}</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          {t("client.settings.info.description", locale)}
        </p>
        <ClientInformationPanel client={client} />
      </div>

      {/* KPI Visibility */}
      <div>
        <h3 className="text-sm font-medium mb-1">{t("client.settings.kpi.title", locale)}</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          {t("client.settings.kpi.description", locale)}
        </p>
        <KpiVisibilityToggle mondayItemId={mondayItemId} />
      </div>

      {/* Campaign Selection */}
      {metaAdAccountId && (
        <div>
          <h3 className="text-sm font-medium mb-1">{t("client.settings.campaigns.title", locale)}</h3>
          <p className="text-xs text-muted-foreground/60 mb-4">
            {t("client.settings.campaigns.description", locale)}
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
        <h3 className="text-sm font-medium mb-1">{t("client.settings.columns.title", locale)}</h3>
        <p className="text-xs text-muted-foreground/60 mb-4">
          {t("client.settings.columns.description", locale)}
        </p>
        <ColumnOverrides mondayItemId={mondayItemId} />
      </div>
    </div>
  )
}
