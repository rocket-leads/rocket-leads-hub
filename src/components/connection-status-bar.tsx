"use client"

import type { ClientHealth, ServiceHealth } from "@/lib/integrations/health"
import { cn } from "@/lib/utils"

/**
 * Compact 5-dot per-row indicator for the connection health audit.
 *
 *   ●●●●●  Order: Stripe · Meta · Trengo · Monday · Drive
 *
 * Dot tones:
 *   green   = ok
 *   red     = broken or (required + missing)
 *   amber   = warning (resolved-but-degraded, e.g. Meta Pending review)
 *   muted   = not_used (optional service intentionally blank - Monday or
 *             Drive when the client doesn't use them)
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
  const tone = toneFor(health.state)
  const title = buildTooltip(label, health)
  return (
    <span
      title={title}
      className={cn("h-1.5 w-1.5 rounded-full transition-colors", tone)}
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
      // Required field with no link. Same red as broken - both are real
      // problems for the audit roll-up.
      return "bg-destructive"
    case "not_used":
      // Optional service intentionally blank - calm muted dot so it reads
      // as "the AM made a choice", not "something's wrong".
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
      return `${label}: not linked`
    case "not_used":
      return `${label}: not used (optional)`
  }
}
