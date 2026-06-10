"use client"

import type { Locale } from "@/lib/i18n/types"
import { t } from "@/lib/i18n/t"
import { BriefEnrichmentStep } from "./steps/brief-enrichment-step"
import { HandoffStep } from "./steps/handoff-step"
import { KickoffLiveStep } from "./steps/kickoff-live-step"
import { TranscriptLinkStep } from "./steps/transcript-link-step"
import { WaitOnClientStep } from "./steps/wait-on-client-step"
import { PlaceholderStep } from "./steps/placeholder-step"
import type { SerializedStep, WizardClient } from "./wizard-shell"

type Props = {
  step: SerializedStep
  mondayItemId: string
  client: WizardClient
  allSteps: SerializedStep[]
  locale: Locale
  onStepSaved: (nextStepKey?: string) => void
}

/**
 * Dispatches the active step to its action component. Each action type
 * has its own component implementing the doing-tool for that step
 * (generate brief, create Drive folder, compose email, …).
 *
 * Step components are responsible for:
 *  - Rendering their own UI in the right pane
 *  - Calling onStepSaved(next?) after a successful save so the rail
 *    refetches and (optionally) jumps the user to the next step
 */
export function StepRenderer({
  step,
  mondayItemId,
  client,
  allSteps,
  locale,
  onStepSaved,
}: Props) {
  const header = (
    <div className="px-5 pt-5 pb-3 border-b border-border/40">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        <span>
          {t("onboarding.wizard.step_label", locale)} {step.order} / {allSteps.length}
        </span>
        {step.critical && (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 bg-red-500/10 text-red-700 dark:text-red-400 text-[9px] font-medium">
            {t("onboarding.wizard.critical_pill", locale)}
          </span>
        )}
      </div>
      <h2 className="font-heading text-lg font-semibold leading-tight">
        {t(step.labelKey, locale)}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t(step.descriptionKey, locale)}</p>
    </div>
  )

  // Find the next unlocked, not-done step so the action component can
  // jump there after saving.
  const sortedRemaining = allSteps
    .filter((s) => !s.done && !s.locked && s.key !== step.key)
    .sort((a, b) => a.order - b.order)
  const nextKey = sortedRemaining[0]?.key

  // Each component receives the same prop shape so we can swap them
  // out without changing this dispatcher.
  const stepProps = {
    step,
    mondayItemId,
    client,
    allSteps,
    locale,
    nextKey,
    onStepSaved,
  }

  return (
    <div>
      {header}
      <div className="p-5">
        {step.action === "kickoff_live" ? (
          <KickoffLiveStep {...stepProps} />
        ) : step.action === "transcript_link" ? (
          <TranscriptLinkStep {...stepProps} />
        ) : step.action === "brief_enrichment" ? (
          <BriefEnrichmentStep {...stepProps} />
        ) : step.action === "wait_on_client" ? (
          <WaitOnClientStep {...stepProps} />
        ) : step.action === "handoff" ? (
          <HandoffStep {...stepProps} />
        ) : (
          <PlaceholderStep {...stepProps} />
        )}
      </div>
    </div>
  )
}
