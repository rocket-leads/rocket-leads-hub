"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Folder,
  Megaphone,
  CircleDollarSign,
  CheckCircle2,
  Circle,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react"
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

type WaitStatus = {
  driveContent: {
    detected: boolean
    fileCount: number
    folderId: string | null
  }
  metaBmLinked: {
    detected: boolean
    adAccountId: string | null
  }
  payment: {
    detected: boolean
    lastPaidAt: number | null
    lastPaidAmount: number | null
    hasCustomerId: boolean
  }
  allGreen: boolean
}

/**
 * Stap 4 — Wait on client. Polls three completion signals every 60s and
 * auto-promotes the step done when all three are green. AM doesn't have
 * to click anything (in the happy path); the rail flips this step to
 * green silently and the wizard's "current step" jumps to handoff.
 *
 * "Skip step" override exists for edge cases — e.g. a client paid via
 * bank transfer that Stripe won't see, or content was delivered out-of-
 * band on Drive that we can't detect.
 */
export function WaitOnClientStep({
  step,
  mondayItemId,
  locale,
  nextKey,
  onStepSaved,
}: Props) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery<WaitStatus>({
    queryKey: ["onboarding-wait-status", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/onboarding/wait-status`).then((r) => r.json()),
    refetchInterval: step.done ? false : 60 * 1000,
  })

  const skip = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}/onboarding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepKey: step.key,
          done: true,
          content: { skipped: true, skippedAt: new Date().toISOString() },
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? "Skip failed")
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-wizard", mondayItemId] })
      onStepSaved(nextKey)
    },
  })

  const status = statusQuery.data

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {t("onboarding.wizard.wait.hint", locale)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
          className="gap-1 text-xs"
        >
          <RefreshCw
            className={cn("h-3 w-3", statusQuery.isFetching && "animate-spin")}
          />
          {t("onboarding.wizard.wait.refresh", locale)}
        </Button>
      </div>

      {statusQuery.isLoading && !status && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("onboarding.wizard.wait.loading", locale)}
        </div>
      )}

      {status && (
        <ul className="space-y-2">
          <SignalRow
            icon={Folder}
            label={t("onboarding.wizard.wait.drive.label", locale)}
            detected={status.driveContent.detected}
            detail={
              status.driveContent.detected
                ? `${status.driveContent.fileCount} ${t("onboarding.wizard.wait.drive.files", locale)}`
                : status.driveContent.folderId
                  ? t("onboarding.wizard.wait.drive.waiting", locale)
                  : t("onboarding.wizard.wait.drive.no_folder", locale)
            }
            locale={locale}
          />
          <SignalRow
            icon={Megaphone}
            label={t("onboarding.wizard.wait.meta.label", locale)}
            detected={status.metaBmLinked.detected}
            detail={
              status.metaBmLinked.detected
                ? `${t("onboarding.wizard.wait.meta.linked", locale)} · ${status.metaBmLinked.adAccountId}`
                : t("onboarding.wizard.wait.meta.waiting", locale)
            }
            locale={locale}
          />
          <SignalRow
            icon={CircleDollarSign}
            label={t("onboarding.wizard.wait.payment.label", locale)}
            detected={status.payment.detected}
            detail={
              !status.payment.hasCustomerId
                ? t("onboarding.wizard.wait.payment.no_customer", locale)
                : status.payment.detected
                  ? `${t("onboarding.wizard.wait.payment.paid", locale)}${
                      status.payment.lastPaidAmount != null
                        ? ` · €${status.payment.lastPaidAmount.toLocaleString("nl-NL")}`
                        : ""
                    }`
                  : t("onboarding.wizard.wait.payment.waiting", locale)
            }
            locale={locale}
          />
        </ul>
      )}

      {status?.allGreen && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs flex items-start gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          <span className="text-emerald-700 dark:text-emerald-300">
            {t("onboarding.wizard.wait.all_green", locale)}
          </span>
        </div>
      )}

      {/* Skip override for edge cases */}
      {!step.done && status && !status.allGreen && (
        <div className="flex items-center justify-between gap-3 pt-4 border-t border-border/40">
          <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{t("onboarding.wizard.wait.skip.hint", locale)}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => skip.mutate()}
            disabled={skip.isPending}
            className="gap-1.5"
          >
            {skip.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("onboarding.wizard.wait.skip.btn", locale)}
          </Button>
        </div>
      )}

      {statusQuery.isError && (
        <div className="text-xs text-destructive">
          {statusQuery.error instanceof Error
            ? statusQuery.error.message
            : "Check failed"}
        </div>
      )}
    </div>
  )
}

function SignalRow({
  icon: Icon,
  label,
  detected,
  detail,
  locale: _locale,
}: {
  icon: typeof Folder
  label: string
  detected: boolean
  detail: string
  locale: Locale
}) {
  return (
    <li
      className={cn(
        "rounded-xl border bg-card/50 p-3 flex items-center gap-3 transition-colors",
        detected
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-border/60",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          detected ? "text-emerald-500" : "text-muted-foreground",
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div
          className={cn(
            "text-xs truncate",
            detected
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          {detail}
        </div>
      </div>
      {detected ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      )}
    </li>
  )
}
