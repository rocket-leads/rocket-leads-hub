"use client"

import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * The one "last updated · refresh" control for the whole Hub. Before this,
 * Home / Watch List / Clients / Billing / Targets each hand-rolled their own
 * (5 different label styles, 4 refresh-button shapes, 3 time formats). This
 * standardises the chrome: a mono `--ink-faint` timestamp + the 187N `.icon-btn`
 * refresh that spins while fetching.
 *
 * `label` is already formatted by the caller (e.g. "Updated 15m ago") so each
 * page keeps its own i18n string; the convention Hub-wide is relative time.
 * Omit `onRefresh` for a label-only stamp (e.g. server-rendered Home); omit
 * `label` for a button-only control (e.g. Targets, no freshness stamp yet).
 */
export function RefreshMeta({
  label,
  onRefresh,
  refreshing = false,
  refreshLabel,
  title,
  className,
}: {
  label?: string | null
  onRefresh?: () => void
  refreshing?: boolean
  refreshLabel?: string
  /** Native tooltip on the label (e.g. the absolute timestamp). */
  title?: string
  className?: string
}) {
  if (!label && !onRefresh) return null
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {label && (
        <span
          className="font-mono text-[11px] leading-none tabular-nums text-muted-foreground/50"
          title={title}
        >
          {label}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          className="icon-btn disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label={refreshLabel}
          title={refreshLabel}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
        </button>
      )}
    </div>
  )
}
