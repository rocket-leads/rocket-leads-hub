"use client"

import { cn } from "@/lib/utils"

/**
 * Single source of truth for the per-row action icon-buttons. Extracted
 * from the inbox-list-row so any surface that shows actionable rows
 * (inbox tasks, co-pilot notification bell drafts, watchlist row actions
 * in future) renders identical chrome. Roy 2026-05-22: "dit moet allemaal
 * overal 1 op 1 aligned zijn."
 *
 * Three tones:
 *   - success → primary "approve / done" action (emerald)
 *   - danger  → "delete / dismiss" — muted by default, red on hover
 *   - muted   → neutral secondary (snooze, reassign, edit)
 *
 * Always 36×36, single icon centred, no label inside (label goes to title
 * + aria-label). Tooltip-via-title gives the hover hint without bloating
 * the row.
 */
export type ActionIconButtonTone = "success" | "danger" | "muted"

const TONE_CLASSES: Record<ActionIconButtonTone, string> = {
  success:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-700 dark:hover:text-emerald-300 border-emerald-500/20 hover:border-emerald-500/40",
  danger:
    "bg-muted/50 text-muted-foreground hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 border-border hover:border-red-500/40",
  muted:
    "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border-border",
}

export function ActionIconButton({
  tone,
  label,
  onClick,
  icon,
  className,
}: {
  tone: ActionIconButtonTone
  label: string
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  icon: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-9 w-9 inline-flex items-center justify-center rounded-md border transition-colors shrink-0",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {icon}
    </button>
  )
}
