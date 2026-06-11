import { cn } from "@/lib/utils"

type Props = {
  /** Big page title (uses brand font Clash). Required - every page has one. */
  title: React.ReactNode
  /** Optional one-line subtitle directly under the title, muted weight. */
  subtitle?: React.ReactNode
  /** Right-aligned actions row - buttons, filters, refresh, etc. */
  actions?: React.ReactNode
  className?: string
}

/**
 * Hub page header - the standard "title + subtitle + actions" pattern at the
 * top of every dashboard page. Replaces the ad-hoc `<h1 className="text-[22px]">`
 * + custom-flex blocks scattered across pages so every surface opens with the
 * same visual rhythm.
 *
 * Title typography is set once here (font-heading, 24px, tight tracking) - if
 * we ever want to dial the weight, it lands in one place.
 */
export function PageHeader({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn("flex items-end justify-between gap-4 mb-6", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-[24px] font-semibold tracking-tight leading-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
