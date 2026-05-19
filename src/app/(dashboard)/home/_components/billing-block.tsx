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

export function BillingBlock({
  items,
  totalCount,
  totalOutstanding,
  locale,
}: {
  items: BillingRow[]
  totalCount: number
  totalOutstanding: number
  locale: Locale
}) {
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
      <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">{t("home.block.billing.total_open", locale)}</span>
        <span className="text-sm font-mono tabular-nums text-amber-400">{formatCurrency(totalOutstanding, locale)}</span>
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
