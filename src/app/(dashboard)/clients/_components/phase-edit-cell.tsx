"use client"

import { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Check } from "lucide-react"
import {
  PHASE_LABELS,
  PHASE_OPTIONS,
  PHASE_TONES,
  mondayLabelToOnboardingPhase,
  phaseLabelI18n,
} from "@/lib/clients/status"
import { useLocale } from "@/lib/i18n/client"

const NEUTRAL_TONE = {
  dot: "bg-muted-foreground/30",
  pill: "bg-muted/40 text-muted-foreground",
}

type Props = {
  mondayItemId: string
  /** The raw Monday label from the `campaign_status` column. Rendered verbatim
   *  so legacy values (e.g. "In development") stay visible until migrated. */
  rawLabel: string
}

/**
 * Editable onboarding-phase cell. Displays the exact Monday label, coloured by
 * its mapped phase, and lets the user pick a new phase from the canonical 7
 * options — the chosen label is written back to Monday's `campaign_status`
 * column via the standard PATCH /api/clients/:id pipeline.
 */
export function PhaseEditCell({ mondayItemId, rawLabel }: Props) {
  const router = useRouter()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [optimisticLabel, setOptimisticLabel] = useState<string>(rawLabel)

  useEffect(() => setOptimisticLabel(rawLabel), [rawLabel])

  const phase = mondayLabelToOnboardingPhase(optimisticLabel)
  const tone = phase ? PHASE_TONES[phase] : NEUTRAL_TONE
  // Hub-canonical phases get translated; legacy raw Monday labels (that don't
  // map cleanly) fall through to the literal Monday string so users still see
  // what's actually on the board.
  const displayLabel = phase ? phaseLabelI18n(phase, locale) : optimisticLabel

  const mutation = useMutation({
    mutationFn: async (nextLabel: string) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: "campaign_status",
          label: nextLabel,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update phase")
      }
    },
    onError: () => setOptimisticLabel(rawLabel),
    onSuccess: () => router.refresh(),
  })

  const pill = optimisticLabel ? (
    <span
      className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium ${tone.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {displayLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium bg-muted/40 text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
      —
    </span>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className="hover:opacity-80 transition-opacity outline-none"
      >
        {pill}
      </PopoverTrigger>
      <PopoverContent
        className="min-w-52 p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {PHASE_OPTIONS.map((opt) => {
          // Write-back label = canonical EN (Monday's option string).
          // Display label = locale-aware translation.
          const writeLabel = PHASE_LABELS[opt]
          const displayOpt = phaseLabelI18n(opt, locale)
          const optTone = PHASE_TONES[opt]
          const isCurrent = writeLabel === optimisticLabel
          return (
            <button
              key={opt}
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setOptimisticLabel(writeLabel)
                mutation.mutate(writeLabel)
                setOpen(false)
              }}
              className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted transition-colors disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-2">
                <span className={`h-1.5 w-1.5 rounded-full ${optTone.dot}`} />
                {displayOpt}
              </span>
              {isCurrent && <Check className="h-3.5 w-3.5 text-foreground/70" />}
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
