"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { Sparkles, RefreshCw, ExternalLink, AlertCircle, Calendar, TrendingDown, TrendingUp, Minus } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Pedro tab on the client detail page. Shows what Pedro has done for this
 * client: brief status (draft / edited / not started) + the full refresh
 * history timeline. Source of truth: pedro_client_state via the existing
 * /api/pedro/client-state endpoint (reuses the same shape Pedro UI uses).
 */

type RefreshEntry = {
  generatedAt: string
  window: { start: string; end: string; days: number }
  stats: {
    totalSpend: number
    totalLeads: number
    avgCpl: number | null
    winnerCount: number
    loserCount: number
  }
  trend: {
    spendDeltaPct: number | null
    leadsDeltaPct: number | null
    cplDeltaPct: number | null
  }
  summary: string
  proposals: Array<{
    basedOnAd: { adName: string; cpl: number | null }
    preserve: { hook: string; angle: string; format: string }
    variants: Array<{ label: string; newHook: string; primaryCopySnippet: string }>
  }>
}

type AutoBriefMeta = {
  source?: string
  autoTriggered?: boolean
  triggeredAt?: string
  triggeredFromMeeting?: string
  fathomRecordingId?: string | null
}

type ClientStateResponse = {
  state: null | {
    client_id: string
    campaign_number: number
    brief: Record<string, string> | null
    selected_angles: unknown[] | null
    script_text: string | null
    creatives: { refreshes?: RefreshEntry[]; manusPrompt?: string } | null
    lp: unknown
    ad_copy: unknown
    auto_brief_meta: AutoBriefMeta | null
    created_at: string
    updated_at: string
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fmtEuro(n: number): string {
  return `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`
}

function TrendCell({ pct, goodIs }: { pct: number | null; goodIs: "up" | "down" }) {
  if (pct == null || Math.abs(pct) < 5) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
        <Minus className="h-3 w-3" />
        flat
      </span>
    )
  }
  const isGood = goodIs === "up" ? pct > 0 : pct < 0
  const color = isGood ? "text-emerald-500" : "text-red-500"
  const Icon = pct > 0 ? TrendingUp : TrendingDown
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3 w-3" />
      {pct >= 0 ? "+" : ""}
      {pct.toFixed(0)}%
    </span>
  )
}

function StatusPill({
  state,
}: {
  state: NonNullable<ClientStateResponse["state"]> | null
}) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
        <AlertCircle className="h-3 w-3" />
        Pedro nog niet gestart
      </span>
    )
  }
  const isAutoDraft = state.auto_brief_meta?.autoTriggered === true
  const wasEdited =
    state.updated_at && state.created_at
      ? new Date(state.updated_at).getTime() - new Date(state.created_at).getTime() > 60_000
      : false
  if (isAutoDraft && !wasEdited) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
        <Sparkles className="h-3 w-3" />
        Auto-draft (nog niet bewerkt)
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      <Sparkles className="h-3 w-3" />
      Pedro actief — campagne #{state.campaign_number}
    </span>
  )
}

export function PedroTab({ mondayItemId, clientName }: { mondayItemId: string; clientName: string }) {
  const { data, isLoading } = useQuery<ClientStateResponse>({
    queryKey: ["pedro-client-state", mondayItemId],
    queryFn: () =>
      fetch(`/api/pedro/client-state?clientId=${mondayItemId}`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  const state = data?.state ?? null
  const refreshes = state?.creatives?.refreshes ?? []
  const sortedRefreshes = [...refreshes].sort((a, b) =>
    (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""),
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header card — status + open in Pedro */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="font-heading font-semibold text-base">Pedro</h3>
              <StatusPill state={state} />
            </div>
            <p className="text-sm text-muted-foreground">
              {state
                ? `Laatst bewerkt ${fmtDate(state.updated_at)} · ${refreshes.length} refresh${refreshes.length === 1 ? "" : "es"}`
                : "Nog geen brief, angles of refreshes voor deze klant gegenereerd."}
            </p>
            {state?.auto_brief_meta?.source && (
              <p className="text-xs text-muted-foreground/70 italic">
                {state.auto_brief_meta.source}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/pedro?tab=brief&clientId=${mondayItemId}`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Open in Pedro
            </Link>
            <Link
              href={`/pedro?tab=refresh&clientId=${mondayItemId}&auto=1`}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors"
              title="Vraag Pedro een nieuwe creative refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Brief snapshot (if exists) */}
      {state?.brief && (
        <Card>
          <CardContent className="py-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-heading font-semibold text-sm">Brief snapshot</h4>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-semibold">
                Campagne #{state.campaign_number}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {(["sector", "doel", "pijn", "aanbod", "usps", "hooksAM"] as const).map((field) => {
                const labels: Record<string, string> = {
                  sector: "Sector",
                  doel: "Doelgroep",
                  pijn: "Pijnpunten",
                  aanbod: "Aanbod",
                  usps: "USPs",
                  hooksAM: "Marketing hooks",
                }
                const value = state.brief?.[field] ?? ""
                if (!value) return null
                return (
                  <div key={field} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                      {labels[field]}
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-line line-clamp-3">
                      {value}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Refresh history timeline */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-heading font-semibold text-sm">Refresh history</h4>
            <span className="text-xs text-muted-foreground/60">{refreshes.length} totaal</span>
          </div>

          {sortedRefreshes.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
              Nog geen refresh-rondes gedraaid.{" "}
              <Link
                href={`/pedro?tab=refresh&clientId=${mondayItemId}&auto=1`}
                className="text-primary hover:underline"
              >
                Genereer er nu één →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedRefreshes.map((r, i) => (
                <div
                  key={`${r.generatedAt}-${i}`}
                  className="rounded-lg border border-border/60 bg-background p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {fmtDate(r.generatedAt)}
                      <span className="text-muted-foreground/40">·</span>
                      <span>{r.window.days}d window ({r.window.start} → {r.window.end})</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {r.stats.winnerCount} winners / {r.stats.loserCount} losers
                      </span>
                    </div>
                  </div>

                  {r.summary && (
                    <p className="text-sm text-foreground leading-relaxed">{r.summary}</p>
                  )}

                  {/* Stat grid */}
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                        Spend
                      </div>
                      <div className="font-medium tabular-nums">{fmtEuro(r.stats.totalSpend)}</div>
                      <TrendCell pct={r.trend.spendDeltaPct} goodIs="up" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                        Leads
                      </div>
                      <div className="font-medium tabular-nums">{r.stats.totalLeads}</div>
                      <TrendCell pct={r.trend.leadsDeltaPct} goodIs="up" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                        Avg CPL
                      </div>
                      <div className="font-medium tabular-nums">
                        {r.stats.avgCpl != null ? `€${r.stats.avgCpl.toFixed(2)}` : "—"}
                      </div>
                      <TrendCell pct={r.trend.cplDeltaPct} goodIs="down" />
                    </div>
                  </div>

                  {/* Proposals teaser */}
                  {r.proposals.length > 0 && (
                    <div className="pt-2 border-t border-border/40">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-2">
                        {r.proposals.length} proposal{r.proposals.length === 1 ? "" : "s"} — itereren op:
                      </div>
                      <ul className="space-y-1.5 text-sm">
                        {r.proposals.map((p, j) => (
                          <li key={j} className="flex items-start gap-2 text-foreground">
                            <span className="text-primary shrink-0">→</span>
                            <span className="truncate">
                              <span className="font-medium">{p.basedOnAd.adName}</span>
                              {p.basedOnAd.cpl != null && (
                                <span className="text-muted-foreground"> · CPL €{p.basedOnAd.cpl.toFixed(2)}</span>
                              )}
                              <span className="text-muted-foreground"> — {p.variants.length} varianten</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-border/40 text-center">
            <Link
              href={`/pedro?tab=refresh&clientId=${mondayItemId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Open de volledige refresh-stage in Pedro <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
        {clientName} · alle Pedro deliverables worden per campagne opgeslagen op deze klant
      </p>
    </div>
  )
}
