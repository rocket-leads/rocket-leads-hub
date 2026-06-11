"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, Circle, Lock, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { WizardActionType } from "@/lib/clients/onboarding"
import { useState, useEffect } from "react"
import { StepRenderer } from "./step-renderer"

export type SerializedStep = {
  key: string
  labelKey: DictionaryKey
  descriptionKey: DictionaryKey
  action: WizardActionType
  order: number
  prerequisites: string[]
  critical: boolean
  done: boolean
  locked: boolean
  completedAt: string | null
  completedBy: string | null
  content: unknown
}

export type WizardClient = {
  mondayItemId: string
  name: string
  companyName: string
  accountManager: string
  campaignManager: string
  googleDriveId: string
  metaAdAccountId: string
  stripeCustomerId: string
  trengoContactId: string
  clientBoardId: string
  /** Monthly ad budget in EUR (Monday `numeric0` on the onboarding board,
   *  or the corresponding mapped column on the current board). Surfaced
   *  in the RL-ad-account inline input on Stap 1. May be "" when unset. */
  adBudget: string
}

export type WizardPayload = {
  steps: SerializedStep[]
  currentStepKey: string | null
  missingCritical: string[]
  percent: number
  client: WizardClient
}

type Props = {
  mondayItemId: string
  clientName: string
  locale: Locale
}

/**
 * The onboarding wizard's outer chrome - header (client name + progress
 * bar + back link), left rail (step list), right pane (active step).
 *
 * Active step is "current step" by default (the lowest-order step that's
 * not done and not locked). The user can click any unlocked step in the
 * rail to jump there; done steps re-open read-only (or editable, per
 * step's choice).
 */
export function WizardShell({ mondayItemId, clientName, locale: serverLocale }: Props) {
  // Honour client-side locale switching even though the page's initial
  // server render used the server-resolved locale.
  const clientLocale = useLocale()
  const locale = clientLocale ?? serverLocale

  const queryClient = useQueryClient()

  const query = useQuery<WizardPayload>({
    queryKey: ["onboarding-wizard", mondayItemId],
    queryFn: () =>
      fetch(`/api/clients/${mondayItemId}/onboarding`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      }),
    staleTime: 30 * 1000,
  })

  const data = query.data
  const steps = data?.steps ?? []

  // Active step - defaults to the wizard's current step (resolved server-
  // side). User clicks in the rail override the default. Reset to the
  // current step when the payload first loads.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  useEffect(() => {
    if (!activeKey && data?.currentStepKey) setActiveKey(data.currentStepKey)
  }, [activeKey, data?.currentStepKey])

  const activeStep = steps.find((s) => s.key === activeKey) ?? steps.find((s) => s.key === data?.currentStepKey) ?? steps[0]

  // Called by step components after they successfully save - refresh the
  // wizard payload so the rail flips the step to "done" and current-step
  // resolution rolls forward to the next available step.
  const onStepSaved = (nextStepKey?: string) => {
    queryClient.invalidateQueries({ queryKey: ["onboarding-wizard", mondayItemId] })
    if (nextStepKey) setActiveKey(nextStepKey)
  }

  return (
    <div className="space-y-4">
      {/* Header - back link + name + progress */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
          >
            <ArrowLeft className="h-3 w-3" />
            {t("onboarding.wizard.back_to_overview", locale)}
          </Link>
          <h1 className="font-heading text-[24px] font-semibold tracking-tight leading-tight text-foreground">
            {clientName}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("onboarding.wizard.subtitle", locale)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("onboarding.wizard.progress", locale)}
            </div>
            <div className="text-sm font-medium tabular-nums">
              {steps.filter((s) => s.done).length} / {steps.length} · {data?.percent ?? 0}%
            </div>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-muted/60 overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${data?.percent ?? 0}%` }}
        />
      </div>

      {/* Loading state */}
      {query.isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-sm">{t("onboarding.wizard.loading", locale)}</span>
        </div>
      )}

      {/* Error state */}
      {query.isError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load wizard"}
        </div>
      )}

      {/* Wizard body - rail + active step */}
      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Left rail */}
          <nav className="space-y-1 rounded-2xl border border-border/60 bg-card p-2 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]">
            {steps.map((step) => (
              <RailItem
                key={step.key}
                step={step}
                active={activeStep?.key === step.key}
                onClick={() => {
                  if (step.locked) return
                  setActiveKey(step.key)
                }}
                locale={locale}
              />
            ))}
          </nav>

          {/* Right pane - active step's action UI */}
          <div className="rounded-2xl border border-border/60 bg-card shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] overflow-hidden">
            {activeStep ? (
              <StepRenderer
                step={activeStep}
                mondayItemId={mondayItemId}
                client={data.client}
                allSteps={steps}
                locale={locale}
                onStepSaved={onStepSaved}
              />
            ) : (
              <div className="p-8 text-sm text-muted-foreground">
                {t("onboarding.wizard.no_active_step", locale)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RailItem({
  step,
  active,
  onClick,
  locale,
}: {
  step: SerializedStep
  active: boolean
  onClick: () => void
  locale: Locale
}) {
  const Icon = step.done ? CheckCircle2 : step.locked ? Lock : Circle
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={step.locked}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors",
        active && "bg-primary/10 text-foreground",
        !active && !step.locked && "hover:bg-muted/40 text-muted-foreground",
        step.locked && "opacity-50 cursor-not-allowed text-muted-foreground",
      )}
      title={
        step.locked
          ? t("onboarding.wizard.rail.locked_tooltip", locale)
          : step.done
            ? t("onboarding.wizard.rail.done_tooltip", locale)
            : undefined
      }
    >
      <span
        className={cn(
          "shrink-0 h-5 w-5 flex items-center justify-center rounded-full text-[10px] font-medium tabular-nums",
          step.done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground",
        )}
      >
        {step.done ? <CheckCircle2 className="h-3 w-3" /> : step.order}
      </span>
      <span className={cn("flex-1 truncate", step.done && "line-through text-muted-foreground/70")}>
        {t(step.labelKey, locale)}
      </span>
      {step.locked && <Icon className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
    </button>
  )
}
