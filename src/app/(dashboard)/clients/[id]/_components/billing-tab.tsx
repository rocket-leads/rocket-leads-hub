"use client"

import Image from "next/image"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CalendarClock, Check, ExternalLink, Loader2, Receipt, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"
import { AgreementSection } from "./agreement-section"
import { BillingSectionShell } from "./billing-section-shell"

type Props = {
  mondayItemId: string
  stripeCustomerId: string | null
  initialNextInvoiceDate?: string | null
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

function StripeLinkButton({ stripeCustomerId }: { stripeCustomerId: string }) {
  return (
    <a
      href={`https://dashboard.stripe.com/customers/${stripeCustomerId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-foreground/80")}
    >
      <Image
        src="/logos/brands/stripe.svg"
        alt=""
        width={14}
        height={14}
        className="h-4 w-4 object-contain"
        unoptimized
      />
      Stripe
      <ExternalLink className="h-3.5 w-3.5 opacity-50" />
    </a>
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

export function BillingTab({ mondayItemId, stripeCustomerId, initialNextInvoiceDate }: Props) {
  return (
    <div className="space-y-6">
      <NextInvoiceDateSection
        mondayItemId={mondayItemId}
        initialDate={initialNextInvoiceDate ?? null}
      />
      <InvoicesSection mondayItemId={mondayItemId} stripeCustomerId={stripeCustomerId} />
      <AgreementSection mondayItemId={mondayItemId} />
    </div>
  )
}

/**
 * Editable next-invoice-date for this client. Bidi-syncs with Monday's `date3`
 * column via the existing /api/clients/[id] PATCH path. The daily inbox-task
 * cron picks up whichever date is set here and creates a "send invoice" task
 * for the finance user when it arrives.
 */
function NextInvoiceDateSection({
  mondayItemId,
  initialDate,
}: {
  mondayItemId: string
  initialDate: string | null
}) {
  const [date, setDate] = useState<string>(initialDate ?? "")
  const [savedDate, setSavedDate] = useState<string>(initialDate ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDirty = date !== savedDate
  const showSaved = !isDirty && !!savedDate

  async function persist(value: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "next_invoice_date", value }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to save")
      setSavedDate(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
      // Roll the input back to the last known-good value so we don't pretend
      // the change landed.
      setDate(savedDate)
    } finally {
      setSaving(false)
    }
  }

  return (
    <BillingSectionShell
      icon={CalendarClock}
      title="Next invoice"
      subtitle="When the next invoice should go out. A task lands in finance's inbox automatically on this date."
    >
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          disabled={saving}
          className="h-9 px-3 rounded-md border border-border bg-background text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        {isDirty && (
          <button
            type="button"
            onClick={() => persist(date)}
            disabled={saving}
            className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </button>
        )}
        {savedDate && (
          <button
            type="button"
            onClick={() => {
              setDate("")
              persist("")
            }}
            disabled={saving}
            className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "gap-1.5 text-muted-foreground")}
            title="Clear next invoice date"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
        {showSaved && !saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
            <Check className="h-3 w-3" />
            Saved
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </BillingSectionShell>
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

  const data = query.data
  const subtitle = data?.customerName
    ? `${data.customerName}${data.customerEmail ? ` · ${data.customerEmail}` : ""}`
    : "What this client has actually been billed via Stripe."

  const actions = stripeCustomerId ? <StripeLinkButton stripeCustomerId={stripeCustomerId} /> : null

  if (!stripeCustomerId) {
    return (
      <BillingSectionShell icon={Receipt} title="Invoices" subtitle="What this client has actually been billed via Stripe.">
        <div className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
          No Stripe Customer ID linked in Monday.com for this client.
        </div>
      </BillingSectionShell>
    )
  }

  if (query.isLoading) {
    return (
      <BillingSectionShell icon={Receipt} title="Invoices" subtitle={subtitle} actions={actions}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </BillingSectionShell>
    )
  }

  if (query.isError || !data) {
    return (
      <BillingSectionShell icon={Receipt} title="Invoices" subtitle={subtitle} actions={actions}>
        <div className="py-6 text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load billing data."}
        </div>
      </BillingSectionShell>
    )
  }

  const { invoices, totalInvoiced, totalPaid, totalOutstanding, avgPaymentDays } = data

  return (
    <BillingSectionShell icon={Receipt} title="Invoices" subtitle={subtitle} actions={actions}>
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
    </BillingSectionShell>
  )
}
