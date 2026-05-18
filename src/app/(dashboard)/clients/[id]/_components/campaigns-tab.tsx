"use client"

import { useMemo } from "react"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { subDays } from "date-fns"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { KpiCards } from "./kpi-cards"
import { PedroInsightCard } from "./pedro-insight-card"
import { UtmTable } from "./utm-table"
import { DateRangePicker } from "@/app/(dashboard)/targets/_components/date-range-picker"
import { useDateRange } from "@/app/(dashboard)/targets/_hooks/use-date-range"

import { Skeleton } from "@/components/ui/skeleton"

import { Settings2 } from "lucide-react"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { KpiResult } from "@/lib/clients/kpis"
import type { MetaCampaign } from "@/lib/integrations/meta"

const AdPerformance = dynamic(() => import("./ad-performance").then((m) => m.AdPerformance), {
  ssr: false,
})

type CampaignWithSelection = MetaCampaign & { isSelected: boolean; isSuggested?: boolean }

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  /** Kept for call-site parity with the previous AI-proposal shape, currently unused. */
  clientName?: string
  /** Kept for call-site parity with the previous AI-proposal shape, currently unused. */
  boardType?: "onboarding" | "current"
  onNavigateToSettings?: () => void
}

export function CampaignsTab({ mondayItemId, metaAdAccountId, clientBoardId, onNavigateToSettings }: Props) {
  const locale = useLocale()
  const { range, setRange, presets, applyPreset, formatDate } = useDateRange()
  const startDateStr = formatDate(range.startDate)
  const endDateStr = formatDate(range.endDate)
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])

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
    queryKey: ["kpis", mondayItemId, startDateStr, endDateStr, selectedIds],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate: startDateStr,
        endDate: endDateStr,
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
          {t("client.campaigns.empty.no_link", locale)}
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
            {t("client.campaigns.empty.no_selection", locale)}
          </p>
          {onNavigateToSettings && (
            <button
              onClick={onNavigateToSettings}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t("client.campaigns.empty.go_settings", locale)}
            </button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <PedroInsightCard mondayItemId={mondayItemId} locale={locale} />

      {/* Date filter + KPIs at the top — what the CM looks at first */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
          maxDate={maxPickerDate}
        />
        <div className="flex gap-1 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="h-8 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <Separator />

      {kpisQuery.isError && (
        <p className="text-sm text-destructive">{t("client.campaigns.error.kpi", locale)}</p>
      )}

      <KpiCards data={kpisQuery.data ?? null} isLoading={kpisQuery.isLoading} />

      {/* UTM breakdown */}
      {(kpisQuery.data?.utmBreakdown?.length ?? 0) > 0 || kpisQuery.isLoading ? (
        <div>
          <h3 className="text-base font-semibold mb-3">{t("client.campaigns.utm.title", locale)}</h3>
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
