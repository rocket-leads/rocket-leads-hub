"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Search,
  Sparkles,
  Loader2,
  ExternalLink,
  Check,
  X,
  AlertCircle,
  Clock,
  Image as ImageIcon,
  Video,
  Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { cn } from "@/lib/utils"
import type { SerializedStep, WizardClient } from "../wizard-shell"

type Props = {
  step: SerializedStep
  mondayItemId: string
  client: WizardClient
  allSteps: SerializedStep[]
  hiddenContent?: Record<string, unknown>
  locale: Locale
  nextKey: string | undefined
  onStepSaved: (nextStepKey?: string) => void
}

type CompetitorSuggestion = {
  name: string
  relevance: string
  facebookPageUrl?: string
  websiteUrl?: string
}

type CompetitorAd = {
  id: string
  monday_item_id: string
  competitor_name: string
  competitor_page_url: string | null
  ad_archive_id: string
  was_active_at_scrape: boolean
  headline: string | null
  body: string | null
  cta_text: string | null
  creative_type: string | null
  creative_preview_url: string | null
  platforms: string[] | null
  days_running: number | null
  selected_by_am: boolean
}

type BriefFields = {
  bedrijf: string
  sector: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

const EMPTY_BRIEF: BriefFields = {
  bedrijf: "",
  sector: "",
  doelgroep: "",
  pijnpunten: "",
  aanbod: "",
  usps: "",
  marketingHooks: "",
}

/**
 * Stap 5 — Concurrentie research (CM). Hangt op de bestaande Apify
 * foundation: AI-discovery van 5-8 concurrenten op basis van de brief,
 * Apify scrape per concurrent met dagen-actief score, AM/CM vinkt
 * winning ads aan voor Pedro hergebruik.
 *
 * Flow:
 *   1. Initial: "Vind concurrenten" knop → POST {action:'find'}
 *   2. Suggested competitors lijst → AM ticks welke te scrapen
 *   3. "Scrape winning ads" → POST {action:'scrape'} → upsert in
 *      client_competitor_ads
 *   4. Grid van scraped ads gesorteerd op days_running desc
 *   5. Per ad: select checkbox → PATCH selected_by_am
 *
 * De endpoint vond ik al gebouwd in /api/clients/[id]/onboarding/
 * competitors — deze step is alleen UI bovenop.
 */
export function CmCompetitorsStep({
  mondayItemId,
  allSteps,
  hiddenContent,
  locale,
}: Props) {
  const queryClient = useQueryClient()

  // Suggested competitors live in component state — they're a UI
  // staging step before triggering the (paid) Apify scrape.
  const [suggested, setSuggested] = useState<CompetitorSuggestion[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [country, setCountry] = useState("NL")

  // Brief input for the find call — merged from Stap 1 + Stap 2.
  const brief = pickBrief(allSteps, hiddenContent)

  // Pull existing scraped ads (revisit case: scrape happened earlier).
  const adsQuery = useQuery<{ ads: CompetitorAd[] }>({
    queryKey: ["onboarding-competitor-ads", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/onboarding/competitors`).then((r) => r.json()),
    staleTime: 60 * 1000,
  })

  const find = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/clients/${mondayItemId}/onboarding/competitors`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "find", brief: { ...brief, country } }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Find failed")
      }
      return res.json() as Promise<{ competitors: CompetitorSuggestion[] }>
    },
    onSuccess: ({ competitors }) => {
      setSuggested(competitors)
      // Default-select all so AM/CM only has to UNcheck the bad ones.
      setSelected(new Set(competitors.map((c) => c.name)))
    },
  })

  const scrape = useMutation({
    mutationFn: async () => {
      const picks = (suggested ?? []).filter((c) => selected.has(c.name))
      const res = await fetch(
        `/api/clients/${mondayItemId}/onboarding/competitors`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "scrape",
            country,
            competitors: picks,
          }),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Scrape failed")
      }
      return res.json() as Promise<{
        scrapedCount: number
        perCompetitor: Array<{ name: string; ads: number }>
      }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["onboarding-competitor-ads", mondayItemId],
      })
    },
  })

  const toggleAdSelect = useMutation({
    mutationFn: async (vars: { adId: string; selected: boolean }) => {
      const res = await fetch(
        `/api/clients/${mondayItemId}/onboarding/competitors`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(vars),
        },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Toggle failed")
      }
      return res.json()
    },
    onMutate: async (vars) => {
      // Optimistic: flip immediately, roll back on error.
      await queryClient.cancelQueries({
        queryKey: ["onboarding-competitor-ads", mondayItemId],
      })
      const prev = queryClient.getQueryData<{ ads: CompetitorAd[] }>([
        "onboarding-competitor-ads",
        mondayItemId,
      ])
      if (prev) {
        queryClient.setQueryData(
          ["onboarding-competitor-ads", mondayItemId],
          {
            ads: prev.ads.map((a) =>
              a.id === vars.adId ? { ...a, selected_by_am: vars.selected } : a,
            ),
          },
        )
      }
      return { prev }
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(
          ["onboarding-competitor-ads", mondayItemId],
          ctx.prev,
        )
      }
    },
  })

  const ads = adsQuery.data?.ads ?? []
  const hasScraped = ads.length > 0
  const selectedAdCount = ads.filter((a) => a.selected_by_am).length

  return (
    <div className="space-y-5">
      {/* Step intro */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span className="text-foreground/80 leading-relaxed">
          {t("onboarding.wizard.cm_comp.intro", locale)}
        </span>
      </div>

      {/* Find competitors phase */}
      {!suggested && !hasScraped && (
        <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold mb-1">
                {t("onboarding.wizard.cm_comp.find.title", locale)}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {t("onboarding.wizard.cm_comp.find.body", locale)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("onboarding.wizard.cm_comp.country", locale)}
              </span>
              <Input
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                className="h-8 w-16 text-xs text-center"
                maxLength={2}
              />
            </div>
          </div>
          <Button
            onClick={() => find.mutate()}
            disabled={find.isPending}
            className="gap-1.5"
          >
            {find.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {t("onboarding.wizard.cm_comp.find.btn", locale)}
          </Button>
          {find.isError && (
            <p className="text-xs text-destructive">
              {find.error instanceof Error ? find.error.message : "Failed"}
            </p>
          )}
        </section>
      )}

      {/* Suggested competitors list */}
      {suggested && (
        <section className="rounded-xl border border-border/60 bg-card/50 p-5 space-y-3">
          <div>
            <h3 className="text-sm font-semibold">
              {t("onboarding.wizard.cm_comp.suggested.title", locale).replace(
                "{count}",
                String(suggested.length),
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {t("onboarding.wizard.cm_comp.suggested.body", locale)}
            </p>
          </div>
          <ul className="space-y-1.5">
            {suggested.map((c) => (
              <li
                key={c.name}
                className={cn(
                  "flex items-start gap-3 rounded-md px-3 py-2 transition-colors cursor-pointer",
                  selected.has(c.name)
                    ? "bg-emerald-500/5 border border-emerald-500/30"
                    : "border border-border/40 hover:bg-muted/30",
                )}
                onClick={() => {
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(c.name)) next.delete(c.name)
                    else next.add(c.name)
                    return next
                  })
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.name)}
                  onChange={() => undefined}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {c.relevance}
                  </div>
                  {c.websiteUrl && (
                    <a
                      href={c.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-primary hover:underline inline-flex items-center gap-1 mt-1"
                    >
                      {c.websiteUrl} <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSuggested(null)
                setSelected(new Set())
              }}
              disabled={scrape.isPending}
            >
              {t("onboarding.wizard.cm_comp.reset", locale)}
            </Button>
            <Button
              onClick={() => scrape.mutate()}
              disabled={scrape.isPending || selected.size === 0}
              className="gap-1.5"
            >
              {scrape.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t("onboarding.wizard.cm_comp.scrape.btn", locale).replace(
                "{count}",
                String(selected.size),
              )}
            </Button>
          </div>
          {scrape.isError && (
            <p className="text-xs text-destructive">
              {scrape.error instanceof Error ? scrape.error.message : "Failed"}
            </p>
          )}
        </section>
      )}

      {/* Scraped ads grid */}
      {hasScraped && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">
                {t("onboarding.wizard.cm_comp.ads.title", locale).replace(
                  "{count}",
                  String(ads.length),
                )}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {t("onboarding.wizard.cm_comp.ads.body", locale).replace(
                  "{selected}",
                  String(selectedAdCount),
                )}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSuggested(null)
                setSelected(new Set())
                find.reset()
              }}
            >
              {t("onboarding.wizard.cm_comp.find_more", locale)}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {ads.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                onToggle={(next) =>
                  toggleAdSelect.mutate({ adId: ad.id, selected: next })
                }
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AdCard({
  ad,
  onToggle,
  locale,
}: {
  ad: CompetitorAd
  onToggle: (next: boolean) => void
  locale: Locale
}) {
  const TypeIcon =
    ad.creative_type === "video"
      ? Video
      : ad.creative_type === "carousel"
        ? Layers
        : ImageIcon

  return (
    <div
      className={cn(
        "rounded-xl border bg-card overflow-hidden transition-colors",
        ad.selected_by_am
          ? "border-emerald-500/40 ring-2 ring-emerald-500/20"
          : "border-border/60",
      )}
    >
      {/* Image / preview */}
      <div className="relative aspect-video bg-muted">
        {ad.creative_preview_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.creative_preview_url}
            alt={ad.headline ?? "Ad preview"}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
        <div className="absolute top-2 right-2">
          <button
            type="button"
            onClick={() => onToggle(!ad.selected_by_am)}
            className={cn(
              "h-7 w-7 rounded-full border-2 flex items-center justify-center transition-colors",
              ad.selected_by_am
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-white/80 bg-black/30 text-white hover:bg-emerald-500/60",
            )}
            aria-label={ad.selected_by_am ? "Deselect" : "Select"}
          >
            {ad.selected_by_am ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5 opacity-0" />}
          </button>
        </div>
        {ad.days_running !== null && ad.days_running >= 30 && (
          <div className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-black/70 text-white px-2 py-0.5 text-[10px] font-medium">
            <Clock className="h-2.5 w-2.5" />
            {ad.days_running}d
          </div>
        )}
      </div>
      {/* Meta */}
      <div className="p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <TypeIcon className="h-3 w-3" />
          <span>{ad.competitor_name}</span>
        </div>
        {ad.headline && (
          <div className="text-sm font-medium line-clamp-2 leading-snug">{ad.headline}</div>
        )}
        {ad.body && (
          <div className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
            {ad.body}
          </div>
        )}
        {ad.cta_text && (
          <div className="text-[10px] inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 font-medium">
            {ad.cta_text}
          </div>
        )}
      </div>
      {!ad.creative_preview_url && (
        <div className="px-3 pb-3 text-[10px] text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
          <AlertCircle className="h-2.5 w-2.5" />
          {t("onboarding.wizard.cm_comp.ads.no_preview", locale)}
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pickBrief(
  allSteps: SerializedStep[],
  hiddenContent: Record<string, unknown> | undefined,
): Partial<BriefFields> {
  const kickoff = allSteps.find((s) => s.key === "kickoff_live")?.content as
    | { briefDraft?: Partial<BriefFields> }
    | null
  const enrichment = hiddenContent?.brief_enrichment as
    | { finalBrief?: Partial<BriefFields> }
    | null
  const out: Partial<BriefFields> = { ...EMPTY_BRIEF }
  for (const key of Object.keys(EMPTY_BRIEF) as Array<keyof BriefFields>) {
    const e = enrichment?.finalBrief?.[key]?.trim?.() ?? ""
    const k = kickoff?.briefDraft?.[key]?.trim?.() ?? ""
    out[key] = e || k
  }
  return out
}
