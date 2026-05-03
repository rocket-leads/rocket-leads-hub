"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"
import { AgreementSection } from "./agreement-section"

type Props = {
  mondayItemId: string
  stripeCustomerId: string | null
}

const STATUS_CONFIG: Record<
  InvoiceRow["status"],
  { label: string; className: string; icon: string }
> = {
  paid: { label: "Paid", className: "bg-green-500/20 text-green-400 border-green-500/30", icon: "✓" },
  open: { label: "Open", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: "○" },
  overdue: { label: "Overdue", className: "bg-red-500/20 text-red-400 border-red-500/30", icon: "!" },
  void: { label: "Void", className: "bg-muted text-muted-foreground", icon: "—" },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground", icon: "~" },
}

function fmt(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function InvoicesHeader({ sub }: { sub?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground/80">Invoices</h3>
      <p className="text-[11px] text-muted-foreground/60 mt-0.5">
        {sub ?? "What this client has actually been billed via Stripe."}
      </p>
    </div>
  )
}

function SummaryCard({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

export function BillingTab({ mondayItemId, stripeCustomerId }: Props) {
  return (
    <div className="space-y-6">
      <AgreementSection mondayItemId={mondayItemId} />
      <InvoicesSection mondayItemId={mondayItemId} stripeCustomerId={stripeCustomerId} />
    </div>
  )
}

function InvoicesSection({ mondayItemId, stripeCustomerId }: Props) {
  const query = useQuery<BillingData>({
    queryKey: ["billing", mondayItemId],
    queryFn: async () => {
      const p = new URLSearchParams()
      if (stripeCustomerId) p.set("stripeCustomerId", stripeCustomerId)
      const r = await fetch(`/api/clients/${mondayItemId}/billing?${p}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load billing data")
      return data
    },
    enabled: !!stripeCustomerId,
  })

  if (!stripeCustomerId) {
    return (
      <div className="space-y-3">
        <InvoicesHeader />
        <div className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
          No Stripe Customer ID linked in Monday.com for this client.
        </div>
      </div>
    )
  }

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <InvoicesHeader />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-3">
        <InvoicesHeader />
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to load billing data."}
          </CardContent>
        </Card>
      </div>
    )
  }

  const { invoices, totalInvoiced, totalPaid, totalOutstanding, avgPaymentDays, customerName, customerEmail } = query.data

  return (
    <div className="space-y-4">
      <InvoicesHeader sub={customerName ? `${customerName}${customerEmail ? ` · ${customerEmail}` : ""}` : undefined} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title="Total invoiced" value={fmt(totalInvoiced)} />
        <SummaryCard title="Total paid" value={fmt(totalPaid)} />
        <SummaryCard
          title="Outstanding"
          value={fmt(totalOutstanding)}
          sub={totalOutstanding > 0 ? "Action required" : undefined}
        />
        <SummaryCard
          title="Avg. payment time"
          value={avgPaymentDays !== null ? `${avgPaymentDays} days` : "—"}
          sub="From invoice to payment"
        />
      </div>

      {/* Invoice table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px]">PDF</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No invoices found
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => {
                const cfg = STATUS_CONFIG[inv.status]
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number ?? inv.id}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(inv.created * 1000).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.dueDate
                        ? new Date(inv.dueDate * 1000).toLocaleDateString("en-GB")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{fmt(inv.amountDue)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cfg.className}>
                        {cfg.icon} {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {inv.invoicePdf ? (
                        <a
                          href={inv.invoicePdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          PDF
                        </a>
                      ) : inv.hostedUrl ? (
                        <a
                          href={inv.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
