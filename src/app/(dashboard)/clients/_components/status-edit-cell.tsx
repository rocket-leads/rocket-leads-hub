"use client"

import { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Check } from "lucide-react"
import {
  STATUS_LABEL_KEYS,
  STATUS_OPTIONS,
  hubStatusToMondayLabel,
  statusLabelI18n,
  type ClientStatus,
} from "@/lib/clients/status"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

// Hub status -> 187N bare-label tone. Live=green, On Hold=amber, Onboarding=
// blue (learning), Churned/empty=grey.
const STATUS_TONE_KEY: Record<string, "live" | "warn" | "pending" | "idle"> = {
  live: "live",
  on_hold: "warn",
  onboarding: "pending",
  churned: "idle",
  null: "idle",
}

type Props = {
  mondayItemId: string
  /** Null when Monday's status column is empty or holds an unmapped value.
   *  Renders as a muted "-" pill so the empty state is visible and clickable. */
  status: ClientStatus | null
  /** Onboarding-board clients are derived from board membership, not the column. */
  readOnly?: boolean
}

export function StatusEditCell({ mondayItemId, status, readOnly }: Props) {
  const router = useRouter()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [optimisticStatus, setOptimisticStatus] = useState<ClientStatus | null>(status)

  useEffect(() => setOptimisticStatus(status), [status])

  const toneKey = STATUS_TONE_KEY[optimisticStatus ?? "null"] ?? "idle"

  const mutation = useMutation({
    mutationFn: async (next: ClientStatus) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldKey: "campaign_status",
          label: hubStatusToMondayLabel(next),
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update status")
      }
    },
    onError: () => setOptimisticStatus(status),
    onSuccess: () => router.refresh(),
  })

  const pill = (
    <span className={`st-label ${toneKey}`}>
      <span className="sd" />
      {statusLabelI18n(optimisticStatus, locale)}
    </span>
  )

  if (readOnly) return pill

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className="hover:opacity-80 transition-opacity outline-none"
      >
        {pill}
      </PopoverTrigger>
      <PopoverContent
        className="min-w-44 p-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt}
            type="button"
            disabled={mutation.isPending}
            onClick={() => {
              setOptimisticStatus(opt)
              mutation.mutate(opt)
              setOpen(false)
            }}
            className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted transition-colors disabled:opacity-50"
          >
            <span className={`st-label ${STATUS_TONE_KEY[opt] ?? "idle"}`}>
              <span className="sd" />
              {t(STATUS_LABEL_KEYS[opt], locale)}
            </span>
            {opt === optimisticStatus && <Check className="h-3.5 w-3.5 text-foreground/70" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
