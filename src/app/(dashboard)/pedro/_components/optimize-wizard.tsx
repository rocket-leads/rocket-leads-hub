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

type StepKey = "pick_ad" | "select_variants" | "creatives"
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

// Roy 2026-06-12 v7: flow herstructureerd. Step 1 vuurt de generate
// API meteen af; Step 2 toont de gegenereerde varianten + multi-select;
// Step 3 doet alleen image gen + push voor de gekozen varianten.
const STEPS: StepDef[] = [
  { key: "pick_ad", order: 1, title: "Kies winning ad", icon: Target },
  { key: "select_variants", order: 2, title: "Kies varianten", icon: Compass },
  { key: "creatives", order: 3, title: "Creatives + push", icon: Megaphone },
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

  // Reset when client changes.
  useEffect(() => {
    const stored = readPickedAd(selectedClientId)
    setPickedAd(stored)
    setActiveKey(stored ? "select_variants" : "pick_ad")
    setRefreshResult(null)
    setIsGenerating(false)
    setGenerateError(null)
    setSelectedVariantKeys(new Set())
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
        // Default selection: all variants checked so the CM can deselect.
        const allKeys = new Set<string>()
        proposals.forEach((p, pi) => {
          p.variants.forEach((_, vi) => allKeys.add(`${pi}:${vi}`))
        })
        setSelectedVariantKeys(allKeys)
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

  const doneFor = useCallback(
    (key: StepKey): boolean => {
      if (key === "pick_ad") return !!pickedAd
      if (key === "select_variants") return !!refreshResult
      if (key === "creatives") return selectedVariantKeys.size > 0 && !!refreshResult
      return false
    },
    [pickedAd, refreshResult, selectedVariantKeys],
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
                  onContinue={() => setActiveKey("creatives")}
                  onRetry={() =>
                    pickedAd?.adId
                      ? startGenerate(pickedAd.adId, pickedAd.screenshotPath ?? undefined)
                      : null
                  }
                />
              </StepGate>
            )}
            {activeKey === "creatives" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <CreativesStep
                  clientId={selectedClientId}
                  result={refreshResult}
                  selectedKeys={selectedVariantKeys}
                  onBackToSelection={() => setActiveKey("select_variants")}
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
    return (
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-10 flex flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <div className="font-heading font-semibold text-base">
          Pedro genereert varianten…
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          Lezen van source ad → angles + ad copy + image prompts. Duurt meestal 20-40 seconden bij dynamic creatives.
        </p>
      </div>
    )
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
        "text-left rounded-lg border-2 p-3 space-y-2 transition-colors",
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
      {variant.headline && (
        <div className="text-xs text-foreground line-clamp-2 italic">
          &ldquo;{variant.headline}&rdquo;
        </div>
      )}
      {variant.primaryCopySnippet && (
        <div className="text-[11px] text-muted-foreground line-clamp-3">
          {variant.primaryCopySnippet}
        </div>
      )}
    </button>
  )
}

function CreativesStep({
  clientId,
  result,
  selectedKeys,
  onBackToSelection,
}: {
  clientId: string
  result: { refreshId: string; proposals: CreativeProposal[] } | null
  selectedKeys: Set<string>
  onBackToSelection: () => void
}) {
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
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selectedPairs.length} varianten</span>{" "}
          klaar voor image gen + Push to Meta. Per kaart eigen image-generatie.
        </div>
        <button
          type="button"
          onClick={onBackToSelection}
          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Terug naar variant-keuze
        </button>
      </div>
      <div className="space-y-4">
        {selectedPairs.map(({ proposalIndex, proposal, variant }) => (
          <VariantCard
            key={`${proposalIndex}-${variant.adName}`}
            variant={variant}
            clientId={clientId}
            refreshId={result.refreshId}
            proposalIndex={proposalIndex}
            proposalAngle={proposal.preserve.angle}
          />
        ))}
      </div>
    </div>
  )
}
