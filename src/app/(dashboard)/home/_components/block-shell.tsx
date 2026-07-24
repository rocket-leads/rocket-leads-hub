import Link from "next/link"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"

/**
 * Shared shell for the home dashboard sections, styled to the 187N
 * `.section-card`: mono uppercase `.section-title` with an inline count, a
 * `.ghost-link` "open" affordance on the right, then the block body. If a
 * block has zero items it shows a single muted line rather than a big empty
 * state so the grid doesn't collapse.
 */
export function BlockShell({
  title,
  icon,
  count,
  footerHref,
  footerLabel,
  empty,
  emptyMessage,
  emptyContent,
  children,
}: {
  title: string
  icon: ReactNode
  count: number
  footerHref: string
  footerLabel: string
  empty?: boolean
  /** Plain text empty state - used when no `emptyContent` slot is provided. */
  emptyMessage?: string
  /** Override the entire empty body when a block wants something richer. */
  emptyContent?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="section-card flex flex-col">
      <div className="section-head">
        <div className="section-title">
          {icon}
          {title}
          {count > 0 && <span className="count">{count}</span>}
        </div>
        <Link href={footerHref} className="ghost-link inline-flex items-center gap-1.5">
          {footerLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="flex-1 min-h-[180px]">
        {empty ? (
          emptyContent ?? (
            <div className="flex items-center justify-center h-full px-4 py-8">
              <p className="text-sm text-muted-foreground/60 italic">{emptyMessage ?? "-"}</p>
            </div>
          )
        ) : (
          children
        )}
      </div>
    </div>
  )
}
