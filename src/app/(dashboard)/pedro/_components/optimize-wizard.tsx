"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import {
  CheckCircle2,
  Target,
  Compass,
  Megaphone,
  Video,
  FileText,
  ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { AdPicker } from "./ad-picker"
import { AnglesRefresh } from "./angles-refresh"
import { ScriptRefresh } from "./script-refresh"
import { LpRefresh } from "./lp-refresh"
import { AdsRefresh } from "./ads-refresh"

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

type StepDef = {
  key: StepKey
  order: number
  title: string
  description: string
  icon: typeof Compass
}

// Roy 2026-06-11 v6: terug naar de oude 3-stappen-flow zoals onboarding.
// Stap 1 = winning ad, stap 2 = angles, stap 3 = ads (creative + copy).
// Video scripts + LP prompt verhuizen naar de "Overig" sectie onder de
// wizard - die deliverables hoeven niet steeds opnieuw in Optimize.
const STEPS: StepDef[] = [
  {
    key: "pick_ad",
    order: 1,
    title: "Kies winning ad",
    description: "Selecteer de bewezen ad waarop Pedro de iteraties baseert. Dit is de DNA-bron voor angles, creatives en copy.",
    icon: Target,
  },
  {
    key: "angles",
    order: 2,
    title: "Angles refresh",
    description: "Pedro stelt 3-5 nieuwe marketing angles voor, gebaseerd op de huidige performance.",
    icon: Compass,
  },
  {
    key: "ads",
    order: 3,
    title: "Creatives + ad copy",
    description: "Pedro genereert 3 zus-varianten van de gekozen ad: image gen + primary text + headline + description.",
    icon: Megaphone,
  },
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
  // Active step starts at the first step the CM hasn't completed yet -
  // i.e., pick_ad when no ad is picked, angles otherwise. The CM can
  // always navigate by clicking the rail.
  const [pickedAd, setPickedAd] = useState<PickedAd | null>(() =>
    readPickedAd(selectedClientId),
  )
  const [activeKey, setActiveKey] = useState<StepKey>(() =>
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

  const activeStep = STEPS.find((s) => s.key === activeKey) ?? STEPS[0]

  return (
    <div className="space-y-4">
      {/* Progress bar - same chrome as the onboarding wizard, so the
          Pedro Optimize page feels like a sibling surface. */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Pedro Optimize
          </div>
          <h2 className="font-heading text-lg font-semibold tracking-tight leading-tight text-foreground mt-0.5">
            {selectedClientName || "Geen klant geselecteerd"}
          </h2>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Voortgang
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

      {/* Wizard body - rail + active step. Same grid as onboarding. */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Rail */}
        <nav className="space-y-1 rounded-2xl border border-border/60 bg-card p-2 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
          <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
            Iteratie flow
          </div>
          {STEPS.map((step) => (
            <RailItem
              key={step.key}
              step={step}
              active={activeStep.key === step.key}
              done={doneFor(step.key)}
              onClick={() => setActiveKey(step.key)}
            />
          ))}
        </nav>

        {/* Right pane - active step content */}
        <div className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] overflow-hidden">
          <StepHeader step={activeStep} />
          {pickedAd && activeStep.key !== "pick_ad" && (
            <SourceAdBanner
              picked={pickedAd}
              onReset={() => {
                updatePickedAd(null)
                setActiveKey("pick_ad")
              }}
            />
          )}
          <div className="p-5">
            {activeStep.key === "pick_ad" && (
              <PickAdStep
                clientId={selectedClientId}
                onPicked={(picked) => {
                  updatePickedAd(picked)
                  setActiveKey("angles")
                }}
                currentPicked={pickedAd}
              />
            )}
            {activeStep.key === "angles" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd}>
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
            {activeStep.key === "ads" && (
              <StepGate clientId={selectedClientId} pickedAd={pickedAd}>
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
          </div>
        </div>
      </div>

      {/* Overig - separate vak onder de iteratie flow. Niet onderdeel
          van de 1-2-3 main flow, maar wel zichtbaar voor as-needed
          deliverables. Roy 2026-06-11 v6: "videoscripts hoeft niet bij
          optimize opnieuw opgemaakt te worden + LP prompt + later misschien
          meer AI deliverables". */}
      <OtherDeliverables
        clientId={selectedClientId}
        clientName={selectedClientName}
        autoStart={autoStart}
      />
    </div>
  )
}

function OtherDeliverables({
  clientId,
  clientName,
  autoStart,
}: {
  clientId: string
  clientName: string
  autoStart?: boolean
}) {
  const [openScripts, setOpenScripts] = useState(false)
  const [openLp, setOpenLp] = useState(false)
  return (
    <div className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-border/40">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Overig
        </div>
        <h2 className="font-heading text-lg font-semibold leading-tight">
          Aanvullende deliverables
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Niet onderdeel van de iteratie flow zelf - maar wanneer je ze nodig hebt staan ze hier klaar.
        </p>
      </div>
      <div className="divide-y divide-border/40">
        {/* LP prompt - inline expandable. Roy 2026-06-11: LP refresh is
            primair "verbeter bestaande LP" (URL + steering), met scratch
            als fallback. Niet meer deep-linked naar onboarding. */}
        <div>
          <button
            type="button"
            onClick={() => setOpenLp((v) => !v)}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors text-left"
          >
            <FileText className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">LP prompt</div>
              <div className="text-xs text-muted-foreground">
                Verbeter de bestaande LP (URL + wens) of bouw vanaf scratch.
              </div>
            </div>
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                openLp && "rotate-90",
              )}
            />
          </button>
          {openLp && (
            <div className="px-5 pb-5 pt-1">
              <LpRefresh
                selectedClientId={clientId}
                selectedClientName={clientName}
                hideShellHeader
              />
            </div>
          )}
        </div>
        {/* Video scripts - inline expandable. Roy: "videoscripts hoeft
            niet opnieuw in Optimize" - dus default dicht, on-demand open. */}
        <div>
          <button
            type="button"
            onClick={() => setOpenScripts((v) => !v)}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-accent/40 transition-colors text-left"
          >
            <Video className="h-4 w-4 text-violet-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">Video scripts</div>
              <div className="text-xs text-muted-foreground">
                Pedro schrijft 3 UGC-stijl scripts per winning ad - on demand.
              </div>
            </div>
            <ChevronRight
              className={cn(
                "h-4 w-4 text-muted-foreground shrink-0 transition-transform",
                openScripts && "rotate-90",
              )}
            />
          </button>
          {openScripts && (
            <div className="px-5 pb-5 pt-1">
              <ScriptRefresh
                selectedClientId={clientId}
                selectedClientName={clientName}
                autoStart={autoStart}
                hideShellHeader
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RailItem({
  step,
  active,
  done,
  onClick,
}: {
  step: StepDef
  active: boolean
  done: boolean
  onClick: () => void
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

function StepHeader({ step }: { step: StepDef }) {
  const Icon = step.icon
  return (
    <div className="px-5 pt-5 pb-3 border-b border-border/40">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        <span>Stap {step.order} / {STEPS.length}</span>
      </div>
      <h2 className="font-heading text-lg font-semibold leading-tight flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        {step.title}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{step.description}</p>
    </div>
  )
}

function SourceAdBanner({
  picked,
  onReset,
}: {
  picked: PickedAd
  onReset: () => void
}) {
  return (
    <div className="px-5 py-2.5 border-b border-border/40 bg-emerald-500/5 flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <span className="text-muted-foreground">Bron-ad:</span>
        <span className="font-mono text-foreground truncate">{picked.adName}</span>
        {picked.campaignName && (
          <span className="text-muted-foreground/70 truncate hidden md:inline">
            · {picked.campaignName}
          </span>
        )}
        {picked.screenshotPath && (
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400 font-semibold px-1.5 rounded bg-emerald-500/10">
            screenshot
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        Andere ad kiezen
      </button>
    </div>
  )
}

function StepGate({
  clientId,
  pickedAd,
  children,
}: {
  clientId: string
  pickedAd: PickedAd | null
  children: React.ReactNode
}) {
  if (!clientId) {
    return (
      <div className="text-sm text-muted-foreground">
        Selecteer eerst een klant.
      </div>
    )
  }
  if (!pickedAd) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-400">
        Stap 1 nog niet voltooid - kies eerst een winning ad. De iteraties die je daarna
        genereert zijn dan herleidbaar naar die bron-ad.
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
}: {
  clientId: string
  onPicked: (picked: PickedAd) => void
  currentPicked: PickedAd | null
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
          Huidige bron-ad: <span className="font-mono text-foreground">{currentPicked.adName}</span>
          . Kies hieronder een andere of bevestig met opnieuw klikken op &quot;Genereer&quot;.
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
