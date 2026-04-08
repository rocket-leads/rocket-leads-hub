"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, TrendingDown, AlertTriangle, Lightbulb, Sparkles, RefreshCw } from "lucide-react"
import type { KpiResult } from "@/lib/clients/kpis"
import type { ScoredRow } from "./ad-performance"

type Insight = {
  type: "positive" | "warning" | "critical" | "action"
  title: string
  body: string
}

const INSIGHT_STYLES: Record<Insight["type"], { icon: typeof TrendingUp; border: string; bg: string; iconColor: string }> = {
  positive: { icon: TrendingUp, border: "border-green-500/20", bg: "bg-green-500/5", iconColor: "text-green-500" },
  warning: { icon: AlertTriangle, border: "border-amber-500/20", bg: "bg-amber-500/5", iconColor: "text-amber-500" },
  critical: { icon: TrendingDown, border: "border-red-500/20", bg: "bg-red-500/5", iconColor: "text-red-500" },
  action: { icon: Lightbulb, border: "border-primary/20", bg: "bg-primary/5", iconColor: "text-primary" },
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
  const { startDate, endDate } = getDateRange(days)

  return useQuery<KpiResult>({
    queryKey: ["ai-opt-kpis", mondayItemId, days, selectedCampaignIds],
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

function fmtPct(n: number) {
  return `${(n * 100).toFixed(0)}%`
}

function fmtEur(n: number) {
  return `€${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function ReliabilityBadge({ level }: { level: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-green-500/15 text-green-600 dark:text-green-400",
    medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    low: "bg-muted text-muted-foreground",
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[level]}`}>
      {level === "high" ? "Reliable" : level === "medium" ? "Limited data" : "Low data"}
    </span>
  )
}

function ScoredProposalSection({ scored, kpis }: { scored: ScoredRow[]; kpis: KpiResult }) {
  const scale = scored.filter(
    (r) => (r.category === "winner" || r.category === "sniper") && r.takenCalls >= 1
  ).sort((a, b) => b.takenCalls - a.takenCalls)

  const reduce = scored.filter(
    (r) => (r.category === "fake" || r.category === "garbage") && r.leads >= 3
  ).sort((a, b) => b.leads - a.leads)

  const monitor = scored.filter(
    (r) =>
      (r.category === "winner" || r.category === "sniper") && r.takenCalls === 0 ||
      r.reliability === "low"
  )

  if (scale.length === 0 && reduce.length === 0 && monitor.length === 0) return null

  return (
    <div className="space-y-4">
      {scale.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-sm font-medium">Increase budget</span>
          </div>
          <div className="space-y-2">
            {scale.map((r) => (
              <div key={r.utm} className="rounded-md border border-green-500/20 bg-green-500/5 pl-4 pr-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                  <ReliabilityBadge level={r.reliability} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.category === "winner"
                    ? `All-round performer — ${r.takenCalls} taken calls (${fmtPct(r.takenCallRate)} rate), ${r.leads} leads. ${
                        r.reliability === "low"
                          ? "Scale cautiously — limited data so far."
                          : "Strong across both volume and quality. Scale with confidence."
                      }`
                    : `Sniper — low opt-in volume but ${fmtPct(r.takenCallRate)} taken call rate. ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""}. ${
                        r.reliability === "low"
                          ? "Promising early signal — scale modestly to gather more data before committing."
                          : "Reliable signal. Scale budget to capture more of this high-quality traffic."
                      }`}
                  {r.deals > 0 && ` ${r.deals} deal${r.deals !== 1 ? "s" : ""} closed${r.revenue > 0 ? ` (${fmtEur(r.revenue)})` : ""}.`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {reduce.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-sm font-medium">Decrease budget</span>
          </div>
          <div className="space-y-2">
            {reduce.map((r) => (
              <div key={r.utm} className="rounded-md border border-red-500/20 bg-red-500/5 pl-4 pr-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                  <ReliabilityBadge level={r.reliability} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.category === "fake"
                    ? `Fake winner — ${r.leads} opt-ins but only ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""} (${fmtPct(r.takenCallRate)} rate). High volume of unqualified leads is inflating cost per taken call.`
                    : `Low performer — ${r.leads} leads, ${r.takenCalls} taken call${r.takenCalls !== 1 ? "s" : ""}. Neither volume nor quality justifies continued spend.`}
                  {r.deals > 0
                    ? ` ${r.deals} deal${r.deals !== 1 ? "s" : ""} closed — monitor before cutting entirely.`
                    : " No deals closed in this period."}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {monitor.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-sm font-medium">Monitor — insufficient data</span>
          </div>
          <div className="space-y-1">
            {monitor.map((r) => (
              <div key={r.utm} className="flex items-center justify-between gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 pl-4 pr-3 py-2">
                <span className="font-mono text-xs break-all text-foreground">{r.utm}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{r.leads} leads · {r.takenCalls} taken</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  selectedCampaignIds: string[]
  clientName: string
  boardType: "onboarding" | "current"
  scored: ScoredRow[] | null
  kpis: KpiResult | null
}

export function CampaignOptimizationProposal({ mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, clientName, boardType, scored, kpis }: Props) {
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasKnowledge, setHasKnowledge] = useState(false)
  const hasAutoGenerated = useRef(false)

  const q7d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 7)
  const q14d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 14)
  const q30d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 30)

  const isKpiLoading = q7d.isLoading || q14d.isLoading || q30d.isLoading
  const hasCrm = !!clientBoardId
  const hasAnyData = q7d.data && (q7d.data.adSpend > 0 || q7d.data.leads > 0)

  async function generate() {
    if (!q7d.data) return
    setLoading(true)
    setError(null)

    // Sync knowledge first
    try {
      await fetch(`/api/clients/${mondayItemId}/knowledge`, { method: "POST" })
    } catch {
      // Continue even if sync fails
    }

    // Fetch lead feedback + ad details in parallel
    const { startDate, endDate } = getDateRange(30)
    const adDetailParams = new URLSearchParams({
      startDate,
      endDate,
      ...(metaAdAccountId ? { adAccountId: metaAdAccountId } : {}),
      ...(selectedCampaignIds.length > 0 ? { selectedCampaignIds: selectedCampaignIds.join(",") } : {}),
    })

    const [feedbackResult, adDetailsResult] = await Promise.all([
      clientBoardId
        ? fetch(`/api/clients/${mondayItemId}/lead-feedback?clientBoardId=${clientBoardId}`)
            .then((r) => r.ok ? r.json() : { feedback: [] })
            .catch(() => ({ feedback: [] }))
        : Promise.resolve({ feedback: [] }),
      metaAdAccountId
        ? fetch(`/api/clients/${mondayItemId}/ad-details?${adDetailParams}`)
            .then((r) => r.ok ? r.json() : { ads: [] })
            .catch(() => ({ ads: [] }))
        : Promise.resolve({ ads: [] }),
    ])

    const leadFeedback = feedbackResult.feedback ?? []
    const adDetails = adDetailsResult.ads ?? []

    try {
      const res = await fetch(`/api/clients/${mondayItemId}/optimization-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          boardType,
          kpis7d: q7d.data,
          kpis14d: q14d.data ?? null,
          kpis30d: q30d.data ?? null,
          hasCrm,
          leadFeedback,
          adDetails,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to generate proposal")
      }

      const data = await res.json()
      setInsights(data.insights)
      setHasKnowledge(data.hasKnowledge)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate proposal")
    } finally {
      setLoading(false)
    }
  }

  // Auto-generate when KPI data becomes available
  useEffect(() => {
    if (!isKpiLoading && hasAnyData && !hasAutoGenerated.current && !insights && !loading) {
      hasAutoGenerated.current = true
      generate()
    }
  }, [isKpiLoading, hasAnyData]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isKpiLoading && !scored) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-3 w-96 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!hasAnyData && !scored) return null

  const hasRoi = kpis && kpis.roi > 0

  const statusBadge = insights
    ? insights.filter((i) => i.type === "critical").length > 0
      ? "Action required"
      : insights.filter((i) => i.type === "warning").length > 0
      ? "Monitor"
      : "On track"
    : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Campaign Optimisation Proposal</CardTitle>
            {statusBadge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {statusBadge}
              </span>
            )}
            {insights && (
              <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-500 flex items-center gap-1">
                <Sparkles className="h-2.5 w-2.5" />
                AI{hasKnowledge ? " + Knowledge" : ""}
              </span>
            )}
          </div>
          {hasAnyData && (
            <button
              onClick={generate}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </>
              )}
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Ad performance scoring + AI-powered insights using KPI trends, ad data{hasKnowledge ? ", client knowledge base" : ""} and the Rocket Leads framework.
          {hasRoi && ` Overall ROI: ${kpis.roi.toFixed(2)}x (${fmtEur(kpis.revenue)} revenue on ${fmtEur(kpis.adSpend)} spend).`}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rule-based ad scoring section */}
        {scored && kpis && <ScoredProposalSection scored={scored} kpis={kpis} />}

        {/* Divider between sections when both exist */}
        {scored && kpis && (insights || loading) && (
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              <span className="text-sm font-medium">AI Insights</span>
            </div>
          </div>
        )}

        {/* AI-generated insights */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}

        {loading && !insights && (
          <div className="space-y-2.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-4 w-4 shrink-0 mt-0.5 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {insights && (
          <div className="space-y-2.5">
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
