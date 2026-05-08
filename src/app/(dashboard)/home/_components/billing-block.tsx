import Link from "next/link"
import { Receipt, ArrowRight } from "lucide-react"
import { BlockShell } from "./block-shell"

type BillingRow = {
  mondayItemId: string
  name: string
  outstanding: number
  status: "complete" | "open" | "overdue"
}

function fmtEuro(v: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v)
}

export function BillingBlock({
  items,
  totalCount,
  totalOutstanding,
}: {
  items: BillingRow[]
  totalCount: number
  totalOutstanding: number
}) {
  return (
    <BlockShell
      title="Open invoices"
      icon={<Receipt className="h-4 w-4 text-amber-400" />}
      count={totalCount}
      footerHref="/billing"
      footerLabel="Open Billing"
      empty={items.length === 0}
      emptyMessage="Geen openstaande facturen."
    >
      <div className="px-4 py-2.5 border-b border-border/30 flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground/60 uppercase tracking-wider">Total open</span>
        <span className="text-sm font-mono tabular-nums text-amber-400">{fmtEuro(totalOutstanding)}</span>
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
                {fmtEuro(item.outstanding)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
            </Link>
          </li>
        ))}
      </ul>
    </BlockShell>
  )
}
