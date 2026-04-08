"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TrendingUp, TrendingDown, AlertTriangle, Lightbulb, Sparkles, RefreshCw } from "lucide-react"
import type { KpiResult } from "@/lib/clients/kpis"

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

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  selectedCampaignIds: string[]
  clientName: string
  boardType: "onboarding" | "current"
}

export function AiOptimizationProposal({ mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, clientName, boardType }: Props) {
  const [insights, setInsights] = useState<Insight[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasKnowledge, setHasKnowledge] = useState(false)

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
        throw new Error(err.error || "Failed to generate AI proposal")
      }

      const data = await res.json()
      setInsights(data.insights)
      setHasKnowledge(data.hasKnowledge)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate AI proposal")
    } finally {
      setLoading(false)
    }
  }

  if (isKpiLoading) {
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

  if (!hasAnyData) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">AI Optimisation Proposal</CardTitle>
            {insights && (
              <>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {insights.filter((i) => i.type === "critical").length > 0
                    ? "Action required"
                    : insights.filter((i) => i.type === "warning").length > 0
                    ? "Monitor"
                    : "On track"}
                </span>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-500 flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  AI{hasKnowledge ? " + Knowledge" : ""}
                </span>
              </>
            )}
          </div>
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
            ) : insights ? (
              <>
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                Generate AI Proposal
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1">
          {insights
            ? `AI-generated using KPI data${hasKnowledge ? " + client knowledge base (Monday notes, Drive docs)" : ""}.`
            : "Uses KPI trends + client knowledge base (Monday notes, Google Drive docs) for personalized recommendations."}
        </p>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}

        {insights ? (
          insights.map((insight, i) => {
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
          })
        ) : !loading ? (
          <div className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
            <div className="flex items-start gap-3">
              <Sparkles className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">
                Click &ldquo;Generate AI Proposal&rdquo; to get personalized optimization recommendations based on this client&apos;s KPI data and knowledge base.
              </p>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
