"use client"

import { useState, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Check, X } from "lucide-react"
import { viewAdministration, type AdministrationTone } from "@/lib/clients/administration"

// Map the Administration domain tone → 187N .st-label tone (dot + mono
// uppercase, no fill). Local to billing so the shared lib stays untouched.
const ADMIN_ST_TONE: Record<AdministrationTone, string> = {
  neutral: "idle",
  warn: "warn",
  danger: "error",
  success: "live",
  muted: "idle",
}

type Props = {
  mondayItemId: string
  /** Current raw label from Monday's `status_16` column. Empty string when unset. */
  value: string
  /** Distinct labels finance can pick from. Sourced from the Monday boards
   *  cache at page render - every label currently in use across any client
   *  is available, so the popover stays in sync with whatever Monday allows
   *  without needing a settings change. */
  options: string[]
}

/**
 * Editable Admin cell on the Billing overview - same UX as the Status cell.
 * Click the pill, pick a label from the popover, optimistic update, PATCH
 * goes through `updateClientField('administration', label)` which writes the
 * Monday `status_16` column and patches the `monday_boards` cache. The page
 * `router.refresh()` then re-renders with the new value (and, since we map
 * the Admin column to that same cache, the cell stays consistent).
 */
export function AdminEditCell({ mondayItemId, value, options }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [optimisticValue, setOptimisticValue] = useState(value)

  useEffect(() => setOptimisticValue(value), [value])

  const view = viewAdministration(optimisticValue)

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "administration", label: next }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update admin status")
      }
    },
    onError: () => setOptimisticValue(value),
    onSuccess: () => router.refresh(),
  })

  const pill =
    view.tone === "muted" && view.label === "-" ? (
      <span className="text-[11px] text-muted-foreground/40">-</span>
    ) : (
      <span
        className={`st-label ${ADMIN_ST_TONE[view.tone]}`}
        title={
          view.originalLabel && view.originalLabel.toLowerCase() !== view.label.toLowerCase()
            ? `Monday: ${view.originalLabel}`
            : undefined
        }
      >
        <span className="sd" />
        {view.label}
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
        {options.map((opt) => {
          const optView = viewAdministration(opt)
          const isSelected = opt === optimisticValue
          return (
            <button
              key={opt}
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setOptimisticValue(opt)
                mutation.mutate(opt)
                setOpen(false)
              }}
              className="w-full flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-[12px] hover:bg-muted transition-colors disabled:opacity-50"
            >
              <span className={`st-label ${ADMIN_ST_TONE[optView.tone]}`}>
                <span className="sd" />
                {optView.label}
              </span>
              {isSelected && <Check className="h-3.5 w-3.5 text-foreground/70" />}
            </button>
          )
        })}
        {optimisticValue && (
          <>
            <div className="my-1 border-t border-border/50" />
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => {
                setOptimisticValue("")
                mutation.mutate("")
                setOpen(false)
              }}
              className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
