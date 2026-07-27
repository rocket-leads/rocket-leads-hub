"use client"

import { Check, User, Circle } from "lucide-react"
import { cn } from "@/lib/utils"

export type TicketState = "open" | "assigned" | "closed"

/**
 * The 2-button ticket-state control (Roy 2026-07-27). Always exactly two
 * buttons: a big filled PRIMARY + a transparent SECONDARY, both pill-shaped,
 * state-dependent:
 *
 *   open      → [green "Close ticket" → closed] · [ghost "Assign" → assigned]
 *   assigned  → [green "Close ticket" → closed] · [ghost "Open"   → open]
 *   closed    → [orange "Assign"      → assigned] · [ghost "Open"  → open]
 *
 * `supportsAssigned=false` (updates, which have no in-progress state): the
 * "Assign" affordance drops out — open shows only Close, closed shows only a
 * single orange "Open" (reopen).
 */
export function TicketStateButtons({
  current,
  onSetState,
  supportsAssigned = true,
  className,
}: {
  current: TicketState
  onSetState: (target: TicketState) => void
  supportsAssigned?: boolean
  className?: string
}) {
  let primary: { label: string; target: TicketState; tone: "green" | "orange"; Icon: typeof Check }
  let secondary: { label: string; target: TicketState; Icon: typeof Check } | null

  if (current === "closed") {
    primary = supportsAssigned
      ? { label: "Assign", target: "assigned", tone: "orange", Icon: User }
      : { label: "Open", target: "open", tone: "orange", Icon: Circle }
    secondary = supportsAssigned ? { label: "Open", target: "open", Icon: Circle } : null
  } else {
    // open OR assigned → the primary is always "Close ticket" (green).
    primary = { label: "Close ticket", target: "closed", tone: "green", Icon: Check }
    secondary =
      current === "open"
        ? supportsAssigned
          ? { label: "Assign", target: "assigned", Icon: User }
          : null
        : { label: "Open", target: "open", Icon: Circle } // assigned → reopen
  }

  const PrimaryIcon = primary.Icon
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        onClick={() => onSetState(primary.target)}
        className={cn(
          "inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold text-white shadow-sm transition-colors",
          primary.tone === "green"
            ? "bg-emerald-500 hover:bg-emerald-600"
            : "bg-amber-500 hover:bg-amber-600",
        )}
      >
        <PrimaryIcon className="h-4 w-4" strokeWidth={2.5} />
        {primary.label}
      </button>
      {secondary &&
        (() => {
          const SecondaryIcon = secondary.Icon
          const target = secondary.target
          return (
            <button
              type="button"
              onClick={() => onSetState(target)}
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-transparent px-4 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground"
            >
              <SecondaryIcon className="h-4 w-4" />
              {secondary.label}
            </button>
          )
        })()}
    </div>
  )
}
