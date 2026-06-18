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
  ChevronDown,
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
import { InlineEditField } from "./inline-edit-field"
import { VariantImagePanel } from "./variant-image-panel"
import { BriefRequiredModal } from "./brief-required-modal"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { Copy } from "lucide-react"

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

/** Roy 2026-06-16: persist the wizard's current step + selected variant
 *  per-client so the CM lands BACK where they were after a browser
 *  refresh. Previously the wizard always reset to "select_variants" on
 *  mount which dropped CMs back two steps when they were editing copy
 *  or generating creatives. */
function wizardStateKey(clientId: string): string {
  return `pedro.optimize.wizardState.${clientId}`
}
type WizardState = {
  activeKey: string
  selectedVariantKey: string | null
}
function readWizardState(clientId: string | null): WizardState | null {
  if (!clientId || typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(wizardStateKey(clientId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as WizardState
    if (!parsed?.activeKey) return null
    return parsed
  } catch {
    return null
  }
}
function writeWizardState(clientId: string, state: WizardState | null): void {
  if (typeof window === "undefined") return
  try {
    if (state) window.localStorage.setItem(wizardStateKey(clientId), JSON.stringify(state))
    else window.localStorage.removeItem(wizardStateKey(clientId))
  } catch {
    /* private mode / quota - ignore */
  }
}

/** Short relative-time formatter for the draft banner. "5 min geleden",
 *  "2 uur geleden", "3 dagen geleden". For older drafts we fall back to
 *  the absolute date so it's still readable. */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = now - then
  if (!Number.isFinite(diffMs) || diffMs < 0) return "zojuist"
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return "zojuist"
  if (min < 60) return `${min} min geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} uur geleden`
  const days = Math.floor(hr / 24)
  if (days < 14) return `${days} ${days === 1 ? "dag" : "dagen"} geleden`
  return new Date(iso).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })
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
  const [activeKey, setActiveKey] = useState<ActiveKey>(() => {
    // Roy 2026-06-16: prefer persisted wizard state so refresh resumes
    // the CM at the step they were on (edit_copy / generate_creatives /
    // push_to_meta). Falls back to pick_ad / select_variants when no
    // state was persisted.
    const persisted = readWizardState(selectedClientId)
    if (persisted?.activeKey) return persisted.activeKey as ActiveKey
    return readPickedAd(selectedClientId) ? "select_variants" : "pick_ad"
  })
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
  // Brief-gate state. When /api/pedro/creative-refresh returns 409 with
  // requires_brief, open the briefing modal instead of surfacing the
  // error text — the CM otherwise has no obvious way to fill the brief
  // from inside the wizard. Mirrors refresh-shell.tsx behaviour.
  const [briefRequired, setBriefRequired] = useState<{
    clientId: string
    clientName: string
    currentBrief: Record<string, unknown> | null
    retrySourceAdId: string
    retrySourceScreenshotPath?: string
  } | null>(null)
  // Roy 2026-06-12 v9: single-variant flow. Pedro genereert 3 angles,
  // CM kiest er één om mee verder te gaan. selectedVariantKey is een
  // "pi:vi" string, exact zoals voorheen, maar er kan er max 1 zijn.
  // Roy 2026-06-16: rehydrate from localStorage so refresh resumes the
  // selection alongside the active step.
  const [selectedVariantKey, setSelectedVariantKey] = useState<string | null>(
    () => readWizardState(selectedClientId)?.selectedVariantKey ?? null,
  )

  // Draft state - Roy 2026-06-12 v9: variants gegenereerd in Stap 2 zijn
  // dure Claude calls. We persist al via /api/pedro/refreshes - de wizard
  // laadt de meest recente refresh van deze klant terug zodat hij niet
  // helemaal opnieuw hoeft te genereren na een page reload of client switch.
  const [isLoadingDraft, setIsLoadingDraft] = useState(false)
  const [draftGeneratedAt, setDraftGeneratedAt] = useState<string | null>(null)

  // Reset + draft load when client changes. Two phases:
  // 1. Sync clear all in-memory state.
  // 2. Async fetch the most recent refresh and re-hydrate refreshResult.
  useEffect(() => {
    const stored = readPickedAd(selectedClientId)
    const persistedState = readWizardState(selectedClientId)
    setPickedAd(stored)
    setRefreshResult(null)
    setIsGenerating(false)
    setGenerateError(null)
    setBriefRequired(null)
    // Roy 2026-06-16: rehydrate the persisted selected variant when
    // switching client so the CM doesn't lose their selection.
    setSelectedVariantKey(persistedState?.selectedVariantKey ?? null)
    setDraftGeneratedAt(null)

    if (!selectedClientId) {
      setActiveKey("pick_ad")
      return
    }

    // Default landing: persisted activeKey wins. Otherwise pick_ad als
    // er geen ad is, anders kies_varianten.
    setActiveKey(
      (persistedState?.activeKey as ActiveKey) ??
        (stored ? "select_variants" : "pick_ad"),
    )

    let cancelled = false
    setIsLoadingDraft(true)
    ;(async () => {
      try {
        const listRes = await fetch(
          `/api/pedro/refreshes?clientId=${encodeURIComponent(selectedClientId)}&stage=creatives&limit=1`,
        )
        const listJson = (await listRes.json().catch(() => ({}))) as {
          refreshes?: Array<{ id: string; generatedAt: string }>
        }
        const head = listJson.refreshes?.[0]
        if (cancelled || !head) return
        const fullRes = await fetch(`/api/pedro/refreshes/${encodeURIComponent(head.id)}`)
        const fullJson = (await fullRes.json().catch(() => ({}))) as {
          refreshId?: string
          proposals?: CreativeProposal[]
        }
        if (cancelled) return
        if (fullJson.refreshId && Array.isArray(fullJson.proposals) && fullJson.proposals.length > 0) {
          setRefreshResult({
            refreshId: fullJson.refreshId,
            proposals: fullJson.proposals,
          })
          setDraftGeneratedAt(head.generatedAt)
          // Roy 2026-06-16: only force landing on select_variants when
          // there's no persisted wizard state. With persisted state, the
          // CM resumes at their actual step (edit_copy / generate /
          // push). Same for selectedVariantKey - the rehydrate above
          // already restored it from localStorage.
          if (!persistedState) {
            setSelectedVariantKey(null)
            setActiveKey("select_variants")
          }
          if (!stored) {
            const firstProposal = fullJson.proposals[0]
            const basedOn = firstProposal?.basedOnAd
            if (basedOn?.adId) {
              const reconstructed: PickedAd = {
                adId: basedOn.adId,
                adName: basedOn.adName ?? basedOn.adId,
                campaignName: "",
                screenshotPath: null,
              }
              setPickedAd(reconstructed)
              writePickedAd(selectedClientId, reconstructed)
            }
          }
        }
      } catch (e) {
        console.error("[pedro/optimize] draft load failed:", e instanceof Error ? e.message : e)
      } finally {
        if (!cancelled) setIsLoadingDraft(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedClientId])

  // Roy 2026-06-16: auto-persist wizard state on every change so
  // refresh resumes exactly where the CM was. Per-client key.
  useEffect(() => {
    if (!selectedClientId) return
    writeWizardState(selectedClientId, {
      activeKey: activeKey as string,
      selectedVariantKey,
    })
  }, [selectedClientId, activeKey, selectedVariantKey])

  /**
   * Begin opnieuw - clear de draft uit memory zodat de CM van scratch
   * kan beginnen. Verwijdert de DB-rij NIET (Roy kan later terug);
   * volgende mount laadt 'm gewoon weer in. Dit is een visuele reset.
   */
  const startFresh = useCallback(() => {
    setRefreshResult(null)
    setSelectedVariantKey(null)
    setDraftGeneratedAt(null)
    setGenerateError(null)
    setActiveKey("pick_ad")
    // Clear persisted wizard state too so the CM lands back on pick_ad
    // after refresh (matches the "fresh" intent).
    if (selectedClientId) writeWizardState(selectedClientId, null)
  }, [selectedClientId])

  const updatePickedAd = useCallback(
    (next: PickedAd | null) => {
      setPickedAd(next)
      writePickedAd(selectedClientId, next)
    },
    [selectedClientId],
  )

  // Fire the creative-refresh call from Step 1's generate button.
  // Step 2 reads from refreshResult; Step 3 reads from selectedVariantKey.
  const startGenerate = useCallback(
    async (sourceAdId: string, sourceScreenshotPath?: string) => {
      setIsGenerating(true)
      setGenerateError(null)
      setBriefRequired(null)
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
        // 409 + requires_brief → open the briefing modal instead of
        // dumping the raw error. After save, the modal calls back into
        // startGenerate so the original request auto-retries with the
        // same source ad + screenshot. Mirrors refresh-shell.tsx.
        if (res.status === 409 && json?.requires_brief) {
          setBriefRequired({
            clientId: String(json.clientId ?? selectedClientId),
            clientName: String(json.clientName ?? selectedClientName),
            currentBrief: (json.current_brief as Record<string, unknown> | null) ?? null,
            retrySourceAdId: sourceAdId,
            retrySourceScreenshotPath: sourceScreenshotPath,
          })
          return
        }
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
        // Single-variant flow: geen default selectie. De CM kiest in Stap 2.
        setSelectedVariantKey(null)
      } catch (e) {
        setGenerateError(e instanceof Error ? e.message : "Genereren mislukt")
      } finally {
        setIsGenerating(false)
      }
    },
    [selectedClientId, selectedClientName],
  )

  const pickVariant = useCallback((key: string) => {
    setSelectedVariantKey((prev) => (prev === key ? null : key))
  }, [])

  const doneFor = useCallback(
    (key: StepKey): boolean => {
      if (key === "pick_ad") return !!pickedAd
      if (key === "select_variants") return !!refreshResult && !!selectedVariantKey
      if (key === "edit_copy") return !!selectedVariantKey && !!refreshResult
      if (key === "generate_creatives") return false // visual only - panel manages its own state
      if (key === "push_meta") return false
      return false
    },
    [pickedAd, refreshResult, selectedVariantKey],
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
      {/* Brief gate modal — opens when /api/pedro/creative-refresh returns
          409 + requires_brief. Without this the CM only sees "Brief
          ontbreekt" and has no path to fill it in. After save we
          auto-retry the original generate call with the same source ad. */}
      {briefRequired && (
        <BriefRequiredModal
          clientId={briefRequired.clientId}
          clientName={briefRequired.clientName}
          currentBrief={briefRequired.currentBrief}
          onSaved={() => {
            const retry = briefRequired
            setBriefRequired(null)
            void startGenerate(retry.retrySourceAdId, retry.retrySourceScreenshotPath)
          }}
          onCancel={() => setBriefRequired(null)}
        />
      )}
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

      {/* Draft banner - Roy 2026-06-12 v9: laat zien dat er een eerder
          gegenereerde refresh is geladen + bied "Begin opnieuw" knop. */}
      {isLoadingDraft && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" />
          Draft van vorige sessie laden…
        </div>
      )}
      {!isLoadingDraft && refreshResult && draftGeneratedAt && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-muted-foreground">
              Draft van{" "}
              <span className="font-medium text-foreground">
                {formatRelativeTime(draftGeneratedAt)}
              </span>{" "}
              geladen ({refreshResult.proposals.reduce((n, p) => n + p.variants.length, 0)}{" "}
              varianten). Ga door waar je gebleven was, of klik &ldquo;Begin opnieuw&rdquo;.
            </span>
          </div>
          <button
            type="button"
            onClick={startFresh}
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
          >
            Begin opnieuw
          </button>
        </div>
      )}

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
          {pickedAd && activeKey !== "pick_ad" && activeKey !== "lp_prompt" && activeKey !== "edit_copy" && (
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
                  selectedKey={selectedVariantKey}
                  onPick={pickVariant}
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
                  result={refreshResult}
                  selectedKey={selectedVariantKey}
                  onBackToSelection={() => setActiveKey("select_variants")}
                  onGenerateCreatives={() => setActiveKey("generate_creatives")}
                />
              </StepGate>
            )}
            {activeKey === "generate_creatives" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <GenerateCreativesStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKey={selectedVariantKey}
                  onBackToCopy={() => setActiveKey("edit_copy")}
                  onContinueToPush={() => setActiveKey("push_meta")}
                />
              </StepGate>
            )}
            {activeKey === "push_meta" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <PushMetaStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKey={selectedVariantKey}
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
  selectedKey,
  onPick,
  onContinue,
  onRetry,
}: {
  isGenerating: boolean
  error: string | null
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKey: string | null
  onPick: (key: string) => void
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
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onContinue}
          disabled={!selectedKey}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          title={!selectedKey ? "Kies eerst één van de varianten" : "Verder naar Edit copy"}
        >
          Naar Edit copy
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-4">
        {result.proposals.map((p, pi) => (
          <ProposalSelectionCard
            key={`${p.basedOnAd.adId}-${pi}`}
            proposal={p}
            proposalIndex={pi}
            selectedKey={selectedKey}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  )
}

function ProposalSelectionCard({
  proposal,
  proposalIndex,
  selectedKey,
  onPick,
}: {
  proposal: CreativeProposal
  proposalIndex: number
  selectedKey: string | null
  onPick: (key: string) => void
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
      <div className="text-[10px] uppercase tracking-[0.12em] text-violet-600 dark:text-violet-400 font-semibold">
        Iteratie op {proposal.basedOnAd.adName}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {proposal.variants.map((v, vi) => {
          const key = `${proposalIndex}:${vi}`
          const checked = selectedKey === key
          return (
            <VariantSelectionCard
              key={key}
              variant={v}
              checked={checked}
              onToggle={() => onPick(key)}
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
 * Resolve the chosen variant key ("pi:vi") into a full pair object,
 * or null when nothing is selected or the key doesn't match. Used by
 * Steps 3, 4 en 5 die allemaal op de single-variant flow draaien.
 */
function resolveSelectedVariant(
  result: { refreshId: string; proposals: CreativeProposal[] } | null,
  selectedKey: string | null,
): {
  proposalIndex: number
  proposal: CreativeProposal
  variantIndex: number
  variant: CreativeVariant
} | null {
  if (!result || !selectedKey) return null
  const [piStr, viStr] = selectedKey.split(":")
  const pi = parseInt(piStr, 10)
  const vi = parseInt(viStr, 10)
  if (!Number.isFinite(pi) || !Number.isFinite(vi)) return null
  const proposal = result.proposals[pi]
  const variant = proposal?.variants[vi]
  if (!proposal || !variant) return null
  return { proposalIndex: pi, proposal, variantIndex: vi, variant }
}

/**
 * EditCopyStep - Roy 2026-06-12 v9 (Stap 3 in 5-step single-variant wizard).
 * Inline-editable copy fields voor de gekozen variant. CTA "Genereer
 * creatives" navigeert door naar Stap 4 - daar trapt het ImagePanel
 * zelf de Gemini-gen af.
 */
function EditCopyStep({
  result,
  selectedKey,
  onBackToSelection,
  onGenerateCreatives,
}: {
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKey: string | null
  onBackToSelection: () => void
  onGenerateCreatives: () => void
}) {
  const picked = resolveSelectedVariant(result, selectedKey)
  if (!result) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Geen gegenereerde varianten. Ga terug naar Stap 1.
      </div>
    )
  }
  if (!picked) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
          Nog geen variant gekozen. Ga terug naar Stap 2 om er één te kiezen.
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
  const missingVariantId = !picked.variant.variantId
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onGenerateCreatives}
          disabled={missingVariantId}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          title={
            missingVariantId
              ? "Geen bruikbaar variant-ID - regenereer in Stap 1"
              : "Door naar Stap 4 om style mix te kiezen + creatives te genereren"
          }
        >
          Naar creatives stap
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {missingVariantId && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            Deze variant heeft geen variant-ID. Inline editen en image-gen werken niet.
            Ga terug naar Stap 1 en regenereer om het op te lossen.
          </div>
        </div>
      )}
      <EditCopyVariantCard variant={picked.variant} />
    </div>
  )
}

/**
 * EditCopyVariantCard - Roy 2026-06-12 v9: cleane, luxe layout voor
 * de copy-editing step. Volledig click-to-edit. Whitespace-pre-wrap
 * voor primary copy zodat Pedro's paragraaf-structuur (\n\n) zichtbaar
 * blijft. Sectie-headers in een consistente subtle hierarchy. Bron-DNA
 * info (bron-hook, behouden zinsdelen) staat onderaan, niet in het
 * gezicht van de CM wanneer hij wil editen.
 */
function EditCopyVariantCard({ variant }: { variant: CreativeVariant }) {
  const variantId = variant.variantId ?? null
  const editable = !!variantId

  const [headline, setHeadline] = useState(variant.headline ?? "")
  const [primaryCopy, setPrimaryCopy] = useState(variant.primaryCopySnippet)
  const [altHeadlines, setAltHeadlines] = useState<string[]>(
    variant.altHeadlines && variant.altHeadlines.length > 0
      ? variant.altHeadlines
      : ["", ""],
  )
  const [altPrimaryTexts, setAltPrimaryTexts] = useState<string[]>(
    variant.altPrimaryTexts && variant.altPrimaryTexts.length > 0
      ? variant.altPrimaryTexts
      : ["", ""],
  )
  const [copied, setCopied] = useState(false)

  const patchVariant = useCallback(
    async (patch: Record<string, unknown>): Promise<void> => {
      if (!variantId) {
        throw new Error("Variant id ontbreekt - regenereer in Stap 1.")
      }
      const res = await fetch(`/api/pedro/variants/${variantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`)
      }
    },
    [variantId],
  )

  const altHeadlineSlots = Array.from(
    { length: Math.max(2, altHeadlines.length) },
    (_, i) => altHeadlines[i] ?? "",
  )
  const altPrimarySlots = Array.from(
    { length: Math.max(2, altPrimaryTexts.length) },
    (_, i) => altPrimaryTexts[i] ?? "",
  )

  const copyFullPackage = useCallback(() => {
    const lines = [
      `Ad name: ${variant.adName}`,
      ``,
      `Tekst op afbeelding:`,
      headline,
      ``,
      `Primary copy:`,
      primaryCopy,
    ]
    void navigator.clipboard.writeText(lines.join("\n"))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [variant.adName, headline, primaryCopy])

  // Roy 2026-06-16: shared section-card chrome. Every input lives in its
  // own bordered box so the page reads as cleanly-separated vlakken
  // rather than a wall of stacked sections. Field labels use one
  // consistent typography across all sections so nothing draws attention
  // by accident.
  const sectionCard = "rounded-xl border border-border/60 bg-card/40 p-5"
  const sectionLabel =
    "text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold"
  const groupLabel =
    "text-[10px] uppercase tracking-[0.2em] text-muted-foreground/80 font-semibold"

  return (
    <article className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_3px_0_rgb(0_0_0_/_0.04)] overflow-hidden">
      {/* Header */}
      <header className="px-6 pt-6 pb-5 flex items-center justify-between gap-4 border-b border-border/40">
        <h3 className="font-heading text-xl font-semibold tracking-tight leading-tight min-w-0">
          {variant.label}
        </h3>
        <button
          type="button"
          onClick={copyFullPackage}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-xs font-medium transition-colors",
            copied
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30"
              : "border border-border hover:bg-accent",
          )}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Gekopieerd" : "Kopieer alles"}
        </button>
      </header>

      <div className="px-6 py-6 space-y-6">
        {/* Tekst op afbeelding */}
        <section className={cn(sectionCard, "space-y-3")}>
          <div className={sectionLabel}>Tekst op afbeelding</div>
          <InlineEditField
            value={headline}
            onSave={async (next) => {
              await patchVariant({ headline: next })
              setHeadline(next)
            }}
            variant="single"
            placeholder="(leeg — klik om te bewerken)"
            maxLength={80}
            disabled={!editable}
            className="text-xl font-bold text-violet-600 dark:text-violet-400 leading-snug"
          />
        </section>

        {/* Primary copy */}
        <section className={cn(sectionCard, "space-y-3")}>
          <div className={sectionLabel}>Primary copy</div>
          <InlineEditField
            value={primaryCopy}
            onSave={async (next) => {
              await patchVariant({ primaryCopySnippet: next })
              setPrimaryCopy(next)
            }}
            variant="multi"
            placeholder="(leeg — klik om te bewerken)"
            maxLength={2000}
            minRows={8}
            disabled={!editable}
            className="text-[16px] leading-[1.65] text-foreground"
          />
        </section>

        {/* Back-pocket varianten - geen group label meer */}
        <div className="space-y-4 pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className={groupLabel}>Back-pocket varianten</div>
            <div className="text-[11px] text-muted-foreground">
              Niet gepushed · voor handmatige tests in Ads Manager
            </div>
          </div>

          {/* Alt headlines */}
          <section className={cn(sectionCard, "space-y-3")}>
            <div className={sectionLabel}>Alternatieve headlines</div>
            <div className="space-y-2.5">
              {altHeadlineSlots.map((value, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className="shrink-0 mt-2 inline-flex items-center justify-center h-5 w-5 rounded-md bg-muted/60 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <InlineEditField
                      value={value}
                      onSave={async (next) => {
                        const updated = [...altHeadlines]
                        while (updated.length <= idx) updated.push("")
                        updated[idx] = next
                        await patchVariant({ altHeadlines: updated })
                        setAltHeadlines(updated)
                      }}
                      variant="single"
                      placeholder={`Alternatieve headline ${idx + 1}`}
                      maxLength={80}
                      allowEmpty
                      disabled={!editable}
                      className="text-[15px]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Alt primary texts */}
          <section className={cn(sectionCard, "space-y-3")}>
            <div className={sectionLabel}>Alternatieve primary texts</div>
            <div className="space-y-3">
              {altPrimarySlots.map((value, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className="shrink-0 mt-2 inline-flex items-center justify-center h-5 w-5 rounded-md bg-muted/60 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <InlineEditField
                      value={value}
                      onSave={async (next) => {
                        const updated = [...altPrimaryTexts]
                        while (updated.length <= idx) updated.push("")
                        updated[idx] = next
                        await patchVariant({ altPrimaryTexts: updated })
                        setAltPrimaryTexts(updated)
                      }}
                      variant="multi"
                      placeholder={`Alternatieve primary text ${idx + 1}`}
                      maxLength={2000}
                      minRows={6}
                      allowEmpty
                      disabled={!editable}
                      className="text-[15px] leading-[1.6]"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Source-DNA evidence - blijft beschikbaar maar visueel rustig */}
        {(variant.sourceHookQuote || (variant.phrasesReused && variant.phrasesReused.length > 0)) && (
          <details className="group rounded-lg border border-border/40 bg-muted/10">
            <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center justify-between text-[11px] text-muted-foreground hover:bg-muted/30 transition-colors">
              <span className="inline-flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" />
                Source-DNA bewijs
                {variant.phrasesReused && variant.phrasesReused.length > 0 && (
                  <span className="text-[10px] tabular-nums">({variant.phrasesReused.length} zinsdelen)</span>
                )}
              </span>
              <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/40">
              {variant.sourceHookQuote && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-1">
                    Bron-hook uit source ad
                  </div>
                  <div className="text-[13px] italic text-foreground">
                    &ldquo;{variant.sourceHookQuote}&rdquo;
                  </div>
                </div>
              )}
              {variant.phrasesReused && variant.phrasesReused.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-medium mb-1.5">
                    Behoudt uit source
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {variant.phrasesReused.map((p, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20"
                      >
                        &laquo;{p}&raquo;
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}
      </div>

      {variant.why && (
        <footer className="px-6 py-3 border-t border-border/40 bg-muted/15">
          <div className="text-[11px] text-muted-foreground italic leading-relaxed">
            <span className="font-medium not-italic text-foreground">Waarom:</span> {variant.why}
          </div>
        </footer>
      )}
    </article>
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
  selectedKey,
  onBackToCopy,
  onContinueToPush,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKey: string | null
  onBackToCopy: () => void
  onContinueToPush: () => void
}) {
  const picked = resolveSelectedVariant(result, selectedKey)
  if (!result || !picked) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Nog geen variant gekozen. Ga terug naar Stap 2.
      </div>
    )
  }
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
            <span className="font-medium text-foreground">{picked.variant.label}</span> · Kies eerst
            per slot de style mix → klik &ldquo;Genereer 3 images&rdquo;.
          </div>
        </div>
        <button
          type="button"
          onClick={onContinueToPush}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Megaphone className="h-3.5 w-3.5" />
          Push naar Meta
        </button>
      </div>
      <ImageSourcesPicker clientId={clientId} />
      <GenerateCreativeImageCard variant={picked.variant} clientId={clientId} />
    </div>
  )
}

/**
 * GenerateCreativeImageCard - Stap 4: alleen images. VariantImagePanel
 * auto-fired generateAll() bij mount wanneer er nog geen slots gevuld
 * zijn. Eigen progress UI in het paneel, geen extern orkestratie. Geen
 * copy fields - die leven op Stap 3.
 */
function GenerateCreativeImageCard({
  variant,
  clientId,
}: {
  variant: CreativeVariant
  clientId: string
}) {
  const variantId = variant.variantId ?? null
  return (
    <article className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_3px_0_rgb(0_0_0_/_0.04)] overflow-hidden">
      <header className="px-6 pt-5 pb-4 border-b border-border/40">
        <div className="text-[10px] uppercase tracking-[0.16em] text-violet-600 dark:text-violet-400 font-semibold mb-1">
          Variant
        </div>
        <h3 className="font-heading text-lg font-semibold tracking-tight leading-tight">
          {variant.label}
        </h3>
        {variant.headline && (
          <div className="mt-2 text-sm text-violet-600 dark:text-violet-400 font-medium">
            {variant.headline}
          </div>
        )}
      </header>
      <div className="px-6 py-5">
        {/* Roy 2026-06-12 v2: GEEN auto-gen meer. Step 4 surface = style
            pickers + explicit "Genereer creatives" knop. CM kiest eerst
            de 3 slot-styles, klikt dan Genereer. Voorkomt verspilling
            van credits aan de default mix wanneer hij wat anders wil. */}
        <VariantImagePanel
          variantId={variantId}
          clientId={clientId}
          adName={variant.adName}
          initialImagePrompt={variant.image?.imagePrompt ?? variant.imagePrompt ?? null}
          initialHasImage={variant.image?.hasImage ?? false}
        />
      </div>
    </article>
  )
}

function PushMetaStep({
  clientId,
  result,
  selectedKey,
  onBackToCreatives,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKey: string | null
  onBackToCreatives: () => void
}) {
  const [openPush, setOpenPush] = useState(false)
  const picked = resolveSelectedVariant(result, selectedKey)
  if (!result || !picked) {
    return (
      <div className="rounded-md border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        Nog geen variant gekozen. Ga terug naar Stap 2.
      </div>
    )
  }
  const variantId = picked.variant.variantId ?? ""
  return (
    <div className="space-y-4">
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
            Laatste check: copy, images, budget. Alles gaat naar Meta als{" "}
            <span className="font-medium text-amber-700 dark:text-amber-400">PAUSED</span>.
          </div>
        </div>
      </div>
      <PushVariantReviewCard
        variant={picked.variant}
        onOpenPush={() => setOpenPush(true)}
      />
      {openPush && variantId && (
        <PushToMetaModal
          open={openPush}
          onClose={() => setOpenPush(false)}
          refreshId={result.refreshId}
          proposalIndex={picked.proposalIndex}
          winnerAdName={picked.proposal.basedOnAd.adName}
          proposalAngle={picked.proposal.preserve.angle}
          variantHeadline={picked.variant.headline ?? ""}
          clientId={clientId}
          variants={[
            {
              variantId,
              adName: picked.variant.adName,
              label: picked.variant.label,
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
