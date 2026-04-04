"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, TrendingDown, AlertTriangle, Lightbulb, ArrowRight } from "lucide-react"
import { scoreRows } from "./ad-performance"
import { DEFAULT_TARGETS, mergeTargets, deriveTargets, evaluateKpi, type KpiTargets } from "@/lib/clients/targets"
import type { KpiResult, UtmRow } from "@/lib/clients/kpis"

type ScoredRow = UtmRow & {
  takenCallRate: number
  bookingRate: number
  dealRate: number
  reliability: "high" | "medium" | "low"
  category: "winner" | "sniper" | "fake" | "garbage"
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

function fmtEur(n: number) {
  return `€${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function fmtNum(n: number) {
  return n.toLocaleString("en-GB", { maximumFractionDigits: 2 })
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDateRange(days: number) {
  const now = new Date()
  const end = toISO(now)
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  return { startDate: toISO(start), endDate: end }
}

function useTimeframeKpis(
  mondayItemId: string,
  metaAdAccountId: string | null,
  clientBoardId: string | null,
  selectedCampaignIds: string[],
  days: number,
) {
  const { startDate, endDate } = useMemo(() => getDateRange(days), [days])

  return useQuery<KpiResult>({
    queryKey: ["optimization-kpis", mondayItemId, days, selectedCampaignIds],
    queryFn: () => {
      const p = new URLSearchParams({
        startDate,
        endDate,
        ...(metaAdAccountId ? { adAccountId: metaAdAccountId } : {}),
        ...(clientBoardId ? { clientBoardId } : {}),
        ...(selectedCampaignIds.length > 0 ? { selectedCampaignIds: selectedCampaignIds.join(",") } : {}),
      })
      return fetch(`/api/clients/${mondayItemId}/kpis?${p}`).then((r) => r.json())
    },
    enabled: !!mondayItemId,
    staleTime: 5 * 60 * 1000,
  })
}

// ---- Insight generation ----

type Insight = {
  type: "positive" | "warning" | "critical" | "action"
  title: string
  body: string
}

function pctChange(current: number, baseline: number): number {
  if (!baseline || !isFinite(baseline)) return 0
  return ((current - baseline) / baseline) * 100
}

function generateKpiInsights(
  kpis7d: KpiResult | null,
  kpis14d: KpiResult | null,
  kpis30d: KpiResult | null,
  targets: KpiTargets,
  hasCrm: boolean,
): Insight[] {
  const insights: Insight[] = []
  if (!kpis7d) return insights

  const has30d = kpis30d && kpis30d.adSpend > 0
  const has14d = kpis14d && kpis14d.adSpend > 0

  // 1. CPL trend analysis
  if (kpis7d.leads > 0 && has30d && kpis30d.leads > 0) {
    const cplChange = pctChange(kpis7d.costPerLead, kpis30d.costPerLead)
    const cplStatus = evaluateKpi("costPerLead", kpis7d.costPerLead, targets)

    if (cplChange > 30) {
      insights.push({
        type: "critical",
        title: `CPL increased ${cplChange.toFixed(0)}% vs 30-day average`,
        body: `Cost per lead is €${fmtNum(kpis7d.costPerLead)} (7d) vs €${fmtNum(kpis30d.costPerLead)} (30d). This is a significant spike. Possible causes: creative fatigue, audience saturation, or seasonal competition. Consider launching new creatives with fresh marketing angles and testing new hooks.`,
      })
    } else if (cplChange > 15) {
      insights.push({
        type: "warning",
        title: `CPL trending up — +${cplChange.toFixed(0)}% vs 30-day average`,
        body: `Cost per lead rose from €${fmtNum(kpis30d.costPerLead)} to €${fmtNum(kpis7d.costPerLead)}. Not alarming yet, but monitor closely. If this continues, prepare new creatives and test different ad copy variations.`,
      })
    } else if (cplChange < -15 && cplStatus === "green") {
      insights.push({
        type: "positive",
        title: `CPL down ${Math.abs(cplChange).toFixed(0)}% — strong performance`,
        body: `Cost per lead dropped to €${fmtNum(kpis7d.costPerLead)} from €${fmtNum(kpis30d.costPerLead)}. The current creatives are performing well. Consider scaling budget by up to 20% per day to capture more of this efficient traffic.`,
      })
    }

    if (cplStatus === "red" && cplChange <= 15) {
      insights.push({
        type: "critical",
        title: `CPL above target (€${fmtNum(kpis7d.costPerLead)})`,
        body: `Cost per lead exceeds the target threshold. Priority actions: 1) Review and refresh creatives — creatives are the most important lever, not targeting or ad copy. 2) Test new marketing angles based on what works in the industry. 3) Check if landing page conversion rate has dropped.`,
      })
    }
  }

  // 2. Lead volume trend
  if (kpis7d.adSpend > 0 && has30d && kpis30d.leads > 0) {
    const dailyLeads7d = kpis7d.leads / 7
    const dailyLeads30d = kpis30d.leads / 30
    const volumeChange = pctChange(dailyLeads7d, dailyLeads30d)

    if (volumeChange < -40 && kpis7d.leads < 5) {
      insights.push({
        type: "critical",
        title: `Lead volume dropped ${Math.abs(volumeChange).toFixed(0)}% — only ${kpis7d.leads} leads in 7 days`,
        body: `Daily lead volume went from ${dailyLeads30d.toFixed(1)} to ${dailyLeads7d.toFixed(1)} per day. Check if campaigns are still active and spending. If budget is being spent but leads are down, the creative or landing page may need attention.`,
      })
    } else if (volumeChange < -25) {
      insights.push({
        type: "warning",
        title: `Lead volume declining — ${Math.abs(volumeChange).toFixed(0)}% fewer leads per day`,
        body: `Average daily leads dropped from ${dailyLeads30d.toFixed(1)} to ${dailyLeads7d.toFixed(1)}. This could indicate creative fatigue or increased competition. Schedule a creative refresh with new marketing angles.`,
      })
    }
  }

  // 3. Spend without leads
  if (kpis7d.adSpend > 100 && kpis7d.leads === 0) {
    insights.push({
      type: "critical",
      title: `€${fmtNum(kpis7d.adSpend)} spent with zero leads in 7 days`,
      body: `Budget is being spent but no leads are coming in. Check: 1) Is the landing page working and loading correctly? 2) Is the form/lead capture functional? 3) Are campaigns targeting the right audience? 4) Consider pausing and rebuilding if this persists.`,
    })
  }

  // 4. CRM-based insights (only when Monday data exists)
  if (hasCrm && kpis7d.leads > 0) {
    // QR% check
    if (kpis7d.qrPercent > 0 && has30d && kpis30d.qrPercent > 0) {
      const qrStatus = evaluateKpi("qrPercent", kpis7d.qrPercent, targets)
      if (qrStatus === "red") {
        insights.push({
          type: "warning",
          title: `Qualification rate low at ${kpis7d.qrPercent.toFixed(1)}%`,
          body: `Only ${kpis7d.qrPercent.toFixed(1)}% of leads convert to appointments. This suggests lead quality issues. Consider: adding qualification questions to the form, adjusting the marketing angle to attract more serious prospects, or refining the landing page copy to better pre-qualify visitors.`,
        })
      }
    }

    // Show-up rate
    if (kpis7d.bookedCalls > 0 && kpis7d.suPercent > 0) {
      const suStatus = evaluateKpi("suPercent", kpis7d.suPercent, targets)
      if (suStatus === "red") {
        insights.push({
          type: "warning",
          title: `Show-up rate critically low (${kpis7d.suPercent.toFixed(1)}%)`,
          body: `Too many booked appointments are not showing up. Improve follow-up: ensure the automated WhatsApp confirmation and reminder sequences are working. Consider adding a same-day reminder. The follow-up loop should have 11 contact moments within 48 hours.`,
        })
      } else if (suStatus === "orange") {
        insights.push({
          type: "warning",
          title: `Show-up rate below target (${kpis7d.suPercent.toFixed(1)}%)`,
          body: `Show-up rate is trending below the ideal ${targets.su.green}%. Review the follow-up automation and consider adding extra touchpoints (SMS, email) to reduce no-shows.`,
        })
      }
    }

    // CR% check
    if (kpis7d.takenCalls >= 3) {
      const crStatus = evaluateKpi("crPercent", kpis7d.crPercent, targets)
      if (crStatus === "red" || crStatus === "orange") {
        insights.push({
          type: "warning",
          title: `Close rate at ${kpis7d.crPercent.toFixed(1)}% — below target`,
          body: `${kpis7d.takenCalls} appointments taken but only ${kpis7d.deals} deals closed. This is a sales-side issue, not marketing. Review: are the right leads reaching the sales team? Is the proposition clear? Consider adjusting the landing page to better set expectations.`,
        })
      }
    }

    // Cost per deal
    if (kpis7d.deals > 0) {
      const cpdStatus = evaluateKpi("costPerDeal", kpis7d.costPerDeal, targets)
      if (cpdStatus === "green" && kpis7d.roi >= 2) {
        insights.push({
          type: "positive",
          title: `Strong ROI: ${kpis7d.roi.toFixed(1)}x return on ad spend`,
          body: `Generating €${fmtNum(kpis7d.revenue)} revenue on €${fmtNum(kpis7d.adSpend)} spend with a cost per deal of €${fmtNum(kpis7d.costPerDeal)}. The funnel is profitable — consider scaling budget by 20% per day to grow revenue.`,
        })
      }
    }
  }

  // 5. Budget utilization
  if (kpis7d.adSpend > 0 && has14d && kpis14d.adSpend > 0) {
    const dailySpend7d = kpis7d.adSpend / 7
    const dailySpend14d = kpis14d.adSpend / 14
    const spendChange = pctChange(dailySpend7d, dailySpend14d)

    if (spendChange < -30) {
      insights.push({
        type: "warning",
        title: `Daily spend dropped ${Math.abs(spendChange).toFixed(0)}%`,
        body: `Average daily spend went from €${fmtNum(dailySpend14d)} to €${fmtNum(dailySpend7d)}. Check if budget limits were hit, payment methods are valid, or if campaigns were paused unintentionally.`,
      })
    }
  }

  // 6. General action items based on data availability
  if (insights.length === 0 && kpis7d.adSpend > 0 && kpis7d.leads > 0) {
    const cplStatus = evaluateKpi("costPerLead", kpis7d.costPerLead, targets)
    if (cplStatus === "green") {
      insights.push({
        type: "positive",
        title: "Performance on track",
        body: `CPL at €${fmtNum(kpis7d.costPerLead)} with ${kpis7d.leads} leads in the past 7 days. All metrics within target range. Continue current approach and prepare next month's creative refresh to maintain momentum.`,
      })
    } else {
      insights.push({
        type: "action",
        title: "Monthly creative refresh recommended",
        body: `Campaign is running steadily. Creatives are the most important lever for performance on Meta — plan new creatives and test different marketing angles. Even stable campaigns benefit from monthly refreshes to prevent creative fatigue.`,
      })
    }
  }

  return insights
}

function generateUtmInsights(
  kpis7d: KpiResult | null,
  kpis30d: KpiResult | null,
): Insight[] {
  const insights: Insight[] = []
  if (!kpis7d || !kpis30d) return insights

  const scored7d = scoreRows(kpis7d.utmBreakdown ?? [])
  const scored30d = scoreRows(kpis30d.utmBreakdown ?? [])
  if (!scored7d || scored7d.length === 0) return insights

  // Find winners and losers from 7d
  const winners = scored7d.filter((r) => (r.category === "winner" || r.category === "sniper") && r.takenCalls >= 1)
  const losers = scored7d.filter((r) => (r.category === "fake" || r.category === "garbage") && r.leads >= 3)

  if (winners.length > 0) {
    const top = winners.sort((a, b) => b.takenCalls - a.takenCalls)[0]
    insights.push({
      type: "positive",
      title: `Top performing ad: ${top.utm}`,
      body: `${top.takenCalls} taken appointment${top.takenCalls !== 1 ? "s" : ""} from ${top.leads} leads (${fmtPct(top.takenCallRate)} rate) in the past 7 days.${top.deals > 0 ? ` ${top.deals} deal${top.deals !== 1 ? "s" : ""} closed${top.revenue > 0 ? ` (${fmtEur(top.revenue)})` : ""}.` : ""} Scale budget on this ad by up to 20% per day.`,
    })
  }

  if (losers.length > 0) {
    const worst = losers.sort((a, b) => b.leads - a.leads)[0]
    insights.push({
      type: "critical",
      title: `Underperforming ad: ${worst.utm}`,
      body: `${worst.leads} leads but only ${worst.takenCalls} taken appointment${worst.takenCalls !== 1 ? "s" : ""} (${fmtPct(worst.takenCallRate)} rate). ${worst.category === "fake" ? "High volume of unqualified leads is inflating cost per appointment." : "Neither volume nor quality justifies continued spend."} Consider pausing or replacing with a new creative.`,
    })
  }

  // Diversity check
  if (scored7d.length <= 2) {
    insights.push({
      type: "action",
      title: "Low creative diversity — only " + scored7d.length + " active ad(s)",
      body: "Best practice is 4-5 active ads per ad set. Add more creatives with different marketing angles and hooks to test against the current ones. More variation means more data and faster optimization.",
    })
  }

  return insights
}

// ---- Component ----

const INSIGHT_STYLES: Record<Insight["type"], { icon: typeof TrendingUp; border: string; bg: string; iconColor: string }> = {
  positive: { icon: TrendingUp, border: "border-green-500/20", bg: "bg-green-500/5", iconColor: "text-green-500" },
  warning: { icon: AlertTriangle, border: "border-amber-500/20", bg: "bg-amber-500/5", iconColor: "text-amber-500" },
  critical: { icon: TrendingDown, border: "border-red-500/20", bg: "bg-red-500/5", iconColor: "text-red-500" },
  action: { icon: Lightbulb, border: "border-primary/20", bg: "bg-primary/5", iconColor: "text-primary" },
}

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  selectedCampaignIds: string[]
}

export function OptimizationProposal({ mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds }: Props) {
  const q7d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 7)
  const q14d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 14)
  const q30d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 30)

  const targetsQuery = useQuery<{ global: KpiTargets; overrides: Partial<KpiTargets> | null }>({
    queryKey: ["target-overrides", mondayItemId],
    queryFn: () => fetch(`/api/clients/${mondayItemId}/target-overrides`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const targets = useMemo(() => {
    const global = targetsQuery.data?.global ?? DEFAULT_TARGETS
    return deriveTargets(mergeTargets(global, targetsQuery.data?.overrides))
  }, [targetsQuery.data])

  const queries = [q7d, q14d, q30d]
  const isLoading = queries.some((q) => q.isLoading) || targetsQuery.isLoading
  const allFailed = queries.every((q) => q.isError)

  const hasCrm = !!clientBoardId

  const insights = useMemo(() => {
    if (!q7d.data) return []

    const kpiInsights = generateKpiInsights(q7d.data, q14d.data ?? null, q30d.data ?? null, targets, hasCrm)
    const utmInsights = generateUtmInsights(q7d.data, q30d.data ?? null)

    // Deduplicate by title, KPI insights first
    const all = [...kpiInsights, ...utmInsights]
    const seen = new Set<string>()
    return all.filter((insight) => {
      if (seen.has(insight.title)) return false
      seen.add(insight.title)
      return true
    })
  }, [q7d.data, q14d.data, q30d.data, targets, hasCrm])

  if (allFailed) return null

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-96 mt-1" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  // Show proposal as long as we have ANY data (adSpend or leads)
  const kpis7d = q7d.data
  const hasAnyData = kpis7d && (kpis7d.adSpend > 0 || kpis7d.leads > 0)
  if (!hasAnyData) return null

  const kpis30d = q30d.data

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Campaign Optimisation Proposal</CardTitle>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            {insights.filter((i) => i.type === "critical").length > 0
              ? "Action required"
              : insights.filter((i) => i.type === "warning").length > 0
              ? "Monitor"
              : "On track"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Based on 7-day performance vs 30-day baseline.
          {kpis7d.adSpend > 0 && ` 7d spend: ${fmtEur(kpis7d.adSpend)}.`}
          {kpis7d.leads > 0 && ` 7d leads: ${kpis7d.leads}.`}
          {kpis30d && kpis30d.roi > 0 && ` 30d ROI: ${kpis30d.roi.toFixed(2)}x.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {insights.map((insight, i) => {
          const style = INSIGHT_STYLES[insight.type]
          const Icon = style.icon
          return (
            <div key={i} className={`rounded-lg border ${style.border} ${style.bg} px-4 py-3`}>
              <div className="flex items-start gap-3">
                <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${style.iconColor}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{insight.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{insight.body}</p>
                </div>
              </div>
            </div>
          )
        })}

        {insights.length === 0 && (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
            <div className="flex items-start gap-3">
              <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Not enough data yet to generate specific recommendations. Keep campaigns running to build a performance baseline.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
