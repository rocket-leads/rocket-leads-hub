"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  CheckCircle2,
  Target,
  Compass,
  Megaphone,
  Video,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AdPicker } from "./ad-picker"
import { AnglesRefresh } from "./angles-refresh"
import { ScriptRefresh } from "./script-refresh"
import { LpRefresh } from "./lp-refresh"
import { AdsRefresh } from "./ads-refresh"
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

type StepKey = "pick_ad" | "angles" | "ads"
type OverigKey = "lp_prompt" | "video_scripts"
type ActiveKey = StepKey | OverigKey

type StepDef = {
  key: StepKey
  order: number
  titleKey: "pedro.optimize.step.pick_ad.title" | "pedro.optimize.step.angles.title" | "pedro.optimize.step.ads.title"
  icon: typeof Compass
}

type OverigDef = {
  key: OverigKey
  titleKey: "pedro.optimize.step.lp_prompt.title" | "pedro.optimize.step.video_scripts.title"
  icon: typeof Compass
}

// Roy 2026-06-11 v6: terug naar de oude 3-stappen-flow zoals onboarding.
// Stap 1 = winning ad, stap 2 = angles, stap 3 = ads (creative + copy).
// Step descriptions stripped (Roy 2026-06-11) - titles + numbered rail
// already explain the flow; the sub-headlines added clutter.
const STEPS: StepDef[] = [
  { key: "pick_ad", order: 1, titleKey: "pedro.optimize.step.pick_ad.title", icon: Target },
  { key: "angles", order: 2, titleKey: "pedro.optimize.step.angles.title", icon: Compass },
  { key: "ads", order: 3, titleKey: "pedro.optimize.step.ads.title", icon: Megaphone },
]

// Roy 2026-06-11 v7: video scripts + LP prompt zitten naast de iteratie
// flow als losse rail-sectie "OVERIG", niet als grote banner onderaan.
const OVERIG: OverigDef[] = [
  { key: "lp_prompt", titleKey: "pedro.optimize.step.lp_prompt.title", icon: FileText },
  { key: "video_scripts", titleKey: "pedro.optimize.step.video_scripts.title", icon: Video },
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
    readPickedAd(selectedClientId) ? "angles" : "pick_ad",
  )
  // Done state per step is purely visual signal (green checkmark in
  // rail). For pick_ad: true when an ad is picked. For 2-5: true when
  // the CM has actually generated a refresh in this session. We track
  // the generation state via a flag per step.
  const [generatedSteps, setGeneratedSteps] = useState<Set<StepKey>>(new Set())

  // Reset when client changes.
  useEffect(() => {
    const stored = readPickedAd(selectedClientId)
    setPickedAd(stored)
    setActiveKey(stored ? "angles" : "pick_ad")
    setGeneratedSteps(new Set())
  }, [selectedClientId])

  const updatePickedAd = useCallback(
    (next: PickedAd | null) => {
      setPickedAd(next)
      writePickedAd(selectedClientId, next)
    },
    [selectedClientId],
  )

  const markGenerated = useCallback((step: StepKey) => {
    setGeneratedSteps((prev) => {
      if (prev.has(step)) return prev
      const next = new Set(prev)
      next.add(step)
      return next
    })
  }, [])

  const doneFor = useCallback(
    (key: StepKey): boolean => {
      if (key === "pick_ad") return !!pickedAd
      return generatedSteps.has(key)
    },
    [pickedAd, generatedSteps],
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
                onPicked={(picked) => {
                  updatePickedAd(picked)
                  setActiveKey("angles")
                }}
                currentPicked={pickedAd}
                locale={locale}
              />
            )}
            {activeKey === "angles" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <div onClick={() => markGenerated("angles")}>
                  <AnglesRefresh
                    selectedClientId={selectedClientId}
                    selectedClientName={selectedClientName}
                    autoStart={autoStart}
                    hideShellHeader
                  />
                </div>
              </StepGate>
            )}
            {activeKey === "ads" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd} locale={locale}>
                <div onClick={() => markGenerated("ads")}>
                  <AdsRefresh
                    selectedClientId={selectedClientId}
                    selectedClientName={selectedClientName}
                    autoStart={autoStart}
                    hideShellHeader
                  />
                </div>
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
        {t(step.titleKey, locale)}
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
      <span className="flex-1 truncate">{t(item.titleKey, locale)}</span>
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
        {t(item.titleKey, locale)}
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
  onPicked,
  currentPicked,
  locale,
}: {
  clientId: string
  onPicked: (picked: PickedAd) => void
  currentPicked: PickedAd | null
  locale: import("@/lib/i18n/types").Locale
}) {
  // We hijack AdPicker's onGenerate as our "pick confirmation": the
  // picker calls it with sourceAdId (+ optional screenshotPath) when
  // the CM clicks "Genereer". We don't actually call any backend - we
  // just save the pick and advance.
  const handlePick = useCallback(
    async (extra: { sourceAdId: string; sourceScreenshotPath?: string }) => {
      // We need adName + campaignName but AdPicker only passes the id.
      // Quick fetch of the campaigns-with-ads endpoint to enrich.
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
        let adName = ""
        let campaignName = ""
        for (const c of json.campaigns ?? []) {
          const hit = c.ads.find((a) => a.adId === extra.sourceAdId)
          if (hit) {
            adName = hit.adName
            campaignName = c.name
            break
          }
        }
        onPicked({
          adId: extra.sourceAdId,
          adName: adName || extra.sourceAdId,
          campaignName,
          screenshotPath: extra.sourceScreenshotPath ?? null,
        })
      } catch {
        onPicked({
          adId: extra.sourceAdId,
          adName: extra.sourceAdId,
          campaignName: "",
          screenshotPath: extra.sourceScreenshotPath ?? null,
        })
      }
    },
    [clientId, onPicked],
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
        loading={false}
        hasOutput={false}
        onGenerate={handlePick}
      />
    </div>
  )
}
