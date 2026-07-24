"use client"

import { useState } from "react"
import { Sparkles, Loader2, RefreshCw, MessageSquareText } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import type { InvoiceReadiness } from "@/app/api/billing/invoice-readiness/[id]/route"

type Props = {
  mondayItemId: string
  clientName: string
  /** Server-rendered initial value from the `invoice_readiness` cache. Null
   *  when the cache has no entry yet for this client - the cell shows a
   *  "Run AI check" button on first hit, then auto-fetches. */
  initial: InvoiceReadiness | null
  /** Deep link to the Monday item, built server-side from the parent board
   *  ID. Null when board config wasn't available - link is hidden in that
   *  case rather than rendered broken. */
  mondayItemUrl: string | null
}

// 187N status tones for the bare .st-label verdict (dot + mono uppercase).
const VERDICT_TONES = {
  send: { st: "live", label: "Send" },
  check: { st: "warn", label: "Check" },
  hold: { st: "error", label: "Hold" },
  error: { st: "idle", label: "AI failed" },
} as const

/**
 * AI cell on the Billing page. Renders a tiny verdict pill (Send / Check /
 * Hold + confidence%) sourced from the `invoice_readiness` cache. Click the
 * pill to expand the reasoning + the Monday updates the model used as input,
 * and to refresh the verdict on demand.
 */
export function InvoiceReadinessCell({ mondayItemId, clientName, initial, mondayItemUrl }: Props) {
  const [open, setOpen] = useState(false)
  // Local state keeps things simple - we never want to auto-fetch on mount
  // (would fire ~50 Claude calls per page load), so the React Query machinery
  // doesn't add anything here. Compute is on-demand only: popover open or
  // explicit Refresh click.
  const [data, setData] = useState<InvoiceReadiness | null>(initial)
  const [isFetching, setIsFetching] = useState(false)

  async function fetchReadiness(refresh = false) {
    setIsFetching(true)
    try {
      const url = `/api/billing/invoice-readiness/${mondayItemId}${refresh ? "?refresh=1" : ""}`
      const res = await fetch(url)
      if (!res.ok) return
      const json = (await res.json()) as InvoiceReadiness
      setData(json)
    } finally {
      setIsFetching(false)
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // First time opening with no cached verdict → kick off the compute.
    if (next && !data) void fetchReadiness(false)
  }

  // Empty / loading state when there's no verdict yet at all.
  if (!data) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          void fetchReadiness(false)
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
        title="Run AI check"
      >
        <Sparkles className="h-3 w-3" />
        Run AI check
      </button>
    )
  }

  const tone = VERDICT_TONES[data.verdict]

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className="inline-flex items-center gap-2 transition-opacity hover:opacity-80"
        title={
          data.verdict === "error"
            ? "AI check failed - open to retry"
            : `${tone.label} · ${data.confidence}% confidence`
        }
      >
        <span className={`st-label ${tone.st}`}>
          <span className="sd" />
          {tone.label}
        </span>
        {data.verdict !== "error" && (
          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">{data.confidence}%</span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="px-4 py-3 border-b border-border/40">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold leading-tight">{clientName}</p>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => fetchReadiness(true)}
              disabled={isFetching}
              title="Re-run AI check"
            >
              {isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground/70">
            <span className={`st-label ${tone.st}`}>
              <span className="sd" />
              {tone.label}{data.verdict !== "error" ? ` · ${data.confidence}%` : ""}
            </span>
            <span>{new Date(data.computedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium mb-1">Reden</p>
          <p className="text-xs leading-relaxed text-foreground/90">{data.reason}</p>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium inline-flex items-center gap-1">
              <MessageSquareText className="h-3 w-3" />
              Monday updates ({data.updates.length})
            </p>
            {mondayItemUrl && (
              <a
                href={mondayItemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-primary hover:underline"
              >
                Open in Monday
              </a>
            )}
          </div>
          {data.updates.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">No updates in the last 21 days.</p>
          ) : (
            <ul className="space-y-2.5 max-h-[260px] overflow-y-auto">
              {data.updates.slice(0, 15).map((u, i) => (
                <li key={i} className="text-xs leading-snug">
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    <span className="text-muted-foreground/60 tabular-nums">{u.createdAt}</span>
                    {u.creatorName && (
                      <span className="text-[10px] font-medium text-muted-foreground/80">
                        · {u.creatorName}
                      </span>
                    )}
                  </div>
                  <span className="text-foreground/85 whitespace-pre-wrap">{u.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
