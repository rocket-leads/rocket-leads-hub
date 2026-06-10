"use client"

import { useState, useEffect, useCallback } from "react"
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  Check,
  ExternalLink,
} from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * PushToMetaModal — batch launch van een proposal naar Meta.
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

type Props = {
  open: boolean
  onClose: () => void
  refreshId: string
  proposalIndex: number
  winnerAdName: string
  variants: ProposalVariant[]
  /** Proposal's shared angle (preserve.angle) — fallback voor de
   *  default ad-set name als geen headline beschikbaar is. */
  proposalAngle: string
  /** Variant's on-image headline (Meta headline). Roy 2026-06-10:
   *  Pedro's gegenereerde of CM-aangepaste headline wint over de
   *  generieke angle als default ad set name. CM kan altijd nog
   *  overschrijven in het input veld. */
  variantHeadline?: string
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
  //      summary of what the ad set tests) — Roy 2026-06-10.
  //   2. proposal.preserve.angle (shared theme across the proposal).
  //   3. Empty NT | placeholder.
  // CM can always overwrite in the input. Trailing punctuation gets
  // stripped so "3x hogere marge?" doesn't end up as "NT | 3x hogere
  // marge?" in the ad set name.
  const cleanedHeadline = variantHeadline?.replace(/[?!.]+\s*$/, "").trim()
  const defaultSegment = cleanedHeadline || proposalAngle || ""
  const defaultAdsetName = defaultSegment
    ? `NT | ${defaultSegment}`.slice(0, 200)
    : "NT | "
  const [adsetName, setAdsetName] = useState(defaultAdsetName)
  const [dailyBudgetEuros, setDailyBudgetEuros] = useState<string>("")

  // Load slot states for each variant on open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setLaunchResponse(null)
    // Reset ad-set inputs each time the modal opens — the proposal /
    // angle can change between opens.
    setAdsetName(defaultAdsetName)
    setDailyBudgetEuros("")

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
      const res = await fetch(
        `/api/pedro/proposals/${encodeURIComponent(refreshId)}/${proposalIndex}/push-to-meta`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variants: payload,
            adsetName: adsetNameTrimmed,
            dailyBudgetEuros: budgetParsed,
          }),
        },
      )
      const json: LaunchResponse = await res.json()
      if (!res.ok || json.error) {
        setError(json.error || `HTTP ${res.status}`)
        setLaunchResponse(json)
        return
      }
      setLaunchResponse(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Launch mislukt")
    } finally {
      setLaunching(false)
    }
  }, [launching, launchReady, selected, refreshId, proposalIndex, adsetNameTrimmed, budgetParsed])

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
              Eén nieuwe ad set (NT — no interest targeting) wordt aangemaakt in
              dezelfde campagne, met dezelfde geo / leeftijd / placements als de
              winner.{" "}
              <span className="font-medium text-amber-700 dark:text-amber-400">
                Status: PAUSED (= concept).
              </span>{" "}
              Niets gaat live, geen euro spend. Verschijnt in Ads Manager onder
              deze campagne — je controleert + activeert zelf wanneer je klaar
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
          {/* Pre-launch: ad set config + slot picker per variant */}
          {!launchResponse && (
            <>
              {/* Ad set config — top-level container. Roy 2026-06-10: NT
                  ad set with the angle in the name, daily budget editable
                  per launch. */}
              <div className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-sky-700 dark:text-sky-400 font-semibold">
                  Ad set (NT — no interest targeting)
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
                      placeholder="NT | verse sappen = hogere marges"
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
                  Geo, leeftijd, placements en optimization goal worden 1:1
                  overgenomen van winner&apos;s ad set. Interests &amp; behaviors
                  worden weggehaald.
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
                        {variant.label} — geen variantId. Refresh proposals opnieuw.
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

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-start gap-2 whitespace-pre-line">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
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
            {!launchResponse && (
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
