"use client"

import { cn } from "@/lib/utils"

/**
 * Single source of truth for row-level actions across the Hub. Every
 * surface that shows actionable rows (inbox tasks, co-pilot bell drafts,
 * watchlist rows, future Tasks lists) renders identical chrome through
 * this component. Roy 2026-05-22: "alle knoppen overal 1 op 1 aligned".
 *
 * Two render modes, same height (h-9) so they line up in a row:
 *   - icon-only (default)  → 36×36 square, label goes to title+aria-label
 *   - chip with label      → pass `showLabel` to render `{icon} {label}`
 *                            inline. Use this for "Create task" / "Make
 *                            update" type actions where the verb matters.
 *
 * Three tones (semantic, not visual):
 *   - success → primary "approve / done" action (emerald)
 *   - danger  → "delete / dismiss" — muted by default, red on hover
 *   - muted   → neutral secondary (snooze, reassign, edit, create-task)
 *
 * Optional `state` slot for transient feedback after an async action:
 *   - "done"   → 1.5-3s emerald confirmation flash (overrides tone)
 *   - "error"  → red border + red icon, hover tooltip carries the message
 *   Pass null/undefined when no state is active.
 */
export type ActionIconButtonTone = "success" | "danger" | "muted"
export type ActionIconButtonState = "done" | "error" | null | undefined

const TONE_CLASSES: Record<ActionIconButtonTone, string> = {
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40",
  danger:
    "bg-muted/50 text-muted-foreground hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 border-border hover:border-red-500/40",
  muted:
    "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-border",
}

const STATE_CLASSES: Record<Exclude<ActionIconButtonState, null | undefined>, string> = {
  done:
    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/15",
  error:
    "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/40 hover:bg-red-500/10",
}

export function ActionIconButton({
  tone,
  label,
  onClick,
  icon,
  showLabel = false,
  disabled = false,
  state,
  tooltip,
  className,
}: {
  tone: ActionIconButtonTone
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  icon: React.ReactNode
  showLabel?: boolean
  disabled?: boolean
  state?: ActionIconButtonState
  tooltip?: string
  className?: string
}) {
  const stateCls = state ? STATE_CLASSES[state] : null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip ?? label}
      aria-label={label}
      className={cn(
        "h-9 inline-flex items-center justify-center rounded-md border transition-colors shrink-0",
        showLabel
          ? "gap-1.5 px-2.5 text-xs font-medium"
          : "w-9",
        stateCls ?? TONE_CLASSES[tone],
        disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        className,
      )}
    >
      {icon}
      {showLabel && <span className="truncate">{label}</span>}
    </button>
  )
}
