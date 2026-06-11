"use client"

import { AnglesRefresh } from "@/app/(dashboard)/pedro/_components/angles-refresh"
import { ScriptRefresh } from "@/app/(dashboard)/pedro/_components/script-refresh"
import { CreativeRefresh } from "@/app/(dashboard)/pedro/_components/creative-refresh"
import type { Locale } from "@/lib/i18n/types"
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

/**
 * Thin wrappers around Pedro's existing per-stage Refresh components.
 * Each one takes the standard wizard step props and forwards just the
 * `selectedClientId` + `selectedClientName` that the Pedro component
 * needs — same interface the Pedro Onboard pipeline uses, no fork.
 *
 * Roy 2026-06-11: Pedro Onboard is opgegaan in de Onboarding wizard,
 * dus de AM ziet één continue flow + de CM hoeft niet meer naar een
 * aparte Pedro sidebar entry.
 */

export function CmAnglesStep({ mondayItemId, client }: Props) {
  return (
    <AnglesRefresh
      selectedClientId={mondayItemId}
      selectedClientName={client.companyName || client.name}
    />
  )
}

export function CmScriptsStep({ mondayItemId, client }: Props) {
  return (
    <ScriptRefresh
      selectedClientId={mondayItemId}
      selectedClientName={client.companyName || client.name}
    />
  )
}

export function CmCreativesStep({ mondayItemId, client }: Props) {
  return (
    <CreativeRefresh
      selectedClientId={mondayItemId}
      selectedClientName={client.companyName || client.name}
    />
  )
}
