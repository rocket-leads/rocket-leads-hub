"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Inline-editable euro cell used on the Billing page for the "fee" and
 * "ad budget" columns. Click the value to reveal a number input; auto-saves
 * on blur or Enter via PATCH /api/clients/[id]/agreement.
 *
 * Optimistic - the typed value renders immediately. On save success we
 * `router.refresh()` so the row re-aggregates (group totals, MRR headline,
 * etc.) and any server-side derivation (e.g. follow-up fee in the fee math)
 * reflects in the next render. On error we revert + surface the message
 * inline.
 */
type Props = {
  mondayItemId: string
  field: "fee" | "ad_budget"
  /** Current value in euros (whole number). */
  value: number
  /** When false, the cell renders the value as static text - used on the
   *  parent row of multi-sibling groups where editing happens on the
   *  sub-rows instead. */
  editable?: boolean
  /** Optional placeholder when `value` is 0 / unset. Defaults to "-". */
  placeholder?: string
  /** Style class for the rendered button. Defaults to a "muted" variant
   *  appropriate for the ad-budget column; pass a stronger one for "fee". */
  className?: string
}

function fmtEuro(v: number): string {
  return `€${v.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

export function AgreementAmountCell({
  mondayItemId,
  field,
  value,
  editable = true,
  placeholder = "-",
  className,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [optimistic, setOptimistic] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setOptimistic(value), [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  // Auto-clear an inline error after a few seconds so it doesn't pin the row.
  useEffect(() => {
    if (!error) return
    const id = setTimeout(() => setError(null), 4000)
    return () => clearTimeout(id)
  }, [error])

  const mutation = useMutation({
    mutationFn: async (next: number) => {
      const res = await fetch(`/api/clients/${mondayItemId}/agreement`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value: next }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Update failed")
    },
    onError: (e) => {
      setOptimistic(value)
      setError(e instanceof Error ? e.message : "Update failed")
    },
    onSuccess: () => {
      setError(null)
      router.refresh()
    },
  })

  function commit(next: number) {
    setEditing(false)
    if (next === optimistic) return
    if (!Number.isFinite(next) || next < 0) {
      setError("Enter a non-negative number")
      return
    }
    setOptimistic(next)
    mutation.mutate(next)
  }

  if (!editable) {
    return value > 0 ? (
      <span className="text-xs tabular-nums">{fmtEuro(value)}</span>
    ) : (
      <span className="text-muted-foreground/40 text-xs">{placeholder}</span>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      {editing ? (
        <div className="relative w-24">
          <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[11px] text-muted-foreground">
            €
          </span>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={0}
            step={50}
            defaultValue={optimistic === 0 ? "" : optimistic}
            onBlur={(e) => commit(Number(e.target.value || 0))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false)
              if (e.key === "Enter") commit(Number((e.target as HTMLInputElement).value || 0))
            }}
            className="h-7 w-full pl-5 pr-1.5 rounded-md border border-border bg-background text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            placeholder="0"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className={cn(
            "inline-flex items-center rounded-md px-1.5 py-1 -mx-1.5 -my-1 text-xs tabular-nums transition-colors",
            "hover:bg-muted hover:text-foreground",
            className,
          )}
          title="Click to edit"
        >
          {optimistic > 0 ? (
            fmtEuro(optimistic)
          ) : (
            <span className="text-muted-foreground/40">{placeholder}</span>
          )}
        </button>
      )}
      {mutation.isPending && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
      {error && (
        <span
          className="text-[10px] text-destructive max-w-[180px] truncate"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  )
}
