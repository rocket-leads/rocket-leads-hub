"use client"

import type { ClientHealth, ServiceHealth } from "@/lib/integrations/health"
import { cn } from "@/lib/utils"

/**
 * Compact 5-dot per-row indicator for the connection health audit.
 *
 *   ●●●●●  Order: Stripe · Meta · Trengo · Monday · Drive
 *
 * Dot tones:
 *   green        = ok
 *   red          = broken, or missing (empty + not marked N/A → needs action)
 *   amber        = warning (resolved-but-degraded, e.g. Meta Pending review)
 *   struck dash  = not_applicable (empty + explicitly marked N/A for this
 *                  client). Visually distinct from a red "missing" dot so
 *                  "forgot to link" reads differently from "doesn't apply".
 *
 * Hover any dot to see the service name + resolved entity (or error reason),
 * so the AM can triage without expanding the row.
 *
 * Loading state shows skeleton dots while the audit request is in flight.
 */

type Props = {
  health: ClientHealth | undefined
  /** True while the parent is still loading audit data for this row. */
  loading?: boolean
}

const SERVICE_ORDER: Array<{
  key: keyof Pick<ClientHealth, "stripe" | "meta" | "trengo" | "monday" | "drive">
  label: string
}> = [
  { key: "stripe", label: "Stripe" },
  { key: "meta", label: "Meta" },
  { key: "trengo", label: "Trengo" },
  { key: "monday", label: "Monday" },
  { key: "drive", label: "Drive" },
]

export function ConnectionStatusBar({ health, loading }: Props) {
  if (loading || !health) {
    return (
      <span className="inline-flex items-center gap-1">
        {SERVICE_ORDER.map((s) => (
          <span
            key={s.key}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20 animate-pulse"
            aria-label={`${s.label} loading`}
          />
        ))}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1" aria-label="Connection health">
      {SERVICE_ORDER.map((s) => {
        const svc = health[s.key]
        return <Dot key={s.key} label={s.label} health={svc} />
      })}
    </span>
  )
}

function Dot({ label, health }: { label: string; health: ServiceHealth }) {
  const title = buildTooltip(label, health)

  // N/A renders as a struck dash rather than a coloured dot - the whole point
  // is that "explicitly not applicable" looks different from every dot state.
  if (health.state === "not_applicable") {
    return (
      <span
        title={title}
        aria-label={title}
        className="inline-flex h-1.5 w-2.5 items-center justify-center font-mono text-[10px] leading-none text-muted-foreground/50 line-through"
      >
        –
      </span>
    )
  }

  return (
    <span
      title={title}
      className={cn("h-1.5 w-1.5 rounded-full transition-colors", toneFor(health.state))}
      aria-label={title}
    />
  )
}

function toneFor(state: ServiceHealth["state"]): string {
  switch (state) {
    case "ok":
      return "bg-emerald-500"
    case "warning":
      return "bg-amber-500"
    case "broken":
      return "bg-destructive"
    case "missing":
      // Empty + not marked N/A. Needs action (link it or mark N/A) - same red
      // as broken; both count in the audit roll-up.
      return "bg-destructive"
    default:
      // not_applicable is handled above; any legacy/cached state falls here as
      // a calm muted dot until the 1h health cache refreshes.
      return "bg-muted-foreground/30"
  }
}

function buildTooltip(label: string, health: ServiceHealth): string {
  switch (health.state) {
    case "ok":
      return `${label}: ${health.name ?? "OK"}`
    case "warning":
      return `${label}: ${health.name ?? "OK"} (warning)`
    case "broken":
      return `${label}: broken${health.error ? ` - ${health.error}` : ""}`
    case "missing":
      return `${label}: not linked - link it or mark N/A`
    case "not_applicable":
      return `${label}: not applicable${health.note ? ` - ${health.note}` : ""}`
    default:
      return `${label}: unknown`
  }
}
