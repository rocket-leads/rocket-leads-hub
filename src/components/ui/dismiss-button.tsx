"use client"

import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Single source of truth for "X close / dismiss" affordances across the
 * Hub. Before this component there were 5+ raw <button> implementations
 * with 4 different icon sizes (h-2.5 / h-3 / h-3.5 / h-4) and 3 different
 * container shapes (h-5, h-8, h-9). Roy 2026-05-22: dismiss should look
 * identical no matter where it lives.
 *
 * Two sizes, picked by what the dismiss CLOSES:
 *
 *   size="default" → 36×36, ghost variant. Use for closing a *container*:
 *                    Dialog, Sheet, slide-over, docked side-pane, full
 *                    banner. Top-right placement via `absolute top-2
 *                    right-2` or `top-3 right-3` is the convention.
 *
 *   size="xs"      → 20×20, ghost variant. Use for removing/clearing a
 *                    *value* inline: search input clear, chip remove,
 *                    selected-item remove, inline edit cancel.
 *
 * Both always render the same lucide <X> icon - never <XIcon>, never
 * <Cross2>, never a custom svg. Both always carry an `aria-label`
 * (default "Close", overridable). Both stop propagation by default
 * because dismiss-from-inside-a-clickable-row is the most common case.
 */
export type DismissButtonSize = "default" | "xs"

export function DismissButton({
  onClick,
  label = "Close",
  size = "default",
  stopPropagation = true,
  className,
}: {
  onClick: () => void
  label?: string
  size?: DismissButtonSize
  /** Set false when the dismiss is NOT inside another clickable surface. */
  stopPropagation?: boolean
  className?: string
}) {
  if (size === "xs") {
    return (
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation()
          onClick()
        }}
        aria-label={label}
        title={label}
        className={cn(
          "h-5 w-5 inline-flex items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors shrink-0",
          className,
        )}
      >
        <X className="h-3 w-3" />
      </button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        onClick()
      }}
      aria-label={label}
      title={label}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      <X className="h-4 w-4" />
    </Button>
  )
}
