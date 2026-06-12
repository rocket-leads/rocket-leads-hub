"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  CheckCircle2,
  Target,
  Compass,
  Megaphone,
  Video,
  FileText,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  ImageIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AdPicker } from "./ad-picker"
import { ScriptRefresh } from "./script-refresh"
import { LpRefresh } from "./lp-refresh"
import {
  VariantCard,
  type CreativeProposal,
  type CreativeVariant,
} from "./creative-refresh"
import { ImageSourcesPicker } from "./image-sources-picker"
import { PushToMetaModal } from "./push-to-meta-modal"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

/**
 * OptimizeWizard - Roy 2026-06-11 v3 reorg. Vervangt de tab-based UX
 * van pedro-optimize-app door een step-wizard die de onboarding-shell
 * spiegelt: links een rail met genummerde stappen + checkmark, rechts
 * de actieve stap. Typografie volgt de wizard-conventie zodat alles
 * dezelfde hiërarchie heeft:
 *
 *   - Step label  : text-[10px] uppercase tracking-wide muted
 *   - Step title  : font-heading text-lg font-semibold
 *   - Step desc   : text-xs muted
 *   - Rail number : 5x5 rounded-full text-[10px]
 *   - Body        : text-sm (refreshes brengen hun eigen interne hiërarchie)
 *
 * De Stap 1 ad-pick wordt opgeslagen in localStorage per klant, zodat
 * het carry-overt door alle volgende stappen. Steps zijn altijd
 * klikbaar - de CM mag in elke volgorde door, net als de onboarding
 * wizard (Roy 2026-06-11: "no hard locks").
 */

type StepKey =
  | "pick_ad"
  | "select_variants"
  | "edit_copy"
  | "generate_creatives"
  | "push_meta"
type OverigKey = "lp_prompt" | "video_scripts"
type ActiveKey = StepKey | OverigKey

type StepDef = {
  key: StepKey
  order: number
  title: string
  icon: typeof Compass
}

type OverigDef = {
  key: OverigKey
  title: string
  icon: typeof Compass
}

// Roy 2026-06-12 v8: 5-step flow. Edit copy + creative-gen leven nu
// als losse steps zodat de CM eerst rustig de copy kan bijschaven en
// daarna op een eigen surface de Gemini-images genereert/itereert.
//   1. pick_ad             - Kies winning ad in Meta
//   2. select_variants     - Multi-select gegenereerde Pedro-varianten
//   3. edit_copy           - Edit headline + primary + alt copy (geen images)
//   4. generate_creatives  - Genereer 3 Gemini-images per variant + itereren
//   5. push_meta           - Review + budget + naar Meta
const STEPS: StepDef[] = [
  { key: "pick_ad", order: 1, title: "Kies winning ad", icon: Target },
  { key: "select_variants", order: 2, title: "Kies varianten", icon: Compass },
  { key: "edit_copy", order: 3, title: "Edit copy", icon: FileText },
  { key: "generate_creatives", order: 4, title: "Genereer creatives", icon: Sparkles },
  { key: "push_meta", order: 5, title: "Push naar Meta", icon: Megaphone },
]

// Roy 2026-06-11 v7: video scripts + LP prompt zitten naast de iteratie
// flow als losse rail-sectie "OVERIG", niet als grote banner onderaan.
const OVERIG: OverigDef[] = [
  { key: "lp_prompt", title: "LP prompt", icon: FileText },
  { key: "video_scripts", title: "Video scripts", icon: Video },
]

type PickedAd = {
  adId: string
  adName: string
  campaignName: string
  screenshotPath: string | null
}

function pickedAdKey(clientId: string): string {
  return `pedro.optimize.pickedAd.${clientId}`
}

function readPickedAd(clientId: string | null): PickedAd | null {
  if (!clientId || typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(pickedAdKey(clientId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as PickedAd
    if (!parsed?.adId) return null
    return parsed
  } catch {
    return null
  }
}

function writePickedAd(clientId: string, picked: PickedAd | null): void {
  if (typeof window === "undefined") return
  try {
    if (picked) window.localStorage.setItem(pickedAdKey(clientId), JSON.stringify(picked))
    else window.localStorage.removeItem(pickedAdKey(clientId))
  } catch {
    /* private mode / quota - ignore */
  }
}

type Props = {
  selectedClientId: string
  selectedClientName: string
  autoStart?: boolean
}

export function OptimizeWizard({
  selectedClientId,
  selectedClientName,
  autoStart,
}: Props) {
  const locale = useLocale()
  // Active step starts at the first step the CM hasn't completed yet -
  // i.e., pick_ad when no ad is picked, angles otherwise. The CM can
  // always navigate by clicking the rail.
  const [pickedAd, setPickedAd] = useState<PickedAd | null>(() =>
    readPickedAd(selectedClientId),
  )
  const [activeKey, setActiveKey] = useState<ActiveKey>(() =>
    readPickedAd(selectedClientId) ? "select_variants" : "pick_ad",
  )
  // Generation result + state. Roy 2026-06-12 v7: Step 1's generate
  // button fires /api/pedro/creative-refresh; the proposals land in
  // refreshResult and Step 2 renders them. selectedVariants drives
  // what Step 3 shows (image gen + push).
  const [refreshResult, setRefreshResult] = useState<{
    refreshId: string
    proposals: CreativeProposal[]
  } | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [selectedVariantKeys, setSelectedVariantKeys] = useState<Set<string>>(
    new Set(),
  )
  // Image-gen state. Roy 2026-06-12 v8: Step 3's "Genereer creatives"
  // CTA fires gen for elke geselecteerde variant in parallel; Step 4
  // shows progress + iteratie. inFlight = variantIds currently being
  // generated; resultsByVariant = laatste gen-uitkomst per variantId.
  const [imageGenInFlight, setImageGenInFlight] = useState<Set<string>>(new Set())
  const [imageGenResultsByVariant, setImageGenResultsByVariant] = useState<
    Record<string, { ok: boolean; error?: string; completedAt: string }>
  >({})

  // Reset when client changes.
  useEffect(() => {
    const stored = readPickedAd(selectedClientId)
    setPickedAd(stored)
    setActiveKey(stored ? "select_variants" : "pick_ad")
    setRefreshResult(null)
    setIsGenerating(false)
    setGenerateError(null)
    setSelectedVariantKeys(new Set())
    setImageGenInFlight(new Set())
    setImageGenResultsByVariant({})
  }, [selectedClientId])

  const updatePickedAd = useCallback(
    (next: PickedAd | null) => {
      setPickedAd(next)
      writePickedAd(selectedClientId, next)
    },
    [selectedClientId],
  )

  // Fire the creative-refresh call from Step 1's generate button.
  // Step 2 reads from refreshResult; Step 3 reads from selectedVariantKeys.
  const startGenerate = useCallback(
    async (sourceAdId: string, sourceScreenshotPath?: string) => {
      setIsGenerating(true)
      setGenerateError(null)
      setRefreshResult(null)
      setActiveKey("select_variants")
      try {
        const res = await fetch("/api/pedro/creative-refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: selectedClientId,
            sourceAdId,
            ...(sourceScreenshotPath ? { sourceScreenshotPath } : {}),
            days: 90,
          }),
        })
        const json = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || `HTTP ${res.status}`)
        }
        const proposals: CreativeProposal[] = Array.isArray(json.proposals)
          ? json.proposals
          : []
        const refreshId: string = typeof json.refreshId === "string" ? json.refreshId : ""
        if (!refreshId || proposals.length === 0) {
          throw new Error("Pedro gaf geen varianten terug. Probeer opnieuw.")
        }
        setRefreshResult({ refreshId, proposals })
        // Roy 2026-06-12: default selection = alleen Variant A (de
        // bijna-verbatim kopie van de source). CM vinkt zelf de andere
        // iteraties aan als die ook gewenst zijn. Voorheen waren alle 3
        // standaard aan, wat de CM dwong om uit te vinken ipv te kiezen.
        const firstOnly = new Set<string>()
        proposals.forEach((p, pi) => {
          if (p.variants.length > 0) firstOnly.add(`${pi}:0`)
        })
        setSelectedVariantKeys(firstOnly)
      } catch (e) {
        setGenerateError(e instanceof Error ? e.message : "Genereren mislukt")
      } finally {
        setIsGenerating(false)
      }
    },
    [selectedClientId],
  )

  const toggleVariantSelected = useCallback((key: string) => {
    setSelectedVariantKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /**
   * Fire image-generation in parallel for all selected variants.
   * Used by Step 3's "Genereer creatives" CTA - moves the CM to
   * Step 4 immediately and Step 4 polls the per-variant GET endpoint
   * via VariantImagePanel's own useEffect.
   */
  const startBulkImageGen = useCallback(
    async (variantIds: string[]) => {
      if (variantIds.length === 0) return
      setImageGenInFlight(new Set(variantIds))
      setImageGenResultsByVariant({})
      // Fire all in parallel - each is bounded by maxDuration=60 on
      // the route. We track completions individually so the panel can
      // un-loader per variant as soon as its own POST returns.
      await Promise.allSettled(
        variantIds.map(async (vid) => {
          try {
            const res = await fetch(
              `/api/pedro/variants/${encodeURIComponent(vid)}/generate-image`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ slots: 3 }),
              },
            )
            const json = await res.json().catch(() => ({}))
            const ok = res.ok && !json.error
            setImageGenResultsByVariant((prev) => ({
              ...prev,
              [vid]: {
                ok,
                error: ok ? undefined : (json.error ?? `HTTP ${res.status}`),
                completedAt: new Date().toISOString(),
              },
            }))
          } catch (e) {
            setImageGenResultsByVariant((prev) => ({
              ...prev,
              [vid]: {
                ok: false,
                error: e instanceof Error ? e.message : "Image gen failed",
                completedAt: new Date().toISOString(),
              },
            }))
          } finally {
            setImageGenInFlight((prev) => {
              const next = new Set(prev)
              next.delete(vid)
              return next
            })
          }
        }),
      )
    },
    [],
  )

  const doneFor = useCallback(
    (key: StepKey): boolean => {
      if (key === "pick_ad") return !!pickedAd
      if (key === "select_variants") return !!refreshResult
      if (key === "edit_copy") return selectedVariantKeys.size > 0 && !!refreshResult
      if (key === "generate_creatives") {
        // Done = all selected variants have a successful gen result
        // (or images already exist - we treat presence as done, but
        // that lives in VariantImagePanel's own state. Here we only
        // know about gens we kicked off from Step 3.)
        if (!refreshResult || selectedVariantKeys.size === 0) return false
        const variantIds: string[] = []
        refreshResult.proposals.forEach((p, pi) => {
          p.variants.forEach((v, vi) => {
            if (selectedVariantKeys.has(`${pi}:${vi}`) && v.variantId) {
              variantIds.push(v.variantId)
            }
          })
        })
        if (variantIds.length === 0) return false
        return variantIds.every((id) => imageGenResultsByVariant[id]?.ok)
      }
      if (key === "push_meta") return false // tracked elsewhere; visual only
      return false
    },
    [pickedAd, refreshResult, selectedVariantKeys, imageGenResultsByVariant],
  )

  const totalDone = useMemo(
    () => STEPS.filter((s) => doneFor(s.key)).length,
    [doneFor],
  )

  const activeStep = STEPS.find((s) => s.key === activeKey)
  const activeOverig = OVERIG.find((o) => o.key === activeKey)
  // Always have a non-null active for the right pane. Default = first step.
  const activeStepOrOverig: StepDef | OverigDef = activeStep ?? activeOverig ?? STEPS[0]

  return (
    <div className="space-y-4">
      {/* Progress bar - same chrome as the onboarding wizard, so the
          Pedro Optimize page feels like a sibling surface. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("pedro.optimize.header.label", locale)}
          </div>
          <h2 className="font-heading text-lg font-semibold tracking-tight leading-tight text-foreground mt-0.5">
            {selectedClientName || t("pedro.optimize.header.no_client", locale)}
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("pedro.optimize.progress.label", locale)}
          </div>
          <div className="text-sm font-medium tabular-nums">
            {totalDone} / {STEPS.length} · {Math.round((totalDone / STEPS.length) * 100)}%
          </div>
        </div>
      </div>

      <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.round((totalDone / STEPS.length) * 100)}%` }}
        />
      </div>

      {/* Wizard body - rail + active step. Same grid as onboarding.
          Roy 2026-06-11 v7: Overig zit nu in het rail (sibling sectie
          onder Iteratie flow), niet meer als grote banner onder de
          wizard. Same chrome als de iteratie flow zelf. */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Rail */}
        <nav className="space-y-3 rounded-2xl border border-border/60 bg-card p-2 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
          {/* Iteratie flow sectie */}
          <div>
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              {t("pedro.optimize.rail.iteration_flow", locale)}
            </div>
            <div className="space-y-1">
              {STEPS.map((step) => (
                <StepRailItem
                  key={step.key}
                  step={step}
                  active={activeKey === step.key}
                  done={doneFor(step.key)}
                  onClick={() => setActiveKey(step.key)}
                  locale={locale}
                />
              ))}
            </div>
          </div>
          {/* Overig sectie */}
          <div>
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
              {t("pedro.optimize.rail.other", locale)}
            </div>
            <div className="space-y-1">
              {OVERIG.map((item) => (
                <OverigRailItem
                  key={item.key}
                  item={item}
                  active={activeKey === item.key}
                  onClick={() => setActiveKey(item.key)}
                  locale={locale}
                />
              ))}
            </div>
          </div>
        </nav>

        {/* Right pane - active step content */}
        <div className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] overflow-hidden">
          <StepHeader item={activeStepOrOverig} locale={locale} />
          {pickedAd && activeKey !== "pick_ad" && activeKey !== "lp_prompt" && (
            <SourceAdBanner
              picked={pickedAd}
              onReset={() => {
                updatePickedAd(null)
                setActiveKey("pick_ad")
              }}
              locale={locale}
            />
          )}
          <div className="p-5">
            {activeKey === "pick_ad" && (
              <PickAdStep
                clientId={selectedClientId}
                currentPicked={pickedAd}
                onGenerate={async (picked, screenshotPath) => {
                  updatePickedAd(picked)
                  await startGenerate(picked.adId, screenshotPath ?? undefined)
                }}
                isGenerating={isGenerating}
                locale={locale}
              />
            )}
            {activeKey === "select_variants" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <SelectVariantsStep
                  isGenerating={isGenerating}
                  error={generateError}
                  result={refreshResult}
                  selectedKeys={selectedVariantKeys}
                  onToggle={toggleVariantSelected}
                  onContinue={() => setActiveKey("edit_copy")}
                  onRetry={() =>
                    pickedAd?.adId
                      ? startGenerate(pickedAd.adId, pickedAd.screenshotPath ?? undefined)
                      : null
                  }
                />
              </StepGate>
            )}
            {activeKey === "edit_copy" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <EditCopyStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKeys={selectedVariantKeys}
                  onBackToSelection={() => setActiveKey("select_variants")}
                  onGenerateCreatives={async () => {
                    if (!refreshResult) return
                    const variantIds: string[] = []
                    refreshResult.proposals.forEach((p, pi) => {
                      p.variants.forEach((v, vi) => {
                        if (selectedVariantKeys.has(`${pi}:${vi}`) && v.variantId) {
                          variantIds.push(v.variantId)
                        }
                      })
                    })
                    // Move forward immediately so the CM ziet de
                    // progress UI op Step 4 - geen wachten op alle gens.
                    setActiveKey("generate_creatives")
                    await startBulkImageGen(variantIds)
                  }}
                />
              </StepGate>
            )}
            {activeKey === "generate_creatives" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <GenerateCreativesStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKeys={selectedVariantKeys}
                  inFlightVariantIds={imageGenInFlight}
                  resultsByVariant={imageGenResultsByVariant}
                  onBackToCopy={() => setActiveKey("edit_copy")}
                  onContinueToPush={() => setActiveKey("push_meta")}
                  onRetryVariant={(vid) => startBulkImageGen([vid])}
                />
              </StepGate>
            )}
            {activeKey === "push_meta" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <PushMetaStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKeys={selectedVariantKeys}
                  onBackToCreatives={() => setActiveKey("generate_creatives")}
                />
              </StepGate>
            )}
            {activeKey === "lp_prompt" && (
              <LpRefresh
                selectedClientId={selectedClientId}
                selectedClientName={selectedClientName}
                hideShellHeader
              />
            )}
            {activeKey === "video_scripts" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <ScriptRefresh
                  selectedClientId={selectedClientId}
                  selectedClientName={selectedClientName}
                  autoStart={autoStart}
                  hideShellHeader
                />
              </StepGate>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepRailItem({
  step,
  active,
  done,
  onClick,
  locale,
}: {
  step: StepDef
  active: boolean
  done: boolean
  onClick: () => void
  locale: import("@/lib/i18n/types").Locale
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
        active && "bg-primary/10 text-foreground",
        !active && "hover:bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 h-5 w-5 flex items-center justify-center rounded-full text-[10px] font-medium tabular-nums",
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <CheckCircle2 className="h-3 w-3" /> : step.order}
      </span>
      <span className={cn("flex-1 truncate", done && "text-muted-foreground/70")}>
        {step.title}
      </span>
    </button>
  )
}

function OverigRailItem({
  item,
  active,
  onClick,
  locale,
}: {
  item: OverigDef
  active: boolean
  onClick: () => void
  locale: import("@/lib/i18n/types").Locale
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
        active && "bg-primary/10 text-foreground",
        !active && "hover:bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 h-5 w-5 flex items-center justify-center rounded-full",
          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="flex-1 truncate">{item.title}</span>
    </button>
  )
}

function isStepDef(x: StepDef | OverigDef): x is StepDef {
  return (x as StepDef).order !== undefined
}

function StepHeader({
  item,
  locale,
}: {
  item: StepDef | OverigDef
  locale: import("@/lib/i18n/types").Locale
}) {
  const Icon = item.icon
  const label = isStepDef(item)
    ? t("pedro.optimize.step.label", locale, { n: item.order, total: STEPS.length })
    : t("pedro.optimize.step.label.other", locale)
  return (
    <div className="px-5 pt-5 pb-3 border-b border-border/40">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        <span>{label}</span>
      </div>
      <h2 className="font-heading text-lg font-semibold leading-tight flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {item.title}
      </h2>
    </div>
  )
}

function SourceAdBanner({
  picked,
  onReset,
  locale,
}: {
  picked: PickedAd
  onReset: () => void
  locale: import("@/lib/i18n/types").Locale
}) {
  return (
    <div className="px-5 py-2.5 border-b border-border/40 bg-emerald-500/5 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <span className="text-muted-foreground">{t("pedro.optimize.source_ad.label", locale)}</span>
        <span className="font-mono text-foreground truncate">{picked.adName}</span>
        {picked.campaignName && (
          <span className="text-muted-foreground/70 truncate hidden md:inline">
            · {picked.campaignName}
          </span>
        )}
        {picked.screenshotPath && (
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 rounded bg-emerald-500/10">
            {t("pedro.optimize.source_ad.screenshot", locale)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        {t("pedro.optimize.source_ad.change", locale)}
      </button>
    </div>
  )
}

function StepGate({
  clientId,
  pickedAd,
  children,
  locale,
}: {
  clientId: string
  pickedAd: PickedAd | null
  children: React.ReactNode
  locale: import("@/lib/i18n/types").Locale
}) {
  if (!clientId) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("pedro.optimize.gate.no_client", locale)}
      </div>
    )
  }
  if (!pickedAd) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        {t("pedro.optimize.gate.no_ad", locale)}
      </div>
    )
  }
  return <>{children}</>
}

/**
 * PickAdStep - wraps the existing AdPicker but vervangt de "Genereer"
 * actie door "Volgende stap": de pick wordt opgeslagen in wizard state,
 * en de wizard switcht naar Stap 2. Geen API call hier.
 */
function PickAdStep({
  clientId,
  currentPicked,
  onGenerate,
  isGenerating,
  locale,
}: {
  clientId: string
  currentPicked: PickedAd | null
  onGenerate: (picked: PickedAd, screenshotPath: string | null) => Promise<void>
  isGenerating: boolean
  locale: import("@/lib/i18n/types").Locale
}) {
  // Roy 2026-06-12 v7: AdPicker's "Genereer" knop fires the actual
  // creative-refresh API call. We enrich the picked ad metadata (name,
  // campaignName) before firing so Step 2's source-ad banner has full
  // info to show.
  const handleGenerate = useCallback(
    async (extra: { sourceAdId: string; sourceScreenshotPath?: string }) => {
      let adName = ""
      let campaignName = ""
      try {
        const res = await fetch(
          `/api/pedro/campaigns-with-ads/${encodeURIComponent(clientId)}`,
        )
        const json = (await res.json().catch(() => ({}))) as {
          campaigns?: Array<{
            name: string
            ads: Array<{ adId: string; adName: string }>
          }>
        }
        for (const c of json.campaigns ?? []) {
          const hit = c.ads.find((a) => a.adId === extra.sourceAdId)
          if (hit) {
            adName = hit.adName
            campaignName = c.name
            break
          }
        }
      } catch {
        /* fall through to id-only enrichment */
      }
      const picked: PickedAd = {
        adId: extra.sourceAdId,
        adName: adName || extra.sourceAdId,
        campaignName,
        screenshotPath: extra.sourceScreenshotPath ?? null,
      }
      await onGenerate(picked, picked.screenshotPath)
    },
    [clientId, onGenerate],
  )

  return (
    <div className="space-y-3">
      {currentPicked && (
        <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("pedro.optimize.pick_ad.current", locale)}: <span className="font-mono text-foreground">{currentPicked.adName}</span>
          . {t("pedro.optimize.pick_ad.confirm_hint", locale)}
        </div>
      )}
      <AdPicker
        clientId={clientId}
        loading={isGenerating}
        hasOutput={false}
        onGenerate={handleGenerate}
      />
    </div>
  )
}

function SelectVariantsStep({
  isGenerating,
  error,
  result,
  selectedKeys,
  onToggle,
  onContinue,
  onRetry,
}: {
  isGenerating: boolean
  error: string | null
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKeys: Set<string>
  onToggle: (key: string) => void
  onContinue: () => void
  onRetry: () => void
}) {
  if (isGenerating) {
    return <GeneratingProgress />
  }
  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-5 space-y-3">
        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium">Genereren mislukt</div>
            <div className="text-xs whitespace-pre-line">{error}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Probeer opnieuw
        </button>
      </div>
    )
  }
  if (!result) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Nog geen varianten gegenereerd. Ga terug naar Stap 1 en klik &quot;Genereer 3 varianten&quot;.
      </div>
    )
  }
  const totalVariants = result.proposals.reduce(
    (n, p) => n + p.variants.length,
    0,
  )
  const totalSelected = selectedKeys.size
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{totalVariants} varianten</span>{" "}
          gegenereerd op basis van source ad. Vink uit wat je niet wil, dan ga je naar Creatives.
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {totalSelected} / {totalVariants} geselecteerd
          </div>
          <button
            type="button"
            onClick={onContinue}
            disabled={totalSelected === 0}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            Naar creatives
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-4">
        {result.proposals.map((p, pi) => (
          <ProposalSelectionCard
            key={`${p.basedOnAd.adId}-${pi}`}
            proposal={p}
            proposalIndex={pi}
            selectedKeys={selectedKeys}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}

function ProposalSelectionCard({
  proposal,
  proposalIndex,
  selectedKeys,
  onToggle,
}: {
  proposal: CreativeProposal
  proposalIndex: number
  selectedKeys: Set<string>
  onToggle: (key: string) => void
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-violet-600 dark:text-violet-400 font-semibold">
        Iteratie op {proposal.basedOnAd.adName}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {proposal.variants.map((v, vi) => {
          const key = `${proposalIndex}:${vi}`
          const checked = selectedKeys.has(key)
          return (
            <VariantSelectionCard
              key={key}
              variant={v}
              checked={checked}
              onToggle={() => onToggle(key)}
            />
          )
        })}
      </div>
    </div>
  )
}

/**
 * GeneratingProgress - Roy 2026-06-12 v2: vervangt de statische
 * spinner door een asymptotische progress bar die altijd doortikt
 * (nooit stilstaat) en asymptotisch naar 99% kruipt zonder ooit
 * te raken. Geen "blocked at 95%" gevoel meer.
 *
 * Curve: progress(t) = 0.99 * (1 - exp(-t/TAU))
 *   t=10s → 39%
 *   t=20s → 63%
 *   t=30s → 77%
 *   t=45s → 89%
 *   t=60s → 94%
 *   t=90s → 98%
 *   t→∞ → 99%
 *
 * Stages cyclen door de bekende fases - na de laatste fase
 * herhalen we de polish-melding zodat er altijd iets te lezen is.
 */
const GENERATE_STAGES: Array<{ label: string; weight: number }> = [
  { label: "Pedro leest de source ad…", weight: 0.08 },
  { label: "Pedro analyseert de primary copy + headline…", weight: 0.10 },
  { label: "Pedro bekijkt branche-strategie + voice corpus…", weight: 0.13 },
  { label: "Pedro denkt: hoe behoud ik dezelfde DNA?", weight: 0.10 },
  { label: "Pedro schrijft Variant A (near-verbatim hercreatie)…", weight: 0.15 },
  { label: "Pedro schrijft Variant B (hook-twist iteratie)…", weight: 0.13 },
  { label: "Pedro schrijft Variant C (hook-twist iteratie)…", weight: 0.13 },
  { label: "Pedro polisht de output + spelling check…", weight: 0.18 },
]
// TAU controls hoe snel de bar oploopt. 22s = redelijk mid-tempo:
// na 30s zit je rond 76%, na 60s rond 94% - voelt nooit te traag of
// te snel ongeacht of de API in 25 of 90 seconden klaar is.
const TAU_MS = 22000

function GeneratingProgress() {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => {
      setElapsed(Date.now() - start)
    }, 200)
    return () => clearInterval(id)
  }, [])

  // Asymptotische curve: 0.99 * (1 - e^(-t/TAU)). Kapt asymptotisch
  // naar 99% maar raakt 'm nooit, dus de bar tikt altijd door.
  const progress = 0.99 * (1 - Math.exp(-elapsed / TAU_MS))

  // Stage label uit dezelfde curve - elke stage krijgt zijn aandeel
  // van de curve gebaseerd op weight. Pedro's output polish blijft
  // staan zodra we voorbij de laatste stage zijn.
  let cumulativeWeight = 0
  let currentStageIdx = GENERATE_STAGES.length - 1
  for (let i = 0; i < GENERATE_STAGES.length; i++) {
    cumulativeWeight += GENERATE_STAGES[i].weight
    if (progress < cumulativeWeight) {
      currentStageIdx = i
      break
    }
  }
  const currentLabel = GENERATE_STAGES[currentStageIdx].label

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-8 space-y-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-heading font-semibold text-base">
            Pedro genereert varianten…
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {Math.round(progress * 100)}%
          </div>
        </div>
        <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        <span className="leading-tight">{currentLabel}</span>
      </div>
    </div>
  )
}

function VariantSelectionCard({
  variant,
  checked,
  onToggle,
}: {
  variant: CreativeVariant
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "text-left rounded-lg border-2 p-4 space-y-3 transition-colors w-full",
        checked
          ? "border-primary bg-primary/5"
          : "border-border bg-background hover:bg-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-heading font-semibold text-sm leading-tight">
          {variant.label}
        </div>
        <div
          className={cn(
            "shrink-0 h-4 w-4 rounded-md border-2 flex items-center justify-center",
            checked
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card",
          )}
        >
          {checked && <CheckCircle2 className="h-3 w-3" />}
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground font-mono truncate">
        {variant.adName}
      </div>
      {/* Tekst op afbeelding (Meta headline) - Roy 2026-06-12: opvallend
          weergeven want dit is wat de doelgroep als eerste leest. Paars,
          bold, geen quotes. */}
      {variant.headline && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Tekst op afbeelding
          </div>
          <div className="text-sm font-bold leading-snug text-violet-600 dark:text-violet-400">
            {variant.headline}
          </div>
        </div>
      )}
      {/* Primary copy - volledig zichtbaar, geen line-clamp meer. CM
          moet de hele invalshoek kunnen lezen om te beslissen. */}
      {variant.primaryCopySnippet && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Primary copy
          </div>
          <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
            {variant.primaryCopySnippet}
          </div>
        </div>
      )}
      {/* Meta headline veld (kort, naast on-image). Vaak iets korter
          dan de on-image tekst, geoptimaliseerd voor onder de creative. */}
      {variant.altHeadlines && variant.altHeadlines.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Headline (Meta veld)
          </div>
          <div className="text-xs text-foreground space-y-0.5">
            {variant.altHeadlines.filter((h) => h.trim()).slice(0, 2).map((h, i) => (
              <div key={i}>{h}</div>
            ))}
          </div>
        </div>
      )}
      {variant.sourceHookQuote && (
        <div className="text-[10px] text-muted-foreground italic border-t border-border/40 pt-2">
          Bron-hook: &ldquo;{variant.sourceHookQuote}&rdquo;
        </div>
      )}
    </button>
  )
}

/**
 * Resolve the selected variants into pairs - shared helper for the
 * 3 wizard steps that all read from refreshResult + selectedKeys.
 */
function resolveSelectedPairs(
  result: { refreshId: string; proposals: CreativeProposal[] } | null,
  selectedKeys: Set<string>,
): Array<{
  proposalIndex: number
  proposal: CreativeProposal
  variantIndex: number
  variant: CreativeVariant
}> {
  if (!result) return []
  const out: Array<{
    proposalIndex: number
    proposal: CreativeProposal
    variantIndex: number
    variant: CreativeVariant
  }> = []
  result.proposals.forEach((p, pi) => {
    p.variants.forEach((v, vi) => {
      if (selectedKeys.has(`${pi}:${vi}`)) {
        out.push({ proposalIndex: pi, proposal: p, variantIndex: vi, variant: v })
      }
    })
  })
  return out
}

/**
 * EditCopyStep - Roy 2026-06-12 v8 (Stap 3 in 5-step wizard).
 * Inline-editable copy fields per geselecteerde variant: tekst op
 * afbeelding, primary copy, alt headlines, alt primary texts, link
 * description. GEEN image-gen hier; CTA "Genereer creatives" triggert
 * de batch gen en navigeert naar Stap 4.
 */
function EditCopyStep({
  clientId,
  result,
  selectedKeys,
  onBackToSelection,
  onGenerateCreatives,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKeys: Set<string>
  onBackToSelection: () => void
  onGenerateCreatives: () => void | Promise<void>
}) {
  if (!result) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Geen gegenereerde varianten. Ga terug naar Stap 1.
      </div>
    )
  }
  const selectedPairs = resolveSelectedPairs(result, selectedKeys)
  if (selectedPairs.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Geen varianten geselecteerd. Ga terug naar Stap 2 om er minimaal één te kiezen.
        </div>
        <button
          type="button"
          onClick={onBackToSelection}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-border hover:bg-accent transition-colors"
        >
          ← Terug naar variant-keuze
        </button>
      </div>
    )
  }
  // Roy 2026-06-12: defensive check - als een variant geen variantId
  // heeft (persist faalde), kunnen we noch inline editen noch images
  // genereren. Banner met actie om verder te gaan zonder te crashen.
  const missingVariantIdCount = selectedPairs.filter((p) => !p.variant.variantId).length
  const allMissing = missingVariantIdCount === selectedPairs.length
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToSelection}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Terug
          </button>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{selectedPairs.length} varianten</span>{" "}
            klaar. Edit eerst de tekst, dan klik op &ldquo;Genereer creatives&rdquo;.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onGenerateCreatives()}
          disabled={allMissing}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          title={
            allMissing
              ? "Geen bruikbare variant-IDs - regenereer in Stap 1"
              : "Pedro genereert 3 images per variant"
          }
        >
          <Sparkles className="h-3.5 w-3.5" />
          Genereer creatives
        </button>
      </div>
      {missingVariantIdCount > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            {missingVariantIdCount} van {selectedPairs.length} varianten heeft geen variant-ID
            (persist faalde). Inline editen en image-gen werken niet voor die varianten.
            Ga terug naar Stap 1 en regenereer om het op te lossen.
          </div>
        </div>
      )}
      <div className="space-y-4">
        {selectedPairs.map(({ proposalIndex, proposal, variant }) => (
          <VariantCard
            key={`${proposalIndex}-${variant.adName}`}
            variant={variant}
            clientId={clientId}
            refreshId={result.refreshId}
            proposalIndex={proposalIndex}
            proposalAngle={proposal.preserve.angle}
            hidePush
            hideImagePanel
          />
        ))}
      </div>
    </div>
  )
}

/**
 * GenerateCreativesStep - Roy 2026-06-12 v8 (Stap 4 in 5-step wizard).
 * Mount per geselecteerde variant het VariantImagePanel (3-slot image
 * gallery + regen + upload + feedback). Stap 3 heeft de bulk-gen
 * gestart; per variant tonen we óf een loading indicator (terwijl de
 * POST loopt) óf de 3 images zoals VariantImagePanel ze auto-loadt.
 * CTA: "Push naar Meta".
 */
function GenerateCreativesStep({
  clientId,
  result,
  selectedKeys,
  inFlightVariantIds,
  resultsByVariant,
  onBackToCopy,
  onContinueToPush,
  onRetryVariant,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKeys: Set<string>
  inFlightVariantIds: Set<string>
  resultsByVariant: Record<string, { ok: boolean; error?: string; completedAt: string }>
  onBackToCopy: () => void
  onContinueToPush: () => void
  onRetryVariant: (variantId: string) => void
}) {
  if (!result) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Geen gegenereerde varianten. Ga terug naar Stap 1.
      </div>
    )
  }
  const selectedPairs = resolveSelectedPairs(result, selectedKeys)
  if (selectedPairs.length === 0) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        Geen varianten geselecteerd.
      </div>
    )
  }
  const totalInFlight = inFlightVariantIds.size
  const totalFailed = Object.values(resultsByVariant).filter((r) => !r.ok).length
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToCopy}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Terug naar copy
          </button>
          <div className="text-xs text-muted-foreground">
            {totalInFlight > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                Pedro genereert images voor{" "}
                <span className="font-medium text-foreground">{totalInFlight}</span>{" "}
                {totalInFlight === 1 ? "variant" : "varianten"}…
              </span>
            ) : totalFailed > 0 ? (
              <span className="text-amber-700 dark:text-amber-400">
                {totalFailed} {totalFailed === 1 ? "variant" : "varianten"} faalde - klik regen of upload zelf
              </span>
            ) : (
              <span>
                <span className="font-medium text-foreground">{selectedPairs.length} varianten</span>{" "}
                klaar. Itereer of klik door naar Push.
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onContinueToPush}
          disabled={totalInFlight > 0}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          title={
            totalInFlight > 0
              ? "Wacht tot Pedro klaar is met genereren"
              : "Door naar Push naar Meta"
          }
        >
          Naar Push naar Meta
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <ImageSourcesPicker clientId={clientId} />
      <div className="space-y-4">
        {selectedPairs.map(({ proposalIndex, proposal, variant }) => {
          const vid = variant.variantId ?? ""
          const inFlight = vid ? inFlightVariantIds.has(vid) : false
          const genResult = vid ? resultsByVariant[vid] : undefined
          return (
            <div key={`${proposalIndex}-${variant.adName}`} className="space-y-2">
              {inFlight && (
                <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                  <span>
                    Pedro genereert 3 images voor{" "}
                    <span className="font-medium">{variant.label}</span>… (5-25s)
                  </span>
                </div>
              )}
              {genResult && !genResult.ok && vid && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">Genereren mislukt voor {variant.label}</div>
                    <div className="text-[11px] opacity-80 whitespace-pre-line">{genResult.error}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRetryVariant(vid)}
                    className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 transition-colors"
                  >
                    <Sparkles className="h-3 w-3" />
                    Probeer opnieuw
                  </button>
                </div>
              )}
              <VariantCard
                variant={variant}
                clientId={clientId}
                refreshId={result.refreshId}
                proposalIndex={proposalIndex}
                proposalAngle={proposal.preserve.angle}
                hidePush
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PushMetaStep({
  clientId,
  result,
  selectedKeys,
  onBackToCreatives,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKeys: Set<string>
  onBackToCreatives: () => void
}) {
  const [openPushFor, setOpenPushFor] = useState<{
    proposalIndex: number
    variantId: string
    variantLabel: string
    adName: string
    angle: string
    headline: string
    proposal: CreativeProposal
  } | null>(null)

  if (!result) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Geen gegenereerde varianten. Ga terug naar Stap 1.
      </div>
    )
  }
  const selectedPairs: Array<{
    proposalIndex: number
    proposal: CreativeProposal
    variantIndex: number
    variant: CreativeVariant
  }> = []
  result.proposals.forEach((p, pi) => {
    p.variants.forEach((v, vi) => {
      if (selectedKeys.has(`${pi}:${vi}`)) {
        selectedPairs.push({
          proposalIndex: pi,
          proposal: p,
          variantIndex: vi,
          variant: v,
        })
      }
    })
  })
  if (selectedPairs.length === 0) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        Geen varianten geselecteerd.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* CTA bar TOP - back to Stap 3 */}
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackToCreatives}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Terug naar creatives
          </button>
          <div className="text-xs text-muted-foreground">
            Open per variant de push-instellingen: ad set naam, daily budget,
            template-bron. Alles gaat naar Meta als{" "}
            <span className="font-medium text-amber-700 dark:text-amber-400">PAUSED</span>.
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {selectedPairs.map(({ proposalIndex, proposal, variant }) => (
          <PushVariantReviewCard
            key={`${proposalIndex}-${variant.adName}`}
            variant={variant}
            onOpenPush={() =>
              setOpenPushFor({
                proposalIndex,
                variantId: variant.variantId ?? "",
                variantLabel: variant.label,
                adName: variant.adName,
                angle: proposal.preserve.angle,
                headline: variant.headline ?? "",
                proposal,
              })
            }
          />
        ))}
      </div>
      {openPushFor && (
        <PushToMetaModal
          open={!!openPushFor}
          onClose={() => setOpenPushFor(null)}
          refreshId={result.refreshId}
          proposalIndex={openPushFor.proposalIndex}
          winnerAdName={openPushFor.proposal.basedOnAd.adName}
          proposalAngle={openPushFor.angle}
          variantHeadline={openPushFor.headline}
          clientId={clientId}
          variants={[
            {
              variantId: openPushFor.variantId,
              adName: openPushFor.adName,
              label: openPushFor.variantLabel,
              topicLabel: "",
            },
          ]}
        />
      )}
    </div>
  )
}

/**
 * PushVariantReviewCard - Roy 2026-06-12. Laatste check vóór de
 * Push-instellingen modal: toont per variant de 3 gegenereerde
 * Gemini-afbeeldingen + headline + primary copy. CM verifieert in één
 * oogopslag dat alles klopt voordat hij budget invult en pushed.
 *
 * Slot data komt uit GET /api/pedro/variants/[id]/image. Signed URLs
 * vervallen na ±1u; we re-fetchen niet automatisch want de CM zit
 * meestal binnen die window. Bij refresh van de pagina worden ze
 * opnieuw opgehaald.
 */
type PushSlot = {
  position: number
  hasImage: boolean
  signedUrl: string | null
}

function PushVariantReviewCard({
  variant,
  onOpenPush,
}: {
  variant: CreativeVariant
  onOpenPush: () => void
}) {
  const variantId = variant.variantId ?? ""
  const [slots, setSlots] = useState<PushSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!variantId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/pedro/variants/${variantId}/image`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) {
          setError(json.error)
          return
        }
        const rawSlots = Array.isArray(json.slots) ? json.slots : []
        setSlots(
          rawSlots.map((s: { position: number; hasImage: boolean; signedUrl: string | null }) => ({
            position: s.position,
            hasImage: !!s.hasImage,
            signedUrl: s.signedUrl ?? null,
          })),
        )
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : "Kon images niet laden")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [variantId])

  const filledCount = slots.filter((s) => s.hasImage).length
  // Render 3 slot-tiles regardless of how many came back, so the CM
  // ziet meteen wanneer er minder dan 3 zijn gegenereerd.
  const tiles: Array<PushSlot> = Array.from({ length: 3 }, (_, i) => {
    const found = slots.find((s) => s.position === i)
    return found ?? { position: i, hasImage: false, signedUrl: null }
  })

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="font-heading font-semibold text-sm">{variant.label}</div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">
            {variant.adName}
          </div>
        </div>
        <button
          type="button"
          disabled={!variantId}
          onClick={onOpenPush}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          title={
            !variantId
              ? "Variant heeft geen variantId - regenereer in Stap 2"
              : "Open push instellingen + budget voor deze variant"
          }
        >
          <Megaphone className="h-3.5 w-3.5" />
          Push instellingen + budget
        </button>
      </div>

      {/* 3-image preview - Roy 2026-06-12: laatste check vóór push.
          Geen image = waarschuwing zodat CM terug kan naar Stap 3. */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold inline-flex items-center gap-1">
            <ImageIcon className="h-3 w-3" />
            Images ({filledCount}/3)
          </div>
          {filledCount === 0 && (
            <div className="text-[11px] text-amber-700 dark:text-amber-400 inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Nog geen images - ga terug naar Stap 3
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((slot) => (
            <div
              key={slot.position}
              className="aspect-square rounded-md border border-border/60 bg-muted/30 overflow-hidden flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : slot.hasImage && slot.signedUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={slot.signedUrl}
                  alt={`Slot ${slot.position + 1}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-[10px] text-muted-foreground/70 text-center px-2">
                  Slot {String.fromCharCode(65 + slot.position)} leeg
                </div>
              )}
            </div>
          ))}
        </div>
        {error && (
          <div className="mt-2 text-[11px] text-red-600 dark:text-red-400 inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </div>
        )}
      </div>

      {/* Headline (tekst op afbeelding) */}
      {variant.headline && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Tekst op afbeelding (headline)
          </div>
          <div className="text-sm font-bold text-violet-600 dark:text-violet-400 leading-snug">
            {variant.headline}
          </div>
        </div>
      )}

      {/* Primary copy - volledig zichtbaar zodat CM kan dubbelchecken
          dat de body klopt voordat hij naar Meta pushed. */}
      {variant.primaryCopySnippet && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Primary copy
          </div>
          <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed bg-muted/30 rounded-md px-3 py-2 border border-border/40">
            {variant.primaryCopySnippet}
          </div>
        </div>
      )}

      {/* Headline (Meta veld) - de korte tekst onder de afbeelding. */}
      {variant.altHeadlines && variant.altHeadlines.filter((h) => h.trim()).length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Headline (Meta veld)
          </div>
          <div className="text-xs text-foreground space-y-0.5">
            {variant.altHeadlines.filter((h) => h.trim()).slice(0, 2).map((h, i) => (
              <div key={i}>{h}</div>
            ))}
          </div>
        </div>
      )}

      {/* Link description */}
      {variant.linkDescription && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70 font-semibold mb-1">
            Link description
          </div>
          <div className="text-xs text-muted-foreground">{variant.linkDescription}</div>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground italic pt-2 border-t border-border/40">
        Budget wordt ingevuld in de modal die opent bij &ldquo;Push instellingen + budget&rdquo;.
      </div>
    </div>
  )
}
