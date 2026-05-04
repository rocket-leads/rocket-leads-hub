"use client"

import Link from "next/link"
import Image from "next/image"
import { ExternalLink } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Panel } from "@/components/ui/panel"

export type UpcomingInvoice = {
  mondayItemId: string
  name: string
  nextInvoiceDate: string
  stripeCustomerId: string | null
  mrr: number
  adBudget: number
}

type Group = {
  key: "overdue" | "today" | "this_week" | "next_week" | "later"
  label: string
  hint: string
  tone: string
  rows: UpcomingInvoice[]
}

function fmtEuro(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

/**
 * Bucket each row into a time-window group so finance sees what needs action
 * today vs what's just on the radar. Pure date math against the user's local
 * "today" — server tz drift won't bump rows into the wrong bucket because we
 * compute everything from `new Date()` on the client.
 */
function groupRows(rows: UpcomingInvoice[]): Group[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayMs = today.getTime()
  const dayMs = 24 * 60 * 60 * 1000

  // "This week" = up to (and including) the coming Sunday — what most people
  // mean when they say "deze week". "Next week" = the seven days after that.
  const dayOfWeek = today.getDay() // 0 = Sun
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
  const endOfThisWeek = todayMs + daysUntilSunday * dayMs
  const endOfNextWeek = endOfThisWeek + 7 * dayMs

  const buckets: Record<Group["key"], UpcomingInvoice[]> = {
    overdue: [],
    today: [],
    this_week: [],
    next_week: [],
    later: [],
  }

  for (const row of rows) {
    const d = new Date(row.nextInvoiceDate)
    d.setHours(0, 0, 0, 0)
    const ms = d.getTime()
    if (ms < todayMs) buckets.overdue.push(row)
    else if (ms === todayMs) buckets.today.push(row)
    else if (ms <= endOfThisWeek) buckets.this_week.push(row)
    else if (ms <= endOfNextWeek) buckets.next_week.push(row)
    else buckets.later.push(row)
  }

  const all: Group[] = [
    { key: "overdue", label: "Overdue", hint: "Past their next-invoice date", tone: "text-red-500", rows: buckets.overdue },
    { key: "today", label: "Today", hint: "Send today", tone: "text-amber-500", rows: buckets.today },
    { key: "this_week", label: "This week", hint: "Through Sunday", tone: "text-foreground", rows: buckets.this_week },
    { key: "next_week", label: "Next week", hint: "On the radar", tone: "text-muted-foreground", rows: buckets.next_week },
    { key: "later", label: "Later", hint: "More than two weeks out", tone: "text-muted-foreground/70", rows: buckets.later },
  ]
  return all.filter((g) => g.rows.length > 0)
}

export function BillingOverview({ rows }: { rows: UpcomingInvoice[] }) {
  const groups = groupRows(rows)

  if (groups.length === 0) {
    return (
      <Panel className="p-8">
        <div className="text-center text-sm text-muted-foreground">
          <p>No upcoming invoices scheduled.</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Set a next-invoice date on a client&apos;s Billing tab to see it here.
          </p>
        </div>
      </Panel>
    )
  }

  // Headline numbers across the whole page so finance has a one-glance summary.
  const totalMrr = rows.reduce((s, r) => s + r.mrr, 0)
  const dueThisWeek = groups
    .filter((g) => g.key === "overdue" || g.key === "today" || g.key === "this_week")
    .reduce((s, g) => s + g.rows.length, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryStat label="Scheduled clients" value={String(rows.length)} />
        <SummaryStat label="Due this week" value={String(dueThisWeek)} tone={dueThisWeek > 0 ? "amber" : undefined} />
        <SummaryStat label="Total MRR" value={fmtEuro(totalMrr)} />
        <SummaryStat
          label="This-month run rate"
          value={fmtEuro(totalMrr)}
          hint="Sum of MRR across all scheduled clients"
        />
      </div>

      {groups.map((group) => (
        <Panel key={group.key} className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-baseline justify-between border-b border-border/40">
            <div>
              <h2 className={`text-sm font-semibold ${group.tone}`}>{group.label}</h2>
              <p className="text-[11px] text-muted-foreground/60">{group.hint}</p>
            </div>
            <span className="text-[11px] text-muted-foreground/60 tabular-nums">
              {group.rows.length} {group.rows.length === 1 ? "client" : "clients"}
            </span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/40 bg-muted/30 hover:bg-muted/30 [&>th]:h-9">
                <TableHead className="text-[12px] text-foreground/80 font-semibold">Client</TableHead>
                <TableHead className="text-[12px] text-foreground/80 font-semibold w-[140px]">Next invoice</TableHead>
                <TableHead className="text-[12px] text-foreground/80 font-semibold w-[100px]">MRR</TableHead>
                <TableHead className="text-[12px] text-foreground/80 font-semibold w-[110px]">Ad budget</TableHead>
                <TableHead className="text-[12px] text-foreground/80 font-semibold w-[120px]">Stripe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.rows.map((row) => (
                <TableRow
                  key={row.mondayItemId}
                  className="border-b border-border/40 row-hover"
                >
                  <TableCell className="py-2.5">
                    <Link
                      href={`/clients/${row.mondayItemId}`}
                      className="text-sm font-medium hover:text-primary transition-colors"
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="py-2.5 text-xs tabular-nums">
                    {fmtDate(row.nextInvoiceDate)}
                  </TableCell>
                  <TableCell className="py-2.5 text-xs tabular-nums font-medium">
                    {row.mrr > 0 ? fmtEuro(row.mrr) : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="py-2.5 text-xs tabular-nums text-muted-foreground">
                    {row.adBudget > 0 ? fmtEuro(row.adBudget) : <span className="text-muted-foreground/40">—</span>}
                  </TableCell>
                  <TableCell className="py-2.5">
                    {row.stripeCustomerId ? (
                      <a
                        href={`https://dashboard.stripe.com/customers/${row.stripeCustomerId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <Image
                          src="/logos/brands/stripe.svg"
                          alt=""
                          width={12}
                          height={12}
                          className="h-3 w-3 object-contain"
                          unoptimized
                        />
                        Open
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </a>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50">No Stripe</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ))}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "amber"
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${tone === "amber" ? "text-amber-500" : ""}`}>
        {value}
      </p>
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</p>}
    </div>
  )
}
