"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Calendar, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Inline-editable next-invoice-date cell. Shows the current date as a button;
 * click reveals a native date input that auto-saves on change. After save we
 * `router.refresh()` so the row reshuffles into the right time-bucket (overdue
 * → today → this week → …) without a full page reload.
 *
 * Backed by PATCH /api/clients/[id] with `fieldKey: "next_invoice_date"`,
 * which writes Monday's `date3` column and re-syncs Supabase.
 */
type Props = {
  mondayItemId: string
  /** YYYY-MM-DD or empty when unset. */
  value: string
}

function fmt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

export function NextInvoiceDateCell({ mondayItemId, value }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [optimistic, setOptimistic] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setOptimistic(value), [value])

  // Auto-focus + open the picker when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      // Some browsers ignore showPicker if it's not in a user gesture chain;
      // we still call focus so keyboard arrows work as a fallback.
      try {
        inputRef.current?.showPicker?.()
      } catch {
        // showPicker can throw on browsers that don't support it — silent fallback.
      }
    }
  }, [editing])

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "next_invoice_date", value: next }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? "Failed to update date")
      }
    },
    onError: () => setOptimistic(value),
    onSuccess: () => router.refresh(),
  })

  function commit(next: string) {
    if (next === optimistic) {
      setEditing(false)
      return
    }
    setOptimistic(next)
    mutation.mutate(next)
    setEditing(false)
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      {editing ? (
        <input
          ref={inputRef}
          type="date"
          defaultValue={optimistic}
          onChange={(e) => commit(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false)
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
          }}
          className="h-7 px-2 rounded-md border border-border bg-background text-xs tabular-nums focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(true)
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 -mx-1.5 -my-1 text-xs tabular-nums transition-colors",
            "hover:bg-muted hover:text-foreground",
          )}
          title="Click to edit"
        >
          <Calendar className="h-3 w-3 text-muted-foreground/60" />
          {optimistic ? fmt(optimistic) : <span className="text-muted-foreground/60">Set date</span>}
        </button>
      )}
      {mutation.isPending && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}
