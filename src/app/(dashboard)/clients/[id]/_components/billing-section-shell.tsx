import type { LucideIcon } from "lucide-react"

type Props = {
  icon: LucideIcon
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children: React.ReactNode
}

/**
 * Outer card used for both sections inside the Billing tab (Invoices and
 * Agreement). The icon + title + subtitle in a divider-bordered header makes
 * the two sections visually distinct sub-pages within the tab.
 */
export function BillingSectionShell({ icon: Icon, title, subtitle, actions, children }: Props) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground leading-tight">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-tight">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </section>
  )
}
