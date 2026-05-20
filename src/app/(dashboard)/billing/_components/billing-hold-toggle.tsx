"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Pause, Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"

type Props = {
  mondayItemId: string
  held: boolean
  /** Optional note finance can attach when holding. Surfaced in the title
   *  attribute when set so the rationale isn't lost on team handoff. */
  reason: string | null
}

/**
 * Toggle the manual billing-hold flag from inline on a billing row. Click
 * once to hold (parks the client in the "On hold" bucket above Overdue),
 * click again to release (returns to the time-based buckets).
 *
 * Optimistic — flips the icon immediately and rolls back on error. After
 * success, calls `router.refresh()` so the row visibly jumps to its new
 * bucket without the user needing to reload.
 */
export function BillingHoldToggle({ mondayItemId, held, reason }: Props) {
  const router = useRouter()
  const [optimisticHeld, setOptimisticHeld] = useState(held)

  const mutation = useMutation({
    mutationFn: async (nextHeld: boolean) => {
      const res = await fetch(`/api/clients/${mondayItemId}/billing-hold`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hold: nextHeld }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update hold")
      }
    },
    onError: () => setOptimisticHeld(held),
    onSuccess: () => router.refresh(),
  })

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (mutation.isPending) return
    const next = !optimisticHeld
    setOptimisticHeld(next)
    mutation.mutate(next)
  }

  const title = optimisticHeld
    ? reason
      ? `On hold: ${reason} — click to release`
      : "On hold — click to release"
    : "Hold this client (skip invoicing this cycle)"

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      onClick={toggle}
      disabled={mutation.isPending}
      title={title}
      aria-label={optimisticHeld ? "Release billing hold" : "Hold this client"}
      className={
        optimisticHeld
          ? "text-violet-500 hover:text-violet-600"
          : "text-muted-foreground hover:text-foreground"
      }
    >
      {mutation.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : optimisticHeld ? (
        <Play className="h-3.5 w-3.5" />
      ) : (
        <Pause className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}
