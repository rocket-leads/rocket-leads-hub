"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Sparkles, RefreshCw, ExternalLink, AlertCircle, Calendar, TrendingDown, TrendingUp, Minus, History, RotateCcw, Check } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { Locale } from "@/lib/i18n/types"

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

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function fmtEuro(n: number, locale: Locale): string {
  return `€${n.toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", { maximumFractionDigits: 0 })}`
}

function TrendCell({ pct, goodIs, locale }: { pct: number | null; goodIs: "up" | "down"; locale: Locale }) {
  if (pct == null || Math.abs(pct) < 5) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/60">
        <Minus className="h-3 w-3" />
        {t("client.pedro.refresh.trend.flat", locale)}
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
  locale,
}: {
  state: NonNullable<ClientStateResponse["state"]> | null
  locale: Locale
}) {
  if (!state) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-muted text-muted-foreground">
        <AlertCircle className="h-3 w-3" />
        {t("client.pedro.status.not_started", locale)}
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
        {t("client.pedro.status.auto_draft", locale)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
      <Sparkles className="h-3 w-3" />
      {t("client.pedro.status.active", locale, { n: String(state.campaign_number) })}
    </span>
  )
}

export function PedroTab({ mondayItemId, clientName }: { mondayItemId: string; clientName: string }) {
  const locale = useLocale()
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
      {/* Header card — status + open in Pedro.
          Mode hint at the bottom clarifies this tab is the *insight-mode*
          per-client surface (status, brief snapshot, refresh history) and
          full build-mode lives on /pedro. */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <h3 className="font-heading font-semibold text-base">Pedro</h3>
              <StatusPill state={state} locale={locale} />
            </div>
            <p className="text-sm text-muted-foreground">
              {state
                ? t(
                    refreshes.length === 1
                      ? "client.pedro.header.last_edited_one"
                      : "client.pedro.header.last_edited_many",
                    locale,
                    { date: fmtDate(state.updated_at, locale), n: String(refreshes.length) },
                  )
                : t("client.pedro.header.empty", locale)}
            </p>
            {state?.auto_brief_meta?.source && (
              <p className="text-xs text-muted-foreground/70 italic">
                {state.auto_brief_meta.source}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground/60 pt-1">
              {t("client.pedro.mode_hint", locale)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/pedro?tab=brief&clientId=${mondayItemId}`}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("client.pedro.action.open", locale)}
            </Link>
            <Link
              href={`/pedro?tab=refresh&clientId=${mondayItemId}&auto=1`}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors"
              title={t("client.pedro.action.refresh_title", locale)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t("client.pedro.action.refresh", locale)}
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Brief snapshot (if exists) */}
      {state?.brief && (
        <Card>
          <CardContent className="py-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-heading font-semibold text-sm">{t("client.pedro.brief.title", locale)}</h4>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60 font-semibold">
                {t("client.pedro.brief.campaign", locale, { n: String(state.campaign_number) })}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {(["sector", "doel", "pijn", "aanbod", "usps", "hooksAM"] as const).map((field) => {
                const labelKeys: Record<string, DictionaryKey> = {
                  sector: "client.pedro.brief.field.sector",
                  doel: "client.pedro.brief.field.doel",
                  pijn: "client.pedro.brief.field.pijn",
                  aanbod: "client.pedro.brief.field.aanbod",
                  usps: "client.pedro.brief.field.usps",
                  hooksAM: "client.pedro.brief.field.hooksAM",
                }
                const value = state.brief?.[field] ?? ""
                if (!value) return null
                return (
                  <div key={field} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                      {t(labelKeys[field], locale)}
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

      {/* Saved-version timeline — Pedro's full per-stage history for this client */}
      <SavedVersionTimeline mondayItemId={mondayItemId} />

      {/* Refresh history timeline */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-heading font-semibold text-sm">{t("client.pedro.refresh.title", locale)}</h4>
            <span className="text-xs text-muted-foreground/60">{t("client.pedro.refresh.total", locale, { n: String(refreshes.length) })}</span>
          </div>

          {sortedRefreshes.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
              {t("client.pedro.refresh.empty_lead", locale)}{" "}
              <Link
                href={`/pedro?tab=refresh&clientId=${mondayItemId}&auto=1`}
                className="text-primary hover:underline"
              >
                {t("client.pedro.refresh.empty_cta", locale)}
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
                      {fmtDate(r.generatedAt, locale)}
                      <span className="text-muted-foreground/40">·</span>
                      <span>{t("client.pedro.refresh.window", locale, { days: String(r.window.days), start: r.window.start, end: r.window.end })}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {t("client.pedro.refresh.winners_losers", locale, { w: String(r.stats.winnerCount), l: String(r.stats.loserCount) })}
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
                        {t("client.pedro.refresh.stat.spend", locale)}
                      </div>
                      <div className="font-medium tabular-nums">{fmtEuro(r.stats.totalSpend, locale)}</div>
                      <TrendCell pct={r.trend.spendDeltaPct} goodIs="up" locale={locale} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                        {t("client.pedro.refresh.stat.leads", locale)}
                      </div>
                      <div className="font-medium tabular-nums">{r.stats.totalLeads}</div>
                      <TrendCell pct={r.trend.leadsDeltaPct} goodIs="up" locale={locale} />
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold">
                        {t("client.pedro.refresh.stat.avg_cpl", locale)}
                      </div>
                      <div className="font-medium tabular-nums">
                        {r.stats.avgCpl != null ? `€${r.stats.avgCpl.toFixed(2)}` : "—"}
                      </div>
                      <TrendCell pct={r.trend.cplDeltaPct} goodIs="down" locale={locale} />
                    </div>
                  </div>

                  {/* Proposals teaser */}
                  {r.proposals.length > 0 && (
                    <div className="pt-2 border-t border-border/40">
                      <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-2">
                        {t(
                          r.proposals.length === 1 ? "client.pedro.refresh.proposals_one" : "client.pedro.refresh.proposals_many",
                          locale,
                          { n: String(r.proposals.length) },
                        )}
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
                              <span className="text-muted-foreground"> — {t("client.pedro.refresh.variants", locale, { n: String(p.variants.length) })}</span>
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
              {t("client.pedro.refresh.open_full", locale)} <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground/60 text-center pt-2">
        {t("client.pedro.footer", locale, { client: clientName })}
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Saved-version timeline — cross-stage history of Pedro's explicit
// "Save naar klant" snapshots for this client. Filterable by stage.
// Each entry can be expanded to peek at the data, or restored back into
// the current draft (overwrites pedro_client_state). Restore is the
// way to "rewind to v2" if a later version went sideways.
// ──────────────────────────────────────────────────────────────────────

type StageId = "brief" | "angles" | "script" | "creatives" | "lp" | "ad-copy" | "research"

/** Dictionary key per stage. Used for both filter chips and per-row stage
 *  labels in the saved-version timeline. */
const STAGE_LABEL_KEY: Record<StageId, DictionaryKey> = {
  brief: "client.pedro.stage.brief",
  research: "client.pedro.stage.research",
  angles: "client.pedro.stage.angles",
  script: "client.pedro.stage.script",
  creatives: "client.pedro.stage.creatives",
  lp: "client.pedro.stage.lp",
  "ad-copy": "client.pedro.stage.ad_copy",
}

type SavedVersionRow = {
  id: string
  client_id: string
  campaign_number: number
  stage: StageId
  version_number: number
  data: unknown
  label: string | null
  saved_by: string | null
  saved_at: string
}

function fmtDateTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function previewForStage(stage: StageId, data: unknown): string {
  if (data == null) return ""
  if (stage === "brief") {
    const b = data as Record<string, string>
    return [b.bedrijf, b.sector].filter(Boolean).join(" — ").slice(0, 200) || "—"
  }
  if (stage === "angles") {
    const arr = data as Array<{ titel?: string }>
    return arr.map((a) => a.titel).filter(Boolean).join(" / ").slice(0, 200) || `${arr.length} angles`
  }
  if (stage === "script") {
    const s = data as { script_text?: string }
    return (s.script_text ?? "").slice(0, 160) + ((s.script_text?.length ?? 0) > 160 ? "…" : "")
  }
  if (stage === "creatives") {
    const c = data as { qty?: number; formats?: string[] }
    // "X creatives" / "X formats" left as a compact data preview — the labels
    // here are part of the data shape, not chrome.
    return `${c.qty ?? "?"} creatives · ${(c.formats ?? []).join(", ") || "—"}`
  }
  if (stage === "lp") {
    const l = data as { stijl?: string; lengte?: string }
    return `${l.stijl ?? "?"} · ${l.lengte ?? "?"}`
  }
  if (stage === "ad-copy") {
    const a = data as { variantA?: string }
    return (a.variantA ?? "").slice(0, 160) + ((a.variantA?.length ?? 0) > 160 ? "…" : "")
  }
  if (stage === "research") {
    const r = data as { branche?: string }
    return r.branche ?? "—"
  }
  return ""
}

function SavedVersionTimeline({ mondayItemId }: { mondayItemId: string }) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [stageFilter, setStageFilter] = useState<StageId | "all">("all")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [restoreState, setRestoreState] = useState<Record<string, "idle" | "saving" | "ok" | "err">>({})

  const { data, isLoading } = useQuery<{ versions: SavedVersionRow[] }>({
    queryKey: ["pedro-saved-versions", mondayItemId],
    queryFn: () =>
      fetch(`/api/pedro/saved-versions?clientId=${encodeURIComponent(mondayItemId)}`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  const versions = data?.versions ?? []
  const filtered = stageFilter === "all" ? versions : versions.filter((v) => v.stage === stageFilter)
  const stagesPresent = Array.from(new Set(versions.map((v) => v.stage)))

  async function handleRestore(v: SavedVersionRow) {
    setRestoreState((s) => ({ ...s, [v.id]: "saving" }))
    try {
      // Map stage data back to the draft's column-shape, then upsert
      // pedro_client_state (the draft slot) so opening Pedro shows
      // this version as the working draft.
      const patch: Record<string, unknown> = {
        clientId: mondayItemId,
        campaignNumber: v.campaign_number,
      }
      if (v.stage === "brief") patch.brief = v.data
      else if (v.stage === "angles") patch.selected_angles = v.data
      else if (v.stage === "script") {
        const s = v.data as { script_text?: string; script_videos?: unknown[] }
        patch.script_text = s.script_text ?? null
        patch.script_videos = s.script_videos ?? []
      } else if (v.stage === "creatives") patch.creatives = v.data
      else if (v.stage === "lp") patch.lp = v.data
      else if (v.stage === "ad-copy") patch.ad_copy = v.data

      const res = await fetch("/api/pedro/client-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRestoreState((s) => ({ ...s, [v.id]: "ok" }))
      await queryClient.invalidateQueries({ queryKey: ["pedro-client-state", mondayItemId] })
      setTimeout(() => {
        setRestoreState((s) => {
          const { [v.id]: _drop, ...rest } = s
          return rest
        })
      }, 2500)
    } catch {
      setRestoreState((s) => ({ ...s, [v.id]: "err" }))
      setTimeout(() => {
        setRestoreState((s) => {
          const { [v.id]: _drop, ...rest } = s
          return rest
        })
      }, 3000)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-5">
          <Skeleton className="h-32 rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-heading font-semibold text-sm">{t("client.pedro.versions.title", locale)}</h4>
          </div>
          <span className="text-xs text-muted-foreground/60">
            {t(
              versions.length === 1 ? "client.pedro.versions.count_one" : "client.pedro.versions.count_many",
              locale,
              { n: String(versions.length) },
            )}
          </span>
        </div>

        {versions.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
            {t("client.pedro.versions.empty_lead", locale)}{" "}
            <Link href={`/pedro?tab=brief&clientId=${mondayItemId}`} className="text-primary hover:underline">
              {t("client.pedro.versions.empty_cta", locale)}
            </Link>
          </div>
        ) : (
          <>
            {/* Stage filter chips */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => setStageFilter("all")}
                className={`text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors ${
                  stageFilter === "all"
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                }`}
              >
                {t("client.pedro.versions.filter.all", locale, { n: String(versions.length) })}
              </button>
              {stagesPresent.map((s) => {
                const count = versions.filter((v) => v.stage === s).length
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStageFilter(s)}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors ${
                      stageFilter === s
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    {t("client.pedro.versions.stage_filter_count", locale, { stage: t(STAGE_LABEL_KEY[s], locale), n: String(count) })}
                  </button>
                )
              })}
            </div>

            {/* Timeline list */}
            <div className="divide-y divide-border/40 border border-border/40 rounded-lg overflow-hidden">
              {filtered.map((v) => {
                const isOpen = expanded === v.id
                const rState = restoreState[v.id]
                return (
                  <div key={v.id} className="bg-background">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpanded(isOpen ? null : v.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          setExpanded(isOpen ? null : v.id)
                        }
                      }}
                      className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="inline-flex items-center justify-center min-w-[28px] h-5 px-1.5 text-[10px] font-semibold rounded bg-primary/10 text-primary tabular-nums">
                          v{v.version_number}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold shrink-0">
                          {t(STAGE_LABEL_KEY[v.stage], locale)}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {previewForStage(v.stage, v.data)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[11px] text-muted-foreground/70">{fmtDateTime(v.saved_at, locale)}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleRestore(v)
                          }}
                          disabled={rState === "saving"}
                          className={`inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium border rounded-md transition-colors ${
                            rState === "ok"
                              ? "text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
                              : rState === "err"
                                ? "text-red-600 dark:text-red-400 border-red-500/40"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent border-border"
                          }`}
                          title={t("client.pedro.versions.action.title", locale)}
                        >
                          {rState === "ok" ? <Check className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}
                          {rState === "saving"
                            ? "..."
                            : rState === "ok"
                              ? t("client.pedro.versions.action.restored", locale)
                              : rState === "err"
                                ? t("client.pedro.versions.action.error", locale)
                                : t("client.pedro.versions.action.restore", locale)}
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="px-4 py-3 bg-muted/20 border-t border-border/40 text-xs">
                        <pre className="whitespace-pre-wrap break-words text-muted-foreground/80 max-h-64 overflow-y-auto">
                          {JSON.stringify(v.data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {filtered.length === 0 && (
              <div className="text-xs text-muted-foreground italic mt-3 text-center">
                {t("client.pedro.versions.empty_filtered", locale)}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
