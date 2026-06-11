import Link from "next/link"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"

/**
 * Shared shell for the home dashboard sections. Keeps the four blocks visually
 * aligned: same header height, same divider rules, same footer button styling.
 * If a block has zero items it shows a single muted line rather than a big
 * empty state - keeps the layout from collapsing.
 *
 * Footer "Open X →" used to be a faded text link (text-[11px] muted/60) which
 * Roy flagged as ambiguous - "I don't know where to click". Now it's a real
 * secondary-style button so the affordance is unambiguous.
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
  /** Override the entire empty body when a block wants something richer than a
   *  one-liner (e.g. an icon + rotating motivational line on Inbox Zero). */
  emptyContent?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          {icon}
          <h2 className="text-base font-semibold leading-none">{title}</h2>
          {count > 0 && (
            <span className="text-sm text-muted-foreground/70 tabular-nums">{count}</span>
          )}
        </div>
        <Link
          href={footerHref}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border/70 bg-card text-xs font-medium text-foreground/80 hover:bg-muted/60 hover:text-foreground transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
        >
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
