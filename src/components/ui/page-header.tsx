import { cn } from "@/lib/utils"

type Props = {
  /** Big page title (187N display face). Required - every page has one. */
  title: React.ReactNode
  /** Optional one-line subtitle under the title, muted weight. */
  subtitle?: React.ReactNode
  /** Right-aligned actions row - buttons, filters, refresh, etc. */
  actions?: React.ReactNode
  className?: string
}

/**
 * Hub page header, styled to the 187N `.page-header`: large Schibsted display
 * title (clamped 28-40px, tight tracking) + muted subtitle, actions pinned to
 * the right. Title typography lives in theme.css so weight/scale dial in one
 * place.
 */
export function PageHeader({ title, subtitle, actions, className }: Props) {
  return (
    <div className={cn("page-header", className)}>
      <div className="min-w-0">
        <h1>{title}</h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
