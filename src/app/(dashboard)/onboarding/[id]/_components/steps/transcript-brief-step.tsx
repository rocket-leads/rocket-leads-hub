"use client"

import { BookOpen, Video } from "lucide-react"
import { TranscriptLinkStep } from "./transcript-link-step"
import { BriefEnrichmentStep } from "./brief-enrichment-step"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { SerializedStep, WizardClient } from "../wizard-shell"

type Props = {
  step: SerializedStep
  mondayItemId: string
  client: WizardClient
  allSteps: SerializedStep[]
  locale: Locale
  nextKey: string | undefined
  onStepSaved: (nextStepKey?: string) => void
}

/**
 * Combined "Stap 2 — Transcript koppelen + brief verrijken". One wizard
 * step in the rail (Roy 2026-06-11: "dat moet één stap zijn"), but
 * internally renders the two existing sub-steps in sequence:
 *
 *   1. TranscriptLinkStep — koppel de Fathom recording
 *   2. BriefEnrichmentStep — AI brief enrichment uit de transcript
 *
 * Each sub-step keeps its existing DB key + content shape — we just
 * spoof the `step` prop so they read/write the right rows. The wizard
 * step's own done state is derive()'d from both underlying rows being
 * done, so the rail shows green when the AM has finished both.
 */
export function TranscriptBriefStep({
  step,
  mondayItemId,
  client,
  allSteps,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  // Spoof step props so the sub-components save to their original DB
  // keys (transcript_link, brief_enrichment) instead of the new wizard
  // step key (transcript_brief). Sub-step done/content come from
  // allSteps lookup — those rows ARE persisted, just not exposed in
  // the v4 wizard rail.
  const transcriptStep: SerializedStep = {
    ...step,
    key: "transcript_link",
    action: "transcript_brief", // not really used by the sub-component
    // Sub-component reads `content` and `done` directly from step prop —
    // pull whatever's stored under "transcript_link" if anything.
    content: findStoredContent(allSteps, "transcript_link", step.content),
    done: findStoredDone(allSteps, "transcript_link"),
  }
  const enrichmentStep: SerializedStep = {
    ...step,
    key: "brief_enrichment",
    action: "transcript_brief",
    content: findStoredContent(allSteps, "brief_enrichment", null),
    done: findStoredDone(allSteps, "brief_enrichment"),
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Video className="h-3.5 w-3.5" />
          <span>{t("onboarding.wizard.combined.transcript_section", locale)}</span>
        </div>
        <TranscriptLinkStep
          step={transcriptStep}
          mondayItemId={mondayItemId}
          client={client}
          allSteps={allSteps}
          locale={locale}
          // nextKey for transcript-only: stay on the same wizard step
          // since the AM continues to enrichment below.
          nextKey={undefined}
          onStepSaved={onStepSaved}
        />
      </section>

      <div className="border-t border-border/40" />

      <section>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          <span>{t("onboarding.wizard.combined.enrichment_section", locale)}</span>
        </div>
        <BriefEnrichmentStep
          step={enrichmentStep}
          mondayItemId={mondayItemId}
          client={client}
          allSteps={allSteps}
          locale={locale}
          // When the AM approves the enrichment, move on to the next
          // wizard step (am_checklist or whatever's after).
          nextKey={nextKey}
          onStepSaved={onStepSaved}
        />
      </section>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Look up content stored under the original DB key. The wizard
 *  payload doesn't currently include hidden child rows, so we
 *  fall back to a passed-in default for the first render. The
 *  sub-components hit /api/.../onboarding/{transcript|brief-enrichment}
 *  endpoints directly anyway, so their own state is the source of
 *  truth post-mount. */
function findStoredContent(
  allSteps: SerializedStep[],
  key: string,
  fallback: unknown,
): unknown {
  const match = allSteps.find((s) => s.key === key)
  if (match) return match.content
  return fallback
}

function findStoredDone(allSteps: SerializedStep[], key: string): boolean {
  return allSteps.find((s) => s.key === key)?.done ?? false
}
