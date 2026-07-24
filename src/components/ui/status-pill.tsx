import { cn } from "@/lib/utils"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand"

// Map the semantic tone to the 187N `.st-label` classes (globals.css): a bare
// coloured dot + mono uppercase label, NO fill - the campaign-performance
// "● LIVE" status treatment.
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "idle",
  success: "live",
  warning: "warn",
  danger: "error",
  info: "pending",
  brand: "brand",
}

type Props = {
  tone?: StatusTone
  /** Drop the coloured dot - useful when the label already carries an icon. */
  noDot?: boolean
  className?: string
  children: React.ReactNode
}

/**
 * Hub status label - single source of truth so Live, Onboarding, Paid, Action
 * Needed, etc. all read with identical chrome. Renders as the 187N `.st-label`
 * (dot + mono uppercase), matching the status dots on the Clients table.
 */
export function StatusPill({ tone = "neutral", noDot, className, children }: Props) {
  return (
    <span className={cn("st-label", TONE_CLASS[tone], className)}>
      {!noDot && <span className="sd" />}
      {children}
    </span>
  )
}
