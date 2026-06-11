"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Rocket,
  CheckCircle2,
  Loader2,
  AlertCircle,
  MessageSquare,
  ExternalLink,
} from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import { cn } from "@/lib/utils"
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

type HandoffContent = {
  handoffAt?: string
  handoffBy?: string
  cmName?: string | null
  cmNotified?: boolean
  cmNotifyError?: string | null
}

/**
 * Stap 5 - Handoff to CM. Final wizard action.
 *
 * Shows a summary of what the CM will inherit + a big "Klaar voor CM"
 * button. On click:
 *   1. Hub flips client status from Onboarding → Live (via handoff
 *      endpoint, which runs the hard-gate inside updateClientField).
 *      Gate failures surface as an actionable error here.
 *   2. CM gets a Slack DM with the Hub link. Best-effort - if it
 *      fails the AM still completes the handoff and gets a hint to
 *      message manually.
 *   3. Step marked done. Wizard renders "wizard complete" state.
 */
export function HandoffStep({
  step,
  mondayItemId,
  client,
  locale,
  onStepSaved,
}: Props) {
  const queryClient = useQueryClient()
  const content = (step.content as HandoffContent | null) ?? {}

  const handoff = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding/handoff`, {
        method: "POST",
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Handoff failed")
      }
      return res.json() as Promise<{
        ok: boolean
        cmNotified: boolean
        cmNotifyError: string | null
      }>
    },
    onSuccess: () => {
      // Invalidate everything that watches the client's status - the
      // flip ripples through campaign lists, watchlist, billing dots.
      queryClient.invalidateQueries({ queryKey: ["onboarding-wizard", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["client-detail", mondayItemId] })
      onStepSaved(undefined)
    },
  })

  // ── Done state - show completion summary ──
  if (step.done && content.handoffAt) {
    const date = new Date(content.handoffAt)
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
          <Rocket className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-1">
            {t("onboarding.wizard.handoff.done.title", locale)}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t("onboarding.wizard.handoff.done.body", locale)
              .replace("{cm}", content.cmName || "-")
              .replace(
                "{when}",
                date.toLocaleString(locale === "en" ? "en-GB" : "nl-NL", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              )}
          </p>
          <div className="text-xs text-muted-foreground">
            {content.cmNotified ? (
              <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                <MessageSquare className="h-3 w-3" />
                {t("onboarding.wizard.handoff.done.cm_notified", locale)}
              </span>
            ) : content.cmNotifyError ? (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                {t("onboarding.wizard.handoff.done.cm_not_notified", locale)}: {content.cmNotifyError}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex justify-center">
          <Link
            href={`/clients/${mondayItemId}`}
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            {t("onboarding.wizard.handoff.done.open_client", locale)}
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    )
  }

  // ── Pre-handoff - summary + big handoff button ──
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t("onboarding.wizard.handoff.summary.hint", locale)}
      </p>

      {/* What CM inherits */}
      <ul className="space-y-2">
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.cm", locale)}
          value={client.campaignManager || t("onboarding.wizard.handoff.summary.no_cm", locale)}
          ok={Boolean(client.campaignManager)}
        />
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.am", locale)}
          value={client.accountManager || "-"}
          ok={Boolean(client.accountManager)}
        />
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.drive", locale)}
          value={client.googleDriveId ? client.googleDriveId : "-"}
          ok={Boolean(client.googleDriveId)}
        />
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.meta", locale)}
          value={client.metaAdAccountId || "-"}
          ok={Boolean(client.metaAdAccountId)}
        />
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.stripe", locale)}
          value={client.stripeCustomerId || "-"}
          ok={Boolean(client.stripeCustomerId)}
        />
        <SummaryRow
          label={t("onboarding.wizard.handoff.summary.trengo", locale)}
          value={client.trengoContactId || "-"}
          ok={Boolean(client.trengoContactId)}
        />
      </ul>

      {!client.campaignManager && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <span className="text-amber-700 dark:text-amber-300">
            {t("onboarding.wizard.handoff.no_cm_warning", locale)}
          </span>
        </div>
      )}

      {handoff.isError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-xs flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <span className="text-destructive">
            {handoff.error instanceof Error ? handoff.error.message : "Handoff failed"}
          </span>
        </div>
      )}

      <div className="flex justify-end pt-2 border-t border-border/40">
        <Button
          size="lg"
          onClick={() => handoff.mutate()}
          disabled={handoff.isPending}
          className="gap-2"
        >
          {handoff.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          {t("onboarding.wizard.handoff.cta", locale)}
        </Button>
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <CheckCircle2
        className={cn(
          "h-4 w-4 shrink-0",
          ok ? "text-emerald-500" : "text-muted-foreground/40",
        )}
      />
      <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn("truncate", ok ? "text-foreground" : "text-muted-foreground")}>
        {value}
      </span>
    </li>
  )
}
