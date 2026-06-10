"use client"

import { useMutation } from "@tanstack/react-query"
import { CheckCircle2, ArrowRight, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
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
 * Fallback action UI for steps that don't have their own dedicated
 * component yet. Shows a "this step's tooling is coming" placeholder
 * with a manual "Mark done" button so the AM can still progress through
 * the wizard end-to-end while individual step components get built out.
 *
 * Phase 1 ships Client Brief as the only fully-functional step; this
 * placeholder covers the other 6. Phase 2-4 swap it out per step.
 */
export function PlaceholderStep({
  step,
  mondayItemId,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  const markDone = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey: step.key, done: true }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Save failed")
      }
      return res.json()
    },
    onSuccess: () => onStepSaved(nextKey),
  })

  const undo = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepKey: step.key, done: false }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Save failed")
      }
      return res.json()
    },
    onSuccess: () => onStepSaved(),
  })

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs flex items-start gap-2">
        <Wrench className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <span className="text-amber-700 dark:text-amber-300">
          {t("onboarding.wizard.placeholder.coming", locale)}
        </span>
      </div>

      {step.done ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {t("onboarding.wizard.placeholder.done_label", locale)}
          </span>
          <button
            type="button"
            onClick={() => undo.mutate()}
            disabled={undo.isPending}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
          >
            {t("onboarding.wizard.placeholder.undo", locale)}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 pt-2">
          <p className="text-xs text-muted-foreground">
            {t("onboarding.wizard.placeholder.mark_manually", locale)}
          </p>
          <Button
            onClick={() => markDone.mutate()}
            disabled={markDone.isPending}
            className="gap-1.5"
          >
            {t("onboarding.wizard.placeholder.mark_done", locale)}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {markDone.isError && (
        <div className="text-xs text-destructive">
          {markDone.error instanceof Error ? markDone.error.message : "Failed"}
        </div>
      )}
    </div>
  )
}
