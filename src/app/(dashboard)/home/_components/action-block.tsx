import Link from "next/link"
import { AlertCircle, ArrowRight, Sparkles } from "lucide-react"
import { BlockShell } from "./block-shell"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"

type ActionItem = {
  mondayItemId: string
  name: string
  insight: string
  aiNote: string | null
  isNewToday: boolean
  spend: number
  leads: number
  cpl: number
}

function fmtSpend(v: number): string {
  if (v <= 0) return "—"
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`
  return `€${v.toFixed(0)}`
}

export function ActionBlock({
  items,
  totalCount,
  locale,
}: {
  items: ActionItem[]
  totalCount: number
  locale: Locale
}) {
  return (
    <BlockShell
      title={t("home.block.action.title", locale)}
      icon={<AlertCircle className="h-4 w-4 text-red-500" />}
      count={totalCount}
      footerHref="/watchlist"
      footerLabel={t("home.block.action.cta", locale)}
      empty={items.length === 0}
      emptyMessage={t("home.block.action.empty", locale)}
    >
      <ul className="divide-y divide-border/30">
        {items.map((item) => (
          <li key={item.mondayItemId}>
            <Link
              href={`/watchlist?client=${item.mondayItemId}`}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{item.name}</p>
                  {item.isNewToday && (
                    <span className="inline-flex items-center rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400">
                      NEW
                    </span>
                  )}
                </div>
                <p className="text-xs text-red-400 leading-snug mt-0.5 line-clamp-1">{item.insight}</p>
                {item.aiNote && (
                  <p className="text-xs text-muted-foreground/80 leading-snug mt-1 line-clamp-2 flex items-start gap-1">
                    <Sparkles className="h-2.5 w-2.5 text-violet-400 shrink-0 mt-[3px]" />
                    <span>{item.aiNote}</span>
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs tabular-nums text-muted-foreground/80">
                  {fmtSpend(item.spend)} · {item.leads} leads
                </p>
                {item.cpl > 0 && (
                  <p className="text-[11px] tabular-nums text-muted-foreground/60 mt-0.5">
                    €{item.cpl.toFixed(2)} CPL
                  </p>
                )}
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors mt-1" />
            </Link>
          </li>
        ))}
      </ul>
    </BlockShell>
  )
}
