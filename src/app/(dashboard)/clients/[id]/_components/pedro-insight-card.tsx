"use client"

import { useQuery } from "@tanstack/react-query"
import { Sparkles } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { PedroClientInsightsResponse } from "@/app/api/clients/[id]/pedro-insights/route"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"

type Props = {
  mondayItemId: string
  locale: Locale
}

/**
 * The single Pedro insight card - rendered everywhere AI text used to appear
 * (client detail header, replacing the old 3-tile overview/optimisation/quality
 * split plus the campaigns-tab lead analysis and proposals).
 *
 * Reads `client_pedro` from pedro_insights (JSON body) and renders:
 *   - 1-2 sentence conclusion
 *   - 3-5 action bullets
 *
 * Hidden entirely when no insight exists yet (cron hasn't reached this client
 * or client is in the no-data bucket).
 */
export function PedroInsightCard({ mondayItemId, locale }: Props) {
  const { data, isLoading } = useQuery<PedroClientInsightsResponse>({
    queryKey: ["pedro-insights", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/pedro-insights`).then((r) => r.json()),
    enabled: !!mondayItemId,
    staleTime: 5 * 60 * 1000, // 5 min - cron only writes hourly
  })

  if (isLoading) {
    return (
      <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.02] p-4 space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  const record = data?.insights?.client_pedro
  const parsed = parsePedroBody(record?.body)

  if (!parsed) return null

  // Hide insufficient-signal placeholders - render nothing rather than a card
  // that says "nothing to see here". Lets the rest of the page breathe.
  if (parsed.actions.length === 0 && /insufficient signal/i.test(parsed.conclusion)) {
    return null
  }

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold">
            {t("pedro.label", locale)}
          </span>
        </div>
        {record?.generatedAt && (
          <span
            className="text-[10px] text-muted-foreground/50 tabular-nums"
            title={`Generated ${new Date(record.generatedAt).toLocaleString("en-GB")}`}
          >
            {timeAgo(record.generatedAt)}
          </span>
        )}
      </div>

      <p className="text-sm text-foreground/85 leading-relaxed">{parsed.conclusion}</p>

      {parsed.actions.length > 0 && (
        <ul className="space-y-1.5 pt-2 border-t border-violet-500/10">
          {parsed.actions.map((action, i) => (
            <li key={i} className="text-xs text-foreground/75 leading-relaxed flex gap-2">
              <span className="text-violet-400/70 shrink-0">•</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Compact "X ago" rendering - same buckets the inbox uses elsewhere. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return "just now"
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}
