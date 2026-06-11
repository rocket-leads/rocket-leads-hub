"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LpRefresh } from "@/app/(dashboard)/pedro/_components/lp-refresh"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { BriefData } from "@/lib/pedro/helpers"
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

// Wizard's BriefFields shape (from kickoff_live + brief_enrichment).
type WizardBriefFields = {
  bedrijf: string
  sector: string
  doelgroep: string
  pijnpunten: string
  aanbod: string
  usps: string
  marketingHooks: string
}

type LpContent = {
  lpPrompt: string
}

/**
 * Stap 8 — Landingspagina (CM). Wraps the standalone LpRefresh in the
 * wizard chrome. Mode "optimize-existing" is disabled here because a
 * freshly-onboarded client doesn't have a live LP yet — Pedro builds
 * the first LP from brief + angles ("scratch" mode). Once the client is
 * live and the CM revisits via Optimize, "verbeter bestaande" becomes
 * the primary path.
 *
 * Brief comes from kickoff_live + brief_enrichment (merged via picker);
 * LpRefresh forwards it to /api/pedro/lp-refresh as briefOverride so the
 * onboarding wizard's brief wins over any stale pedro_client_state row.
 */
export function CmLandingPageStep({
  step,
  mondayItemId,
  client,
  allSteps,
  hiddenContent,
  locale,
  onStepSaved,
}: Props) {
  const initial = (step.content as Partial<LpContent> | null) ?? null
  const [lpPrompt, setLpPrompt] = useState<string>(initial?.lpPrompt ?? "")

  const wizardBrief = useMemo(
    () => pickWizardBrief(allSteps, hiddenContent),
    [allSteps, hiddenContent],
  )

  // Debounced save of the generated prompt to wizard_steps. Marks the
  // step done once a prompt has been generated.
  const skipFirst = useRef(true)
  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false
      return
    }
    const id = setTimeout(() => {
      void fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: !!lpPrompt,
          content: { lpPrompt },
        }),
      })
    }, 800)
    return () => clearTimeout(id)
  }, [lpPrompt, mondayItemId, step.key])

  return (
    <div className="space-y-5">
      {/* Step intro — onboarding-specific framing on top of the shared
          LpRefresh component. */}
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 flex items-start gap-2 text-xs">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span className="text-foreground/80 leading-relaxed">
          {t("onboarding.wizard.cm_lp.intro", locale)}
        </span>
      </div>

      <LpRefresh
        selectedClientId={mondayItemId}
        selectedClientName={client.companyName || client.name}
        disableOptimizeMode
        hideShellHeader
        briefOverride={toPedroBrief(wizardBrief)}
        onPromptGenerated={(p) => setLpPrompt(p)}
      />

      {lpPrompt && (
        <div className="pt-2 flex justify-end">
          <Button size="sm" onClick={() => onStepSaved()}>
            {t("onboarding.wizard.cm_lp.mark_done", locale)}
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

function pickWizardBrief(
  allSteps: SerializedStep[],
  hiddenContent: Record<string, unknown> | undefined,
): WizardBriefFields {
  const kickoff = allSteps.find((s) => s.key === "kickoff_live")?.content as
    | { briefDraft?: Partial<WizardBriefFields> }
    | null
  const enrichment = hiddenContent?.brief_enrichment as
    | { finalBrief?: Partial<WizardBriefFields> }
    | null
  const empty: WizardBriefFields = {
    bedrijf: "",
    sector: "",
    doelgroep: "",
    pijnpunten: "",
    aanbod: "",
    usps: "",
    marketingHooks: "",
  }
  const out = { ...empty }
  for (const key of Object.keys(empty) as Array<keyof WizardBriefFields>) {
    const e = enrichment?.finalBrief?.[key]?.trim?.() ?? ""
    const k = kickoff?.briefDraft?.[key]?.trim?.() ?? ""
    out[key] = e || k
  }
  return out
}

function toPedroBrief(b: WizardBriefFields): Partial<BriefData> {
  return {
    bedrijf: b.bedrijf,
    sector: b.sector,
    doel: b.doelgroep,
    pijn: b.pijnpunten,
    aanbod: b.aanbod,
    usps: b.usps,
    hooksAM: b.marketingHooks,
    hooksExtra: "",
  }
}
