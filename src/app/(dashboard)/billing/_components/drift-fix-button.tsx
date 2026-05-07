"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, AlertTriangle, Check } from "lucide-react"

/**
 * One-click drift fix for multi-campaign groups whose siblings disagree on
 * `cycle_start_date`. Re-applies the primary sibling's cycle date via the
 * existing PATCH endpoint, which kicks the sibling-sync logic in
 * `lib/clients/edit.ts` — that already propagates a cycle change to every
 * other Monday row sharing the same Stripe customer.
 *
 * No new server logic needed; this is just a UX shortcut so finance doesn't
 * have to "edit and re-pick the same date" to trigger the sync.
 */
type Props = {
  /** Primary sibling's Monday item ID — the row whose date we propagate. */
  mondayItemId: string
  /** Primary sibling's current cycle date — what the other siblings will
   *  get written with. Empty string is rejected upstream by the validator. */
  cycleStartDate: string
}

export function DriftFixButton({ mondayItemId, cycleStartDate }: Props) {
  const router = useRouter()
  const [flash, setFlash] = useState<"ok" | null>(null)

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "cycle_start_date", value: cycleStartDate }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Sync failed")
      }
    },
    onSuccess: () => {
      setFlash("ok")
      router.refresh()
      setTimeout(() => setFlash(null), 2000)
    },
  })

  const disabled = mutation.isPending || !cycleStartDate

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        if (disabled) return
        mutation.mutate()
      }}
      disabled={disabled}
      title={
        cycleStartDate
          ? "Re-sync siblings to the primary's cycle date"
          : "No cycle date on the primary — set one first"
      }
      className="ml-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-amber-500 hover:bg-amber-500/10 disabled:opacity-60 transition-colors"
    >
      {mutation.isPending ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : flash === "ok" ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      <span className="text-[11px]">
        {mutation.isError
          ? "sync failed"
          : flash === "ok"
            ? "synced"
            : "fix drift"}
      </span>
    </button>
  )
}
