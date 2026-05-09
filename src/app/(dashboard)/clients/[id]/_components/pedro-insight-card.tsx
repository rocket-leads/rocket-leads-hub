"use client"

import { useQuery } from "@tanstack/react-query"
import { Sparkles, Target, MessageCircle } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import type { PedroClientInsightsResponse } from "@/app/api/clients/[id]/pedro-insights/route"

type Props = {
  mondayItemId: string
}

/**
 * Pedro insight card — surfaces the unified per-client AI insights from
 * pedro_insights. Renders client_overview as the headline paragraph and
 * client_optimisation_summary + client_lead_quality_summary as side panels.
 *
 * Hidden entirely when no insights exist yet (cron hasn't reached this
 * client, or client is in no-data bucket). The point is to make the
 * unification VISIBLE — the same Pedro voice the user sees on the Watch
 * List action note also lives here on the client page, no contradictions.
 */
export function PedroInsightCard({ mondayItemId }: Props) {
  const { data, isLoading } = useQuery<PedroClientInsightsResponse>({
    queryKey: ["pedro-insights", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/pedro-insights`).then((r) => r.json()),
    enabled: !!mondayItemId,
    staleTime: 5 * 60 * 1000, // 5 min — cron only writes hourly
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

  const overview = data?.insights?.client_overview
  const optimisation = data?.insights?.client_optimisation_summary
  const leadQuality = data?.insights?.client_lead_quality_summary

  // Nothing to show — hide the card entirely rather than render an
  // empty shell. The unification value is "Pedro speaks consistently
  // across surfaces", not "Pedro shows you a placeholder".
  if (!overview && !optimisation && !leadQuality) return null

  // Show the freshest stamp out of the three — gives the user a single
  // "as of X" anchor without surfacing per-tile timestamps that compete
  // visually with the actual content.
  const freshestAt = [overview?.generatedAt, optimisation?.generatedAt, leadQuality?.generatedAt]
    .filter((t): t is string => !!t)
    .sort()
    .reverse()[0]

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.03] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          <span className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold">
            Pedro
          </span>
        </div>
        {freshestAt && (
          <span
            className="text-[10px] text-muted-foreground/50 tabular-nums"
            title={`Generated ${new Date(freshestAt).toLocaleString("en-GB")}`}
          >
            {timeAgo(freshestAt)}
          </span>
        )}
      </div>

      {overview && (
        <p className="text-sm text-foreground/85 leading-relaxed">{overview.body}</p>
      )}

      {(optimisation || leadQuality) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-2 border-t border-violet-500/10">
          {optimisation && (
            <InsightTile
              icon={<Target className="h-3 w-3 text-violet-400" />}
              label="Next move"
              body={optimisation.body}
            />
          )}
          {leadQuality && (
            <InsightTile
              icon={<MessageCircle className="h-3 w-3 text-violet-400" />}
              label="Lead quality"
              body={leadQuality.body}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Compact "X ago" rendering — same buckets the inbox uses elsewhere. */
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

function InsightTile({
  icon,
  label,
  body,
}: {
  icon: React.ReactNode
  label: string
  body: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
          {label}
        </span>
      </div>
      <p className="text-xs text-foreground/75 leading-snug">{body}</p>
    </div>
  )
}
