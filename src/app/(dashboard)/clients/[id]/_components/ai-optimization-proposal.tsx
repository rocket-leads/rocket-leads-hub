"use client"

import { useState, useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { BarChart3, Sparkles, Lightbulb, RefreshCw, Clock, ChevronDown, PauseCircle, Palette, Compass, SlidersHorizontal, Wrench } from "lucide-react"
import type { KpiResult } from "@/lib/clients/kpis"

type ProposalCategory = "creative" | "pause" | "angle" | "funnel" | "other"

type Proposal = {
  category: ProposalCategory
  title: string
  detail?: string
}

const CATEGORY_CONFIG: Record<ProposalCategory, { icon: typeof Lightbulb; label: string; color: string }> = {
  creative: { icon: Palette, label: "Creative", color: "text-violet-400" },
  pause: { icon: PauseCircle, label: "Pause", color: "text-red-400" },
  angle: { icon: Compass, label: "New Angle", color: "text-amber-400" },
  funnel: { icon: SlidersHorizontal, label: "Funnel", color: "text-blue-400" },
  other: { icon: Wrench, label: "Optimise", color: "text-muted-foreground" },
}

type LeadAnalysisVerdict = "good" | "neutral" | "concerning"

type LeadAnalysisSection = {
  verdict: LeadAnalysisVerdict
  headline: string
  detail: string
  patterns?: string[]
}

type LeadAnalysis = {
  quantity: LeadAnalysisSection
  quality: LeadAnalysisSection
}

const VERDICT_STYLES: Record<LeadAnalysisVerdict, { label: string; pill: string; border: string; bg: string }> = {
  good: {
    label: "Good",
    pill: "bg-green-500/10 text-green-500",
    border: "border-green-500/20",
    bg: "bg-green-500/5",
  },
  neutral: {
    label: "Neutral",
    pill: "bg-amber-500/10 text-amber-500",
    border: "border-amber-500/20",
    bg: "bg-amber-500/5",
  },
  concerning: {
    label: "Concerning",
    pill: "bg-red-500/10 text-red-500",
    border: "border-red-500/20",
    bg: "bg-red-500/5",
  },
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const [expanded, setExpanded] = useState(false)
  const config = CATEGORY_CONFIG[proposal.category] ?? CATEGORY_CONFIG.other
  const Icon = config.icon

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 flex flex-col items-center gap-1">
          <Icon className={`h-4 w-4 ${config.color}`} />
          <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/40">{config.label}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{proposal.title}</p>
          {proposal.detail && expanded && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed mt-2 border-t border-border/20 pt-2">
              {proposal.detail}
            </p>
          )}
        </div>
        {proposal.detail && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 mt-0.5 text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
    </div>
  )
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

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

function LeadAnalysisSectionRow({
  label,
  icon: Icon,
  section,
}: {
  label: string
  icon: typeof BarChart3
  section: LeadAnalysisSection
}) {
  const v = VERDICT_STYLES[section.verdict]
  return (
    <div className={`rounded-lg border ${v.border} ${v.bg} px-4 py-3`}>
      <div className="flex items-start gap-3">
        <Icon className="h-4 w-4 shrink-0 mt-1 text-muted-foreground" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{label}</span>
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${v.pill}`}>
              {v.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug">{section.headline}</p>
          {section.detail && (
            <p className="text-xs text-muted-foreground leading-relaxed">{section.detail}</p>
          )}
          {section.patterns && section.patterns.length > 0 && (
            <ul className="space-y-1 pt-1">
              {section.patterns.map((p, i) => (
                <li key={i} className="text-xs text-muted-foreground/80 leading-snug flex gap-1.5">
                  <span className="text-muted-foreground/40">•</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function LeadAnalysisCard({
  leadAnalysis,
  loading,
  generatedAt,
}: {
  leadAnalysis: LeadAnalysis | null
  loading: boolean
  generatedAt: Date | null
}) {
  if (!leadAnalysis && !loading) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Lead Analysis
          </CardTitle>
          {generatedAt && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
              <Clock className="h-2.5 w-2.5" />
              {timeAgo(generatedAt)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Cost efficiency (CPL/CPA vs baseline) and lead quality (Monday update sentiment)
        </p>
      </CardHeader>
      <CardContent>
        {loading && !leadAnalysis ? (
          <div className="space-y-2.5">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="rounded-lg border border-border/30 bg-muted/10 px-4 py-3">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-4 w-4 shrink-0 mt-0.5 rounded" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : leadAnalysis ? (
          <div className="space-y-2">
            <LeadAnalysisSectionRow label="Quantity" icon={BarChart3} section={leadAnalysis.quantity} />
            <LeadAnalysisSectionRow label="Quality" icon={Sparkles} section={leadAnalysis.quality} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

type Props = {
  mondayItemId: string
  metaAdAccountId: string | null
  clientBoardId: string | null
  selectedCampaignIds: string[]
  clientName: string
  boardType: "onboarding" | "current"
}

export function CampaignAnalysis({ mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, clientName, boardType }: Props) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [leadAnalysis, setLeadAnalysis] = useState<LeadAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setHasKnowledge] = useState(false)
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)
  const [cacheChecked, setCacheChecked] = useState(false)
  const hasAutoGenerated = useRef(false)
  const cacheCheckStarted = useRef(false)

  const q7d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 7)
  const q14d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 14)
  const q30d = useTimeframeKpis(mondayItemId, metaAdAccountId, clientBoardId, selectedCampaignIds, 30)

  const isKpiLoading = q7d.isLoading || q14d.isLoading || q30d.isLoading
  const hasCrm = !!clientBoardId
  const hasAnyData = q7d.data && (q7d.data.adSpend > 0 || q7d.data.leads > 0)

  // Try cached proposal first
  useEffect(() => {
    if (cacheCheckStarted.current) return
    cacheCheckStarted.current = true
    ;(async () => {
      try {
        const res = await fetch(`/api/clients/${mondayItemId}/optimization-proposal`)
        if (res.ok) {
          const data = await res.json()
          if (data.cached && Array.isArray(data.proposals)) {
            setProposals(data.proposals)
            setLeadAnalysis(data.leadAnalysis ?? null)
            setHasKnowledge(!!data.hasKnowledge)
            setGeneratedAt(data.generatedAt ? new Date(data.generatedAt) : new Date())
            hasAutoGenerated.current = true
          }
        }
      } catch {
        // fall back to generate
      } finally {
        setCacheChecked(true)
      }
    })()
  }, [mondayItemId])

  async function generate(force = false) {
    if (!q7d.data) return
    setLoading(true)
    setError(null)

    // Sync knowledge
    try {
      await fetch(`/api/clients/${mondayItemId}/knowledge`, { method: "POST" })
    } catch {}

    // Fetch lead feedback + ad details
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

    try {
      const url = `/api/clients/${mondayItemId}/optimization-proposal${force ? "?force=1" : ""}`
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          boardType,
          kpis7d: q7d.data,
          kpis14d: q14d.data ?? null,
          kpis30d: q30d.data ?? null,
          hasCrm,
          leadFeedback: feedbackResult.feedback ?? [],
          adDetails: adDetailsResult.ads ?? [],
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Failed to generate analysis")
      }

      const data = await res.json()
      setProposals(data.proposals)
      setLeadAnalysis(data.leadAnalysis ?? null)
      setHasKnowledge(data.hasKnowledge)
      setGeneratedAt(data.generatedAt ? new Date(data.generatedAt) : new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate analysis")
    } finally {
      setLoading(false)
    }
  }

  // Auto-generate when no cache and KPI data ready
  useEffect(() => {
    if (!cacheChecked) return
    if (!isKpiLoading && hasAnyData && !hasAutoGenerated.current && !proposals && !loading) {
      hasAutoGenerated.current = true
      generate()
    }
  }, [cacheChecked, isKpiLoading, hasAnyData]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isKpiLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-3 w-80 mt-1" />
          </CardHeader>
          <CardContent><Skeleton className="h-16 w-full" /></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-96 mt-1" />
          </CardHeader>
          <CardContent><Skeleton className="h-16 w-full" /></CardContent>
        </Card>
      </div>
    )
  }

  if (!hasAnyData) return null

  return (
    <div className="space-y-4">
      <LeadAnalysisCard
        leadAnalysis={leadAnalysis}
        loading={loading}
        generatedAt={generatedAt}
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              Optimisation Proposals
            </CardTitle>
            <div className="flex items-center gap-2">
              {generatedAt && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
                  <Clock className="h-2.5 w-2.5" />
                  {timeAgo(generatedAt)}
                </span>
              )}
              {hasAnyData && (
                <button
                  onClick={() => generate(true)}
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
          </div>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Concrete actions to execute
          </p>
        </CardHeader>

        <CardContent>
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {loading && !proposals && (
            <div className="space-y-2.5">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
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

          {proposals && proposals.length > 0 && (
            <div className="space-y-2">
              {proposals.map((proposal, i) => (
                <ProposalCard key={i} proposal={proposal} />
              ))}
            </div>
          )}

          {proposals && proposals.length === 0 && (
            <p className="text-xs text-muted-foreground/50 italic">No actionable proposals at this time.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export { CampaignAnalysis as CampaignOptimizationProposal }
