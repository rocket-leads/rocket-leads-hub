"use client"

import { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Check } from "lucide-react"
import {
  STATUS_LABELS,
  STATUS_OPTIONS,
  STATUS_TONES,
  hubStatusToMondayLabel,
  type ClientStatus,
} from "@/lib/clients/status"

type Props = {
  mondayItemId: string
  status: ClientStatus
  /** Onboarding-board clients are derived from board membership, not the column. */
  readOnly?: boolean
}

export function StatusEditCell({ mondayItemId, status, readOnly }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [optimisticStatus, setOptimisticStatus] = useState(status)

  useEffect(() => setOptimisticStatus(status), [status])

  const tone = STATUS_TONES[optimisticStatus]

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
    <span
      className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-[13px] font-medium ${tone.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {STATUS_LABELS[optimisticStatus]}
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
            <span className="inline-flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_TONES[opt].dot}`} />
              {STATUS_LABELS[opt]}
            </span>
            {opt === optimisticStatus && <Check className="h-3.5 w-3.5 text-foreground/70" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
