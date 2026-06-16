"use client"

import { useState, useEffect, useCallback } from "react"
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  Check,
  ExternalLink,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Wand2,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * PushToMetaModal - batch launch van een proposal naar Meta.
 *
 * Per variant binnen het proposal: checkbox per slot (A/B/C). Default
 * preselectie = eerste slot dat een image heeft.
 *
 * Click "Launch" → POST naar push-to-meta endpoint → toon per-slot
 * resultaat met Meta-ad link bij success, foutmelding bij failure.
 *
 * Roy 2026-06-09.
 */

type SlotInfo = {
  position: number
  hasImage: boolean
  signedUrl: string | null
}

type ProposalVariant = {
  variantId: string | null
  adName: string
  label: string
  topicLabel: string
}

type Selection = {
  variantId: string
  slotPosition: number
}

type LaunchResult = {
  variantId: string
  slotPosition: number
  ok: boolean
  metaAdId?: string
  metaAdName?: string
  error?: string
}

type ParamHintField =
  | "daily_budget"
  | "adset_name"
  | "targeting"
  | "bid_strategy"
  | "optimization_goal"

type ParamHint = {
  field: ParamHintField
  suggested?: string | number
  reason: string
}

type TemplateSummary = {
  adsetId: string
  campaignId: string
  hasTargeting: boolean
  hasBidStrategy: boolean
  hasOptimizationGoal: boolean
  hasBudget: boolean
  hasBillingEvent: boolean
  missingFields: string[]
}

type LaunchResponse = {
  adSetId?: string
  adSetName?: string
  adsManagerUrl?: string
  successCount?: number
  totalCount?: number
  partialFailure?: boolean
  results?: LaunchResult[]
  error?: string
  errorCode?: string
  /** Roy 2026-06-14: server-side hint about which input the CM should
   *  tweak to retry. Drives the highlighted input + suggested value +
   *  auto-expand of the advanced override panel. */
  paramHints?: ParamHint[]
  /** Roy 2026-06-14: summary of which template fields Pedro pulled
   *  from Meta. When fields are missing the modal nudges the CM to
   *  pick a different ad set rather than fight with override dropdowns. */
  templateSummary?: TemplateSummary
  templateIncomplete?: boolean
  /** Where in the push flow the failure happened (informational). */
  stage?: string
  /** Roy 2026-06-10: wanneer de winner uit Meta is verdwenen vallen we
   *  terug op de meest-recente bruikbare ad in het account als template
   *  voor de nieuwe ad set. UI banner informeert de CM. */
  fallback?: {
    reason: string
    templateAdId: string
    templateAdName: string
    templateAdsetName: string
  } | null
}

/** Common Meta bid strategies + optimization goals — surface as dropdown
 *  options when the CM needs to override the inherited winner config.
 *  Not exhaustive (Meta has more for special objectives) but covers the
 *  cases that actually show up for RL clients. */
const BID_STRATEGY_OPTIONS = [
  { value: "LOWEST_COST_WITHOUT_CAP", label: "Lowest cost (no cap) — default" },
  { value: "LOWEST_COST_WITH_BID_CAP", label: "Lowest cost (bid cap)" },
  { value: "COST_CAP", label: "Cost cap" },
  { value: "LOWEST_COST_WITH_MIN_ROAS", label: "Lowest cost + min ROAS" },
] as const

const OPTIMIZATION_GOAL_OPTIONS = [
  { value: "OFFSITE_CONVERSIONS", label: "Offsite conversions (lead form / pixel)" },
  { value: "LEAD_GENERATION", label: "Lead generation (instant form)" },
  { value: "LINK_CLICKS", label: "Link clicks" },
  { value: "IMPRESSIONS", label: "Impressions" },
  { value: "REACH", label: "Reach" },
  { value: "LANDING_PAGE_VIEWS", label: "Landing page views" },
  { value: "VALUE", label: "Value" },
] as const

type TemplateCandidate = {
  adsetId: string
  adsetName: string
  campaignId: string
  campaignName: string
  campaignIsSelected: boolean
  spend: number
  leads: number
  cpl: number | null
  adCount: number
  representativeAd?: {
    adId: string
    adName: string
    pageId: string
    instagramActorId: string
    leadGenFormId: string
    linkUrl: string
    callToActionType: string
  }
  adsManagerUrl: string
}

type OverrideTemplate = {
  adsetId: string
  adsetName: string
  campaignId: string
  campaignName: string
  pageId: string
  instagramActorId?: string
  leadGenFormId?: string
  linkUrl?: string
  callToActionType?: string
  templateAdId?: string
  templateAdName?: string
}

type Props = {
  open: boolean
  onClose: () => void
  refreshId: string
  proposalIndex: number
  winnerAdName: string
  variants: ProposalVariant[]
  /** Proposal's shared angle (preserve.angle) - fallback voor de
   *  default ad-set name als geen headline beschikbaar is. */
  proposalAngle: string
  /** Variant's on-image headline (Meta headline). Roy 2026-06-10:
   *  Pedro's gegenereerde of CM-aangepaste headline wint over de
   *  generieke angle als default ad set name. CM kan altijd nog
   *  overschrijven in het input veld. */
  variantHeadline?: string
  /** Monday item id van de klant - nodig om template-candidates op te
   *  halen wanneer het snapshot-path faalt. Roy 2026-06-11. */
  clientId: string
}

const SLOT_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

export function PushToMetaModal({
  open,
  onClose,
  refreshId,
  proposalIndex,
  winnerAdName,
  variants,
  proposalAngle,
  variantHeadline,
  clientId,
}: Props) {
  const [slotsByVariant, setSlotsByVariant] = useState<Map<string, SlotInfo[]>>(
    new Map(),
  )
  const [selected, setSelected] = useState<Map<string, Set<number>>>(new Map())
  const [loading, setLoading] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [launchResponse, setLaunchResponse] = useState<LaunchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Editable ad-set config. Default name priority:
  //   1. variant headline (Pedro's on-image text, often the strongest
  //      summary of what the ad set tests) - Roy 2026-06-10.
  //   2. proposal.preserve.angle (shared theme across the proposal).
  //   3. Empty placeholder.
  // Roy 2026-06-12: "NT | " prefix laten vallen - we strippen targeting
  // niet meer (true duplicate van de winning ad set), dus "NT" = no
  // targeting is een verkeerde label. Naam is gewoon de angle/headline.
  const cleanedHeadline = variantHeadline?.replace(/[?!.]+\s*$/, "").trim()
  const defaultSegment = cleanedHeadline || proposalAngle || ""
  const defaultAdsetName = defaultSegment.slice(0, 200)
  const [adsetName, setAdsetName] = useState(defaultAdsetName)
  const [dailyBudgetEuros, setDailyBudgetEuros] = useState<string>("")

  // Roy 2026-06-14: inline retry overrides — surfaced in the modal
  // when Meta rejects the push. CM tweaks these and re-submits without
  // closing. Empty string / false / undefined = inherit from winner.
  const [stripTargeting, setStripTargeting] = useState(false)
  const [bidStrategyOverride, setBidStrategyOverride] = useState<string>("")
  const [optimizationGoalOverride, setOptimizationGoalOverride] = useState<string>("")
  // Roy 2026-06-15: CM-provided landing page URL. Pre-fills from the
  // resolved override.linkUrl (when CM picked a template) — empty
  // otherwise. When non-empty, wins over winnerLive.linkUrl in the
  // backend. Solves the "Marketing API returned empty linkUrl for a
  // landing-page conversion winner" case where we previously fell
  // back to the bare facebook.com homepage.
  const [landingPageUrl, setLandingPageUrl] = useState<string>("")
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // Template-picker fallback state. Becomes active when push returns
  // errorCode=no_template (snapshot dead + no usable ad in 90d). User
  // picks an ad set from the picker → we re-launch with overrideTemplate.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [candidates, setCandidates] = useState<TemplateCandidate[] | null>(null)
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [candidatesError, setCandidatesError] = useState<string | null>(null)
  const [override, setOverride] = useState<OverrideTemplate | null>(null)

  // Load slot states for each variant on open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setLaunchResponse(null)
    // Reset ad-set inputs each time the modal opens - the proposal /
    // angle can change between opens.
    setAdsetName(defaultAdsetName)
    setDailyBudgetEuros("")
    setPickerOpen(false)
    setCandidates(null)
    setCandidatesError(null)
    setOverride(null)
    setStripTargeting(false)
    setBidStrategyOverride("")
    setOptimizationGoalOverride("")
    setLandingPageUrl("")
    setAdvancedOpen(false)

    const variantIds = variants
      .map((v) => v.variantId)
      .filter((id): id is string => !!id)

    Promise.all(
      variantIds.map((id) =>
        fetch(`/api/pedro/variants/${id}/image`)
          .then((r) => r.json())
          .then((json) => ({ id, slots: (json.slots as SlotInfo[]) ?? [] }))
          .catch(() => ({ id, slots: [] as SlotInfo[] })),
      ),
    ).then((results) => {
      if (cancelled) return
      const map = new Map<string, SlotInfo[]>()
      const sel = new Map<string, Set<number>>()
      for (const r of results) {
        map.set(r.id, r.slots)
        // Default: preselect ALL slots that have an image. Roy
        // 2026-06-10: CM wil standaard alle 3 mee, niet alleen de
        // eerste. CM kan slots deselecteren als hij er één niet wil.
        const readyPositions = r.slots
          .filter((s) => s.hasImage)
          .map((s) => s.position)
        sel.set(r.id, new Set(readyPositions))
      }
      setSlotsByVariant(map)
      setSelected(sel)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, variants])

  const totalSelected = Array.from(selected.values()).reduce(
    (sum, s) => sum + s.size,
    0,
  )

  const toggleSlot = useCallback((variantId: string, position: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      const setAtVariant = new Set<number>(next.get(variantId) ?? [])
      if (setAtVariant.has(position)) setAtVariant.delete(position)
      else setAtVariant.add(position)
      next.set(variantId, setAtVariant)
      return next
    })
  }, [])

  // Validation: ad-set name non-empty + budget is a parseable positive number.
  const adsetNameTrimmed = adsetName.trim()
  const budgetParsed = parseFloat(dailyBudgetEuros.replace(",", "."))
  const budgetValid = Number.isFinite(budgetParsed) && budgetParsed >= 1
  const launchReady = adsetNameTrimmed.length > 0 && budgetValid

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true)
    setCandidatesError(null)
    try {
      // Roy 2026-06-14: bumped from 90d → 180d. The winning ad set
      // we want to clone is often older than 90d (Pedro picks long-
      // standing top performers), and Roy was specifically asking
      // for ad sets that weren't surfacing.
      const res = await fetch(
        `/api/pedro/template-candidates/${encodeURIComponent(clientId)}?windowDays=180`,
      )
      const json = await res.json()
      if (!res.ok || json.error) {
        setCandidatesError(json.error || `HTTP ${res.status}`)
        return
      }
      setCandidates((json.candidates ?? []) as TemplateCandidate[])
    } catch (e) {
      setCandidatesError(e instanceof Error ? e.message : "Kon kandidaten niet laden")
    } finally {
      setCandidatesLoading(false)
    }
  }, [clientId])

  const launch = useCallback(async () => {
    if (launching || !launchReady) return
    setLaunching(true)
    setError(null)
    setLaunchResponse(null)
    try {
      const payload: Selection[] = []
      for (const [variantId, positions] of selected.entries()) {
        for (const pos of positions) payload.push({ variantId, slotPosition: pos })
      }
      const body: Record<string, unknown> = {
        variants: payload,
        adsetName: adsetNameTrimmed,
        dailyBudgetEuros: budgetParsed,
      }
      if (override) body.overrideTemplate = override
      // Roy 2026-06-14: inline retry overrides — only forwarded when
      // the CM actually changed them (default state = inherit).
      if (stripTargeting) body.stripTargeting = true
      if (bidStrategyOverride) body.bidStrategy = bidStrategyOverride
      if (optimizationGoalOverride) body.optimizationGoal = optimizationGoalOverride
      if (landingPageUrl.trim()) body.linkUrl = landingPageUrl.trim()
      const res = await fetch(
        `/api/pedro/proposals/${encodeURIComponent(refreshId)}/${proposalIndex}/push-to-meta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      const json: LaunchResponse = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`)
        setLaunchResponse(json)
        // Auto-open template picker when the failure is missing-template.
        if (json.errorCode === "no_template" && !override) {
          setPickerOpen(true)
          if (!candidates) void loadCandidates()
        }
        // Roy 2026-06-14: react to paramHints so the CM doesn't have to
        // hunt for which input to change. Auto-apply suggested daily
        // budget, auto-open the advanced panel when targeting / bid /
        // optimization goal is the suspect.
        const hints = json.paramHints ?? []
        for (const h of hints) {
          if (h.field === "daily_budget" && h.suggested !== undefined) {
            setDailyBudgetEuros(String(h.suggested))
          }
          if (
            h.field === "targeting" ||
            h.field === "bid_strategy" ||
            h.field === "optimization_goal"
          ) {
            setAdvancedOpen(true)
          }
        }
        return
      }
      setLaunchResponse(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch mislukt")
    } finally {
      setLaunching(false)
    }
  }, [
    launching,
    launchReady,
    selected,
    refreshId,
    proposalIndex,
    adsetNameTrimmed,
    budgetParsed,
    override,
    candidates,
    loadCandidates,
    stripTargeting,
    bidStrategyOverride,
    optimizationGoalOverride,
    landingPageUrl,
  ])

  /** Roy 2026-06-14: helpers for the UI to know whether the modal is in
   *  a "pre-launch / retry" state vs. "post-launch with results". The
   *  modal stays in pre-launch state when the response has no results
   *  array (= the push failed before any ads were created) so the CM
   *  can tweak and retry. */
  const hasResults = !!launchResponse?.results && launchResponse.results.length > 0
  const hints = launchResponse?.paramHints ?? []
  const hintFor = (field: ParamHintField) => hints.find((h) => h.field === field)

  const pickCandidate = useCallback((c: TemplateCandidate) => {
    if (!c.representativeAd) return
    // Roy 2026-06-15: pre-fill the landing-page input with the resolved
    // URL from the picked candidate. CM sees what was found and can
    // tweak / paste a different one before pushing.
    setLandingPageUrl(c.representativeAd.linkUrl || "")
    setOverride({
      adsetId: c.adsetId,
      adsetName: c.adsetName,
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      pageId: c.representativeAd.pageId,
      instagramActorId: c.representativeAd.instagramActorId || undefined,
      leadGenFormId: c.representativeAd.leadGenFormId || undefined,
      linkUrl: c.representativeAd.linkUrl || undefined,
      callToActionType: c.representativeAd.callToActionType || undefined,
      templateAdId: c.representativeAd.adId,
      templateAdName: c.representativeAd.adName,
    })
    setPickerOpen(false)
    setError(null)
    setLaunchResponse(null)
  }, [])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-4 border-b border-border bg-card">
          <div>
            <div className="text-xs uppercase tracking-wide font-semibold text-sky-600 dark:text-sky-400 mb-1">
              Push to Meta
            </div>
            <h2 className="font-heading font-semibold text-lg">
              Itereren op {winnerAdName}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Eén nieuwe ad set wordt aangemaakt in dezelfde campagne, met dezelfde
              targeting / audience / placements als de winning ad set (true
              duplicate).{" "}
              <span className="font-medium text-amber-700 dark:text-amber-400">
                Status: PAUSED (= concept).
              </span>{" "}
              Niets gaat live, geen euro spend. Verschijnt in Ads Manager onder
              deze campagne - je controleert + activeert zelf wanneer je klaar
              bent. Wegklikken / aanpassen in Meta blijft mogelijk.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Sluiten"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Template-picker view - overlays the rest when active */}
          {pickerOpen && !launchResponse && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide font-semibold text-amber-600 dark:text-amber-400">
                    Kies template ad set
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Kies welke ad set gekloond moet worden — budget / targeting /
                    placements / page + IG / lead-form worden hieruit 1:1 overgenomen.
                    Lijst toont alle ad sets met activiteit in de laatste 180 dagen.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="h-3 w-3" />
                  Terug
                </button>
              </div>

              {candidatesLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Ad sets laden (180 dagen)…
                </div>
              )}
              {candidatesError && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {candidatesError}
                </div>
              )}
              {!candidatesLoading && !candidatesError && candidates && candidates.length === 0 && (
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Geen ad sets gevonden in dit Meta account (laatste 90 dagen).
                </div>
              )}
              {!candidatesLoading && candidates && candidates.length > 0 && (
                <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
                  {candidates.map((c) => {
                    const usable = !!c.representativeAd
                    return (
                      <button
                        key={c.adsetId}
                        type="button"
                        onClick={() => pickCandidate(c)}
                        disabled={!usable}
                        title={
                          usable
                            ? `Kies "${c.adsetName}" als template`
                            : "Deze ad set heeft geen bruikbare ad (geen page_id of geen link/lead-form)."
                        }
                        className={cn(
                          "w-full text-left rounded-md border p-2.5 transition-colors",
                          usable
                            ? "border-border bg-background hover:border-primary/60 hover:bg-primary/5"
                            : "border-dashed border-border/60 bg-muted/20 cursor-not-allowed opacity-60",
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{c.adsetName || "(naamloos)"}</div>
                            <div className="text-[11px] text-muted-foreground truncate font-mono">
                              {c.campaignName || c.campaignId}
                              {c.campaignIsSelected && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0 rounded bg-sky-500/10 text-sky-700 dark:text-sky-400 text-[10px]">
                                  geselecteerd
                                </span>
                              )}
                              {!usable && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px]">
                                  geen rep-ad
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 text-[11px]">
                            <div className="font-mono">
                              €{c.spend.toFixed(0)} · {c.leads} leads
                            </div>
                            <div className="text-muted-foreground font-mono">
                              CPL {c.cpl !== null ? `€${c.cpl.toFixed(2)}` : "—"} · {c.adCount} ads
                            </div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Pre-launch (or retry-after-failure): ad set config + slot
              picker per variant. Stays open when a launch failed before
              any ads were created so the CM can tweak inputs + retry
              without closing the modal. Roy 2026-06-14. */}
          {!pickerOpen && !hasResults && (
            <>
              {/* Error banner — TOP of body so it can't get scrolled past
                  when the Geavanceerd panel is open below. Includes the
                  full Meta message + (when present) a template-fetch
                  summary showing what came back vs. what was missing —
                  so the CM can see whether the issue is "Meta returned
                  partial data" or "Meta validated and rejected".
                  Roy 2026-06-14. */}
              {error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400 space-y-2">
                  <div className="flex items-start gap-2 whitespace-pre-line">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">Meta heeft de push afgewezen</div>
                      <div className="mt-1 text-[12.5px] leading-relaxed">{error}</div>
                    </div>
                  </div>
                  {launchResponse?.templateSummary && (
                    <div className="rounded border border-red-500/20 bg-background/40 px-2.5 py-1.5 text-[11px] text-foreground/80">
                      <div className="font-mono uppercase tracking-wide text-[10px] text-muted-foreground mb-1">
                        Wat Pedro uit Meta haalde voor de bron ad set
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                        <FieldDot ok={launchResponse.templateSummary.hasTargeting} label="targeting" />
                        <FieldDot ok={launchResponse.templateSummary.hasBidStrategy} label="bid_strategy" />
                        <FieldDot ok={launchResponse.templateSummary.hasOptimizationGoal} label="optimization_goal" />
                        <FieldDot ok={launchResponse.templateSummary.hasBudget} label="budget" />
                        <FieldDot ok={launchResponse.templateSummary.hasBillingEvent} label="billing_event" />
                      </div>
                      {launchResponse.templateSummary.missingFields.length === 0 && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Alle settings kwamen volledig binnen — Meta keurde de combinatie
                          zelf af. Veelvoorkomende oorzaken: pixel / event-dataset waar de
                          hub system-user (nog) geen toegang toe heeft, verlopen custom
                          audience, of een objective-mismatch tussen bron-campagne en de
                          oorspronkelijke ad-set.
                        </div>
                      )}
                    </div>
                  )}
                  {launchResponse?.errorCode === "no_template" && (
                    <button
                      type="button"
                      onClick={() => {
                        setPickerOpen(true)
                        if (!candidates) void loadCandidates()
                      }}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 transition-colors"
                    >
                      Kies handmatig een ad set →
                    </button>
                  )}
                </div>
              )}

              {/* Ad set config - top-level container. Roy 2026-06-12:
                  true duplicate van de winning ad set (full targeting +
                  audience behouden), alleen de naam wordt overschreven
                  zodat de iteratie in Ads Manager direct herkenbaar is.
                  Roy 2026-06-14: bron-ad-set is nu altijd zichtbaar +
                  CM-overrideable bovenin deze sectie. */}
              {/* Roy 2026-06-14: when the server tells us the template
                  was incomplete (Pedro couldn't pull targeting / bid /
                  goal from Meta), surface a smart banner that points the
                  CM at the bron-ad-set picker BEFORE they fight with
                  override dropdowns. The dropdowns are still available
                  in Geavanceerd as a last-resort. */}
              {launchResponse?.templateIncomplete && !override && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium">
                        Pedro kon niet alle ad-set settings van de winner ophalen
                      </div>
                      <div className="text-[11px] opacity-90 mt-0.5">
                        Ontbrekende velden:{" "}
                        <span className="font-mono">
                          {(launchResponse.templateSummary?.missingFields ?? []).join(", ") || "—"}
                        </span>
                        . Daardoor mist de nieuwe ad set targeting / bid / optimization.
                        Beste fix: kies handmatig de winning ad set hieronder zodat de
                        duplicatie compleet is. (Override dropdowns blijven beschikbaar
                        onder Geavanceerd als laatste redmiddel.)
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPickerOpen(true)
                      if (!candidates) void loadCandidates()
                    }}
                    className="shrink-0 inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition-colors"
                  >
                    Kies ad set →
                  </button>
                </div>
              )}

              <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-sky-700 dark:text-sky-400 font-semibold">
                  Ad set (duplicate van winner)
                </div>

                {/* Bron ad set picker — always visible. Roy 2026-06-14:
                    the snapshot path can resolve to an ad set that's no
                    longer the "right" one (deleted / archived / targeting
                    changed), and the CM should always be able to pick
                    the exact ad set they want to clone — before launch,
                    not only as a failure recovery. */}
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    Bron ad set (clone target — targeting / bid / optimization erven hieruit)
                  </label>
                  {override ? (
                    <div className="flex items-start justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2">
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="font-medium text-foreground truncate">
                          {override.adsetName || "(naamloos)"}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate font-mono">
                          {override.campaignName || override.campaignId}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(true)
                            if (!candidates) void loadCandidates()
                          }}
                          className="inline-flex items-center h-7 px-2 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
                        >
                          Wijzig
                        </button>
                        <button
                          type="button"
                          onClick={() => setOverride(null)}
                          className="inline-flex items-center h-7 px-2 text-[11px] rounded-md hover:bg-amber-500/10 text-amber-700 dark:text-amber-400 transition-colors"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-2.5 py-2">
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="font-medium text-foreground">
                          Winning ad set (uit refresh-snapshot)
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Pedro pakt automatisch de ad set die de winning ad bevat.
                          Klopt niet? Kies hieronder een specifieke ad set.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setPickerOpen(true)
                          if (!candidates) void loadCandidates()
                        }}
                        className="shrink-0 inline-flex items-center h-7 px-2 text-[11px] rounded-md border border-border bg-background hover:bg-accent transition-colors"
                      >
                        Kies specifiek
                      </button>
                    </div>
                  )}
                </div>

                {/* Landing page URL — Roy 2026-06-15. Pre-filled from
                    the resolved winner / override when the Marketing API
                    surfaced a URL, blank otherwise. For "landing page
                    conversion" winners where Meta returns empty linkUrl
                    we previously hardcoded "https://www.facebook.com"
                    which Meta then rejected; now the CM can paste the
                    real landing page here. For lead-gen ads this can
                    stay empty — createAdCreative falls back to the
                    Page's Facebook URL automatically. */}
                <div className="space-y-1">
                  <label
                    htmlFor="pm-link-url"
                    className="text-[11px] text-muted-foreground"
                  >
                    Landing page URL{" "}
                    <span className="opacity-60">
                      (laat leeg voor lead-gen / instant form ads — anders verplicht)
                    </span>
                  </label>
                  <input
                    id="pm-link-url"
                    type="url"
                    value={landingPageUrl}
                    onChange={(e) => setLandingPageUrl(e.target.value)}
                    disabled={launching}
                    placeholder="https://example.com/landing — leeg = pakt winner's linkUrl"
                    className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 font-mono"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label
                      htmlFor="pm-adset-name"
                      className="text-[11px] text-muted-foreground"
                    >
                      Ad set name
                    </label>
                    <input
                      id="pm-adset-name"
                      type="text"
                      value={adsetName}
                      onChange={(e) => setAdsetName(e.target.value)}
                      disabled={launching}
                      maxLength={200}
                      placeholder="bv. Budget-pain / Vibecoding methodiek"
                      className={cn(
                        "w-full h-9 px-2.5 text-sm rounded-md border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 font-mono",
                        hintFor("adset_name")
                          ? "border-amber-500/60 ring-2 ring-amber-500/20"
                          : "border-border",
                      )}
                    />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor="pm-budget"
                      className="text-[11px] text-muted-foreground"
                    >
                      Daily budget (€)
                    </label>
                    <input
                      id="pm-budget"
                      type="text"
                      inputMode="decimal"
                      value={dailyBudgetEuros}
                      onChange={(e) => setDailyBudgetEuros(e.target.value)}
                      disabled={launching}
                      placeholder="25"
                      className={cn(
                        "w-full h-9 px-2.5 text-sm rounded-md border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 font-mono",
                        hintFor("daily_budget")
                          ? "border-amber-500/60 ring-2 ring-amber-500/20"
                          : "border-border",
                      )}
                    />
                  </div>
                </div>

                {/* Per-hint inline reason — surfaces under the matching
                    input so the CM knows exactly what Meta complained
                    about. */}
                {hintFor("adset_name") && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 -mt-1 flex items-start gap-1">
                    <Wand2 className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{hintFor("adset_name")!.reason}</span>
                  </div>
                )}
                {hintFor("daily_budget") && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 -mt-1 flex items-start gap-1">
                    <Wand2 className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      {hintFor("daily_budget")!.reason}{" "}
                      {hintFor("daily_budget")!.suggested !== undefined && (
                        <span className="font-mono">
                          (ingevuld: €{hintFor("daily_budget")!.suggested})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* Advanced overrides — toggle expand. Auto-opens when a
                    targeting / bid / optimization hint comes back from
                    the server. */}
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {advancedOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Geavanceerde overrides {advancedOpen ? "(verberg)" : "(targeting / bid strategy / optimization)"}
                </button>

                {advancedOpen && (
                  <div className="space-y-2 rounded-md border border-border bg-background p-2.5">
                    {/* Strip targeting toggle */}
                    <label
                      className={cn(
                        "flex items-start gap-2 cursor-pointer text-xs rounded-md p-2 -m-2 hover:bg-accent transition-colors",
                        hintFor("targeting") && "ring-2 ring-amber-500/30",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={stripTargeting}
                        onChange={(e) => setStripTargeting(e.target.checked)}
                        disabled={launching}
                        className="mt-0.5 accent-primary"
                      />
                      <div className="flex-1">
                        <div className="font-medium">Targeting strippen (Meta Advantage+)</div>
                        <div className="text-[11px] text-muted-foreground">
                          Wipet alle targeting (geo / leeftijd / interesses / audiences).
                          Meta&apos;s Advantage+ kiest dan de doelgroep. Goed bij verlopen
                          custom audiences of ongeldige geo-targets.
                        </div>
                      </div>
                    </label>
                    {hintFor("targeting") && (
                      <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1 -mt-1">
                        <Wand2 className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{hintFor("targeting")!.reason}</span>
                      </div>
                    )}

                    {/* Bid strategy override */}
                    <div className="space-y-1">
                      <label htmlFor="pm-bid" className="text-[11px] text-muted-foreground">
                        Bid strategy {!bidStrategyOverride && <span className="opacity-60">(default: erf van winner)</span>}
                      </label>
                      <select
                        id="pm-bid"
                        value={bidStrategyOverride}
                        onChange={(e) => setBidStrategyOverride(e.target.value)}
                        disabled={launching}
                        className={cn(
                          "w-full h-9 px-2 text-xs rounded-md border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
                          hintFor("bid_strategy")
                            ? "border-amber-500/60 ring-2 ring-amber-500/20"
                            : "border-border",
                        )}
                      >
                        <option value="">— inherit from winner —</option>
                        {BID_STRATEGY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {hintFor("bid_strategy") && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                          <Wand2 className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>{hintFor("bid_strategy")!.reason}</span>
                        </div>
                      )}
                    </div>

                    {/* Optimization goal override */}
                    <div className="space-y-1">
                      <label htmlFor="pm-opt" className="text-[11px] text-muted-foreground">
                        Optimization goal {!optimizationGoalOverride && <span className="opacity-60">(default: erf van winner)</span>}
                      </label>
                      <select
                        id="pm-opt"
                        value={optimizationGoalOverride}
                        onChange={(e) => setOptimizationGoalOverride(e.target.value)}
                        disabled={launching}
                        className={cn(
                          "w-full h-9 px-2 text-xs rounded-md border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
                          hintFor("optimization_goal")
                            ? "border-amber-500/60 ring-2 ring-amber-500/20"
                            : "border-border",
                        )}
                      >
                        <option value="">— inherit from winner —</option>
                        {OPTIMIZATION_GOAL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {hintFor("optimization_goal") && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                          <Wand2 className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>{hintFor("optimization_goal")!.reason}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-muted-foreground/80">
                  Volledige targeting + audience + placements + optimization goal
                  worden 1:1 overgenomen van winner&apos;s ad set, tenzij je hierboven
                  overschrijft. Alleen de naam krijgt sowieso een eigen identiteit.
                </div>
              </div>

              <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold pt-1">
                Ads in deze ad set ({totalSelected} geselecteerd)
              </div>

              {loading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Slots laden…
                </div>
              )}
              {!loading &&
                variants.map((variant) => {
                  if (!variant.variantId) {
                    return (
                      <div
                        key={variant.adName}
                        className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground"
                      >
                        {variant.label} - geen variantId. Refresh proposals opnieuw.
                      </div>
                    )
                  }
                  const slots = slotsByVariant.get(variant.variantId) ?? []
                  const sel = selected.get(variant.variantId) ?? new Set<number>()
                  return (
                    <div
                      key={variant.variantId}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="font-medium text-sm">{variant.label}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {variant.adName}
                          </div>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {sel.size > 0
                            ? `${sel.size} slot${sel.size === 1 ? "" : "s"} → ${sel.size} nieuwe ad${sel.size === 1 ? "" : "s"}`
                            : "deselected"}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[0, 1, 2].map((pos) => {
                          const slot = slots.find((s) => s.position === pos)
                          const hasImage = slot?.hasImage ?? false
                          const isSelected = sel.has(pos)
                          const slotLabel = SLOT_LABELS[pos]
                          return (
                            <button
                              key={pos}
                              type="button"
                              onClick={() => hasImage && toggleSlot(variant.variantId!, pos)}
                              disabled={!hasImage || launching}
                              className={cn(
                                "relative aspect-square rounded-md border-2 overflow-hidden transition-all",
                                hasImage && isSelected
                                  ? "border-primary ring-2 ring-primary/30"
                                  : hasImage
                                    ? "border-border hover:border-border/80"
                                    : "border-dashed border-border bg-muted/30 cursor-not-allowed",
                              )}
                            >
                              {hasImage && slot?.signedUrl ? (
                                /* eslint-disable-next-line @next/next/no-img-element */
                                <img
                                  src={slot.signedUrl}
                                  alt={`${variant.label} slot ${slotLabel}`}
                                  className={cn("w-full h-full object-cover", !isSelected && "opacity-60")}
                                />
                              ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground/50">
                                  (geen image)
                                </div>
                              )}
                              <div
                                className={cn(
                                  "absolute top-1 left-1 inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold shadow-sm",
                                  isSelected
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-background/90 backdrop-blur text-muted-foreground",
                                )}
                              >
                                {slotLabel}
                              </div>
                              {isSelected && (
                                <div className="absolute top-1 right-1 inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary text-primary-foreground shadow-sm">
                                  <Check className="h-3 w-3" />
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
            </>
          )}

          {/* Post-launch: per-result status — only when at least one
              push made it through to a per-slot result. Roy 2026-06-14. */}
          {hasResults && (
            <div className="space-y-3">
              {launchResponse.fallback && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <div className="font-medium">Fallback gebruikt</div>
                    <div>
                      {launchResponse.fallback.reason} Template:{" "}
                      <span className="font-mono">{launchResponse.fallback.templateAdName}</span>
                      {" "}uit ad set{" "}
                      <span className="font-mono">{launchResponse.fallback.templateAdsetName}</span>.
                      Check in Ads Manager of de nieuwe ad set in de juiste campagne staat.
                    </div>
                  </div>
                </div>
              )}
              {launchResponse.successCount! > 0 && launchResponse.adsManagerUrl && (
                <a
                  href={launchResponse.adsManagerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-sm font-medium rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open nieuwe ad set in Meta Ads Manager
                </a>
              )}
              <div className="text-xs text-muted-foreground">
                Ad set: <span className="font-mono">{launchResponse.adSetName}</span>
              </div>
              <div className="space-y-1.5">
                {(launchResponse?.results ?? []).map((r) => (
                  <div
                    key={`${r.variantId}-${r.slotPosition}`}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2.5 py-1.5 text-xs",
                      r.ok
                        ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                        : "bg-red-500/5 text-red-700 dark:text-red-400",
                    )}
                  >
                    {r.ok ? (
                      <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-mono">
                        Slot {SLOT_LABELS[r.slotPosition]} → {r.metaAdName ?? "(no name)"}
                      </div>
                      {r.error && <div className="opacity-80 mt-0.5">{r.error}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-card">
          <div className="text-xs text-muted-foreground">
            {hasResults
              ? `${launchResponse?.successCount ?? 0} / ${launchResponse?.totalCount ?? 0} ads gepushed`
              : `${totalSelected} ad${totalSelected === 1 ? "" : "s"} geselecteerd`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={launching}
              className="inline-flex items-center h-9 px-3.5 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {hasResults ? "Sluiten" : "Annuleer"}
            </button>
            {!hasResults && !pickerOpen && (
              <button
                type="button"
                onClick={launch}
                disabled={launching || totalSelected === 0 || !launchReady}
                title={
                  totalSelected === 0
                    ? "Selecteer minstens één ad slot"
                    : !adsetNameTrimmed
                      ? "Ad set name is verplicht"
                      : !budgetValid
                        ? "Vul een daily budget in (min €1/dag)"
                        : ""
                }
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              >
                {launching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {launching
                  ? "Pushing naar Meta…"
                  : launchResponse?.error
                    ? `Probeer opnieuw met aangepaste instellingen`
                    : `Maak ad set + ${totalSelected} ad${totalSelected === 1 ? "" : "s"} aan als concept (PAUSED)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Tiny status dot + field label used in the error banner's
 *  "what Pedro fetched from Meta" summary. Green dot = field came
 *  through; red dot = Meta returned null/empty for it. Roy 2026-06-14. */
function FieldDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          ok ? "bg-emerald-500" : "bg-red-500",
        )}
      />
      <span className={cn("text-[10.5px]", !ok && "line-through opacity-70")}>{label}</span>
    </span>
  )
}
