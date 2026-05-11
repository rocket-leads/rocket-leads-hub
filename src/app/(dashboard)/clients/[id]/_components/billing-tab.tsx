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
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { BillingData, InvoiceRow } from "@/lib/integrations/stripe"
import { AgreementSection } from "./agreement-section"
import { BillingSectionShell } from "./billing-section-shell"

type Props = {
  mondayItemId: string
  stripeCustomerId: string | null
  initialNextInvoiceDate?: string | null
}

/** Invoice status pill — label flips via dictionary, class + icon stay
 *  constant since the visual treatment is independent of language. */
const STATUS_CONFIG: Record<
  InvoiceRow["status"],
  { labelKey: DictionaryKey; className: string; icon: string }
> = {
  paid: { labelKey: "client.billing.status.paid", className: "bg-green-500/20 text-green-400 border-green-500/30", icon: "✓" },
  open: { labelKey: "client.billing.status.open", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: "○" },
  overdue: { labelKey: "client.billing.status.overdue", className: "bg-red-500/20 text-red-400 border-red-500/30", icon: "!" },
  void: { labelKey: "client.billing.status.void", className: "bg-muted text-muted-foreground", icon: "—" },
  draft: { labelKey: "client.billing.status.draft", className: "bg-muted text-muted-foreground", icon: "~" },
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
  const locale = useLocale()
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
      if (!res.ok) throw new Error(json.error ?? t("client.billing.error.save_failed", locale))
      setSavedDate(value)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("client.billing.error.save_failed", locale))
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
      title={t("client.billing.next_invoice.title", locale)}
      subtitle={t("client.billing.next_invoice.subtitle", locale)}
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
            {t("client.billing.action.save", locale)}
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
            title={t("client.billing.action.clear_title", locale)}
          >
            <X className="h-3.5 w-3.5" />
            {t("client.billing.action.clear", locale)}
          </button>
        )}
        {showSaved && !saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-500">
            <Check className="h-3 w-3" />
            {t("client.billing.action.saved", locale)}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
    </BillingSectionShell>
  )
}

function InvoicesSection({ mondayItemId, stripeCustomerId }: Props) {
  const locale = useLocale()
  const query = useQuery<BillingData>({
    queryKey: ["billing", mondayItemId],
    queryFn: async () => {
      const p = new URLSearchParams()
      if (stripeCustomerId) p.set("stripeCustomerId", stripeCustomerId)
      const r = await fetch(`/api/clients/${mondayItemId}/billing?${p}`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? t("client.billing.invoices.load_failed", locale))
      return data
    },
    enabled: !!stripeCustomerId,
  })

  const data = query.data
  // Customer name + email (when available) acts as the subtitle. Fallback to
  // the generic "what this client got billed" line — no need to translate the
  // identity string itself.
  const subtitle = data?.customerName
    ? `${data.customerName}${data.customerEmail ? ` · ${data.customerEmail}` : ""}`
    : t("client.billing.invoices.subtitle_fallback", locale)

  const actions = stripeCustomerId ? <StripeLinkButton stripeCustomerId={stripeCustomerId} /> : null

  if (!stripeCustomerId) {
    return (
      <BillingSectionShell icon={Receipt} title={t("client.billing.invoices.title", locale)} subtitle={t("client.billing.invoices.subtitle_fallback", locale)}>
        <div className="rounded-md border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
          {t("client.billing.invoices.no_stripe_id", locale)}
        </div>
      </BillingSectionShell>
    )
  }

  if (query.isLoading) {
    return (
      <BillingSectionShell icon={Receipt} title={t("client.billing.invoices.title", locale)} subtitle={subtitle} actions={actions}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
      </BillingSectionShell>
    )
  }

  if (query.isError || !data) {
    return (
      <BillingSectionShell icon={Receipt} title={t("client.billing.invoices.title", locale)} subtitle={subtitle} actions={actions}>
        <div className="py-6 text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : t("client.billing.invoices.load_failed", locale)}
        </div>
      </BillingSectionShell>
    )
  }

  const { invoices, totalInvoiced, totalPaid, totalOutstanding, avgPaymentDays } = data
  const dateLocale = locale === "nl" ? "nl-NL" : "en-GB"

  return (
    <BillingSectionShell icon={Receipt} title={t("client.billing.invoices.title", locale)} subtitle={subtitle} actions={actions}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard title={t("client.billing.summary.invoiced", locale)} value={fmt(totalInvoiced)} />
        <SummaryCard title={t("client.billing.summary.paid", locale)} value={fmt(totalPaid)} />
        <SummaryCard
          title={t("client.billing.summary.outstanding", locale)}
          value={fmt(totalOutstanding)}
          sub={totalOutstanding > 0 ? t("client.billing.summary.outstanding.sub", locale) : undefined}
        />
        <SummaryCard
          title={t("client.billing.summary.avg_days", locale)}
          value={avgPaymentDays !== null ? t("client.billing.summary.days", locale, { n: String(avgPaymentDays) }) : "—"}
          sub={t("client.billing.summary.avg_days.sub", locale)}
        />
      </div>

      {/* Invoice table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("client.billing.col.invoice", locale)}</TableHead>
              <TableHead>{t("client.billing.col.date", locale)}</TableHead>
              <TableHead>{t("client.billing.col.due_date", locale)}</TableHead>
              <TableHead>{t("client.billing.col.amount", locale)}</TableHead>
              <TableHead>{t("client.billing.col.status", locale)}</TableHead>
              <TableHead className="w-[80px]">{t("client.billing.col.pdf", locale)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  {t("client.billing.empty.no_invoices", locale)}
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((inv) => {
                const cfg = STATUS_CONFIG[inv.status]
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-sm">{inv.number ?? inv.id}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(inv.created * 1000).toLocaleDateString(dateLocale)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.dueDate
                        ? new Date(inv.dueDate * 1000).toLocaleDateString(dateLocale)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{fmt(inv.amountDue)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cfg.className}>
                        {cfg.icon} {t(cfg.labelKey, locale)}
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
                          {t("client.billing.link.view", locale)}
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
