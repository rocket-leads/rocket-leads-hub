import { cn } from "@/lib/utils"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand"

const TONES: Record<StatusTone, { dot: string; pill: string }> = {
  neutral: { dot: "bg-muted-foreground/40", pill: "bg-muted/60 text-muted-foreground" },
  success: { dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  warning: { dot: "bg-amber-500", pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  danger:  { dot: "bg-red-500",   pill: "bg-red-500/10 text-red-600 dark:text-red-400" },
  info:    { dot: "bg-blue-500",  pill: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  brand:   { dot: "bg-primary",   pill: "bg-primary/10 text-primary" },
}

type Props = {
  tone?: StatusTone
  /** Set true to drop the colored dot - useful when the pill is already
   *  visually loud (eg. source badges with an icon). */
  noDot?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Hub status pill - single source of truth so Live, Onboarding, Paid, Action
 * Needed, etc. all read with identical chrome. Pages used to roll their own
 * with hand-picked Tailwind classes - drift between surfaces happened
 * because the same status looked subtly different in three places.
 *
 * Height + padding + radius are fixed so a row of pills in a table line up
 * regardless of label length.
 */
export function StatusPill({ tone = "neutral", noDot, className, children }: Props) {
  const t = TONES[tone]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 h-[22px] text-[11px] font-medium whitespace-nowrap",
        t.pill,
        className,
      )}
    >
      {!noDot && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.dot)} />}
      {children}
    </span>
  )
}
