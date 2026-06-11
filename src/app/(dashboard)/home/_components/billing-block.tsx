import Link from "next/link"
import { CreditCard, ArrowRight } from "lucide-react"
import { BlockShell } from "./block-shell"
import { t } from "@/lib/i18n/t"
import { formatCurrency } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"

type BillingRow = {
  mondayItemId: string
  name: string
  outstanding: number
  status: "complete" | "open" | "overdue"
}

function fmtCompact(v: number, locale: Locale): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`
  return formatCurrency(v, locale)
}

export function BillingBlock({
  items,
  totalCount,
  totalOutstanding,
  teamMrr,
  teamMrrClientCount,
  locale,
}: {
  items: BillingRow[]
  totalCount: number
  totalOutstanding: number
  /** Sum of monthly agreement value across this user's visible clients
   *  whose cycle_start_date falls in the current calendar month. */
  teamMrr: number
  /** Count of those clients with non-zero MRR - drives the "X live
   *  agreements" subtitle. */
  teamMrrClientCount: number
  locale: Locale
}) {
  const mrrSubtitle = teamMrrClientCount === 0
    ? t("home.kpi.mrr.no_agreements", locale)
    : t(
        teamMrrClientCount === 1 ? "home.kpi.mrr.live_one" : "home.kpi.mrr.live_many",
        locale,
        { n: teamMrrClientCount },
      )

  return (
    <BlockShell
      title={t("home.block.billing.title", locale)}
      icon={<CreditCard className="h-4 w-4 text-amber-400" />}
      count={totalCount}
      footerHref="/billing"
      footerLabel={t("home.block.billing.cta", locale)}
      empty={items.length === 0}
      emptyMessage={t("home.block.billing.empty", locale)}
    >
      <div className="px-5 py-3 border-b border-border/30 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            {t("home.kpi.mrr.label", locale)}
          </p>
          <p className="text-base font-mono tabular-nums text-foreground mt-0.5">
            {fmtCompact(teamMrr, locale)}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">{mrrSubtitle}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            {t("home.block.billing.total_open", locale)}
          </p>
          <p className="text-base font-mono tabular-nums text-amber-400 mt-0.5">
            {formatCurrency(totalOutstanding, locale)}
          </p>
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {totalCount === 0
              ? t("home.block.billing.empty", locale)
              : t("home.block.billing.cta", locale)}
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border/30">
        {items.map((item) => (
          <li key={item.mondayItemId}>
            <Link
              href={`/clients/${item.mondayItemId}?tab=billing`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
            >
              <span
                className={
                  "mt-0 inline-block h-1.5 w-1.5 rounded-full shrink-0 " +
                  (item.status === "overdue" ? "bg-red-500" : "bg-amber-400")
                }
              />
              <p className="text-sm font-medium truncate flex-1">{item.name}</p>
              <span
                className={
                  "text-sm font-mono tabular-nums shrink-0 " +
                  (item.status === "overdue" ? "text-red-400" : "text-muted-foreground")
                }
              >
                {formatCurrency(item.outstanding, locale)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
            </Link>
          </li>
        ))}
      </ul>
    </BlockShell>
  )
}
