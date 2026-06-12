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
      const res = await fetch(
        `/api/pedro/template-candidates/${encodeURIComponent(clientId)}?windowDays=90`,
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
  ])

  const pickCandidate = useCallback((c: TemplateCandidate) => {
    if (!c.representativeAd) return
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
                    Snapshot is niet meer bruikbaar. Kies handmatig welke ad set
                    gekloond moet worden (budget / targeting / placements / page
                    + IG / lead-form worden hieruit overgenomen). 90d performance
                    helpt je kiezen.
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
                  Ad sets laden (90 dagen)…
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

          {/* Pre-launch: ad set config + slot picker per variant */}
          {!pickerOpen && !launchResponse && (
            <>
              {override && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Handmatige template-keuze actief</div>
                      <div className="font-mono">{override.adsetName}</div>
                      <div className="text-[11px] opacity-80">
                        {override.campaignName || override.campaignId}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOverride(null)}
                    className="inline-flex items-center h-7 px-2 text-[11px] rounded-md hover:bg-amber-500/10 transition-colors"
                  >
                    Reset
                  </button>
                </div>
              )}
              {/* Ad set config - top-level container. Roy 2026-06-12:
                  true duplicate van de winning ad set (full targeting +
                  audience behouden), alleen de naam wordt overschreven
                  zodat de iteratie in Ads Manager direct herkenbaar is. */}
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-sky-700 dark:text-sky-400 font-semibold">
                  Ad set (duplicate van winner)
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
                      className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 font-mono"
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
                      className="w-full h-9 px-2.5 text-sm rounded-md border border-border bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 font-mono"
                    />
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground/80">
                  Volledige targeting + audience + placements + optimization goal
                  worden 1:1 overgenomen van winner&apos;s ad set. Alleen de naam
                  krijgt een eigen identiteit.
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

          {/* Post-launch: per-result status */}
          {launchResponse && launchResponse.results && (
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
                {launchResponse.results.map((r) => (
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

          {error && !pickerOpen && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400 space-y-2">
              <div className="flex items-start gap-2 whitespace-pre-line">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {error}
              </div>
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
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 px-6 py-3 border-t border-border bg-card">
          <div className="text-xs text-muted-foreground">
            {launchResponse
              ? `${launchResponse.successCount ?? 0} / ${launchResponse.totalCount ?? 0} ads gepushed`
              : `${totalSelected} ad${totalSelected === 1 ? "" : "s"} geselecteerd`}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={launching}
              className="inline-flex items-center h-9 px-3.5 rounded-md text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              {launchResponse ? "Sluiten" : "Annuleer"}
            </button>
            {!launchResponse && !pickerOpen && (
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
                  : `Maak ad set + ${totalSelected} ad${totalSelected === 1 ? "" : "s"} aan als concept (PAUSED)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
