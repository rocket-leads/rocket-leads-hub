import Link from "next/link"
import { ArrowRight } from "lucide-react"
import type { ReactNode } from "react"

/**
 * Shared shell for the home dashboard sections. Keeps the four blocks visually
 * aligned: same header height, same divider rules, same footer link styling. If
 * a block has zero items it shows a single muted line rather than a big empty
 * state — keeps the layout from collapsing.
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
  /** Plain text empty state — used when no `emptyContent` slot is provided. */
  emptyMessage?: string
  /** Override the entire empty body when a block wants something richer than a
   *  one-liner (e.g. an icon + rotating motivational line on Inbox Zero). */
  emptyContent?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-card rounded-lg border border-border/40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-sm font-medium">{title}</h2>
          {count > 0 && (
            <span className="text-xs text-muted-foreground/50 tabular-nums">{count}</span>
          )}
        </div>
        <Link
          href={footerHref}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          {footerLabel}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex-1 min-h-[180px]">
        {empty ? (
          emptyContent ?? (
            <div className="flex items-center justify-center h-full px-4 py-8">
              <p className="text-xs text-muted-foreground/40 italic">{emptyMessage ?? "Niks om te tonen."}</p>
            </div>
          )
        ) : (
          children
        )}
      </div>
    </div>
  )
}
