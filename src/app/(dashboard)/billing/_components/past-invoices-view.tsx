"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ExternalLink, ArrowUpDown, ArrowUp, ArrowDown, Copy, Check } from "lucide-react"
import { subDays } from "date-fns"
import { cn } from "@/lib/utils"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Panel } from "@/components/ui/panel"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { DateRangePicker } from "@/app/(dashboard)/targets/_components/date-range-picker"
import { useDateRange } from "@/app/(dashboard)/targets/_hooks/use-date-range"
import type { PastInvoiceRow } from "./billing-tabs"
import { InvoiceActionMenu } from "./invoice-action-menu"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"

type StatusFilter = "all" | "paid" | "open" | "overdue" | "void"
type SortKey = "date" | "client" | "amount" | "status" | "number"
type SortDir = "asc" | "desc"

// 187N status tones (bare .st-label dot + mono uppercase, no fill).
// Label is localized at render via `STATUS_PILL_KEYS`.
const STATUS_PILL: Record<PastInvoiceRow["status"], { labelKey: DictionaryKeyStr; tone: string }> = {
  paid: { labelKey: "billing.past.status.paid", tone: "live" },
  open: { labelKey: "billing.past.status.open", tone: "warn" },
  overdue: { labelKey: "billing.past.status.overdue", tone: "error" },
  draft: { labelKey: "billing.past.status.draft", tone: "idle" },
  void: { labelKey: "billing.past.status.void", tone: "idle" },
}

type DictionaryKeyStr = Parameters<typeof t>[0]

function fmtEuro(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/**
 * Past-invoices tab. Pulls from the `past_invoices` cache (refreshed hourly +
 * on manual refresh). Lets finance scan + filter what's already gone out:
 *   - Date range (uses the same useDateRange hook as Clients overview, so the
 *     last-picked range survives across pages + presets stay consistent)
 *   - Status: All / Open / Overdue / Paid / Void
 *   - Sortable by date, client, amount, status, invoice number
 *   - Per-row link to PDF + a Stripe-dashboard escape hatch
 */
export function PastInvoicesView({ invoices }: { invoices: PastInvoiceRow[] }) {
  const router = useRouter()
  const locale = useLocale()
  const STATUS_FILTER_TABS: TopTab<StatusFilter>[] = [
    { id: "all", label: t("billing.past.filter.all", locale) },
    { id: "open", label: t("billing.past.filter.open", locale) },
    { id: "overdue", label: t("billing.past.filter.overdue", locale) },
    { id: "paid", label: t("billing.past.filter.paid", locale) },
    { id: "void", label: t("billing.past.filter.void", locale) },
  ]
  const { range, setRange, presets, applyPreset } = useDateRange()
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  // Past invoices are billing data - finance routinely needs to look at today's
  // sends, so unlike campaign metrics we DO want today included.
  const maxDate = new Date()

  const filtered = useMemo(() => {
    const startMs = range.startDate.getTime()
    // Inclusive end-of-day so a same-day range still surfaces invoices created
    // earlier today.
    const endOfDay = new Date(range.endDate)
    endOfDay.setHours(23, 59, 59, 999)
    const endMs = endOfDay.getTime()
    return invoices.filter((inv) => {
      const t = inv.created * 1000
      if (t < startMs || t > endMs) return false
      if (status !== "all" && inv.status !== status) return false
      return true
    })
  }, [invoices, range, status])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === "asc" ? 1 : -1
    list.sort((a, b) => {
      switch (sortKey) {
        case "date":
          return (a.created - b.created) * dir
        case "client": {
          const an = a.clientName ?? "ZZZZ"
          const bn = b.clientName ?? "ZZZZ"
          return an.localeCompare(bn) * dir
        }
        case "amount":
          return (a.amountDue - b.amountDue) * dir
        case "status":
          return a.status.localeCompare(b.status) * dir
        case "number": {
          const an = a.number ?? ""
          const bn = b.number ?? ""
          return an.localeCompare(bn, undefined, { numeric: true }) * dir
        }
      }
    })
    return list
  }, [filtered, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      // Sensible default direction per column - dates newest-first, names a→z.
      setSortDir(key === "date" || key === "amount" ? "desc" : "asc")
    }
  }

  // Headline numbers: total invoiced + total outstanding within the current
  // filter view, so finance sees aggregate impact for whatever they're slicing.
  const totals = useMemo(() => {
    let invoiced = 0
    let outstanding = 0
    let paidCount = 0
    let overdueCount = 0
    for (const inv of filtered) {
      if (inv.status !== "void") invoiced += inv.amountDue
      if (inv.status === "open" || inv.status === "overdue") {
        outstanding += inv.amountDue - inv.amountPaid
      }
      if (inv.status === "paid") paidCount++
      if (inv.status === "overdue") overdueCount++
    }
    return { invoiced, outstanding, paidCount, overdueCount }
  }, [filtered])

  return (
    <div className="space-y-5">
      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label={t("billing.past.stat.invoices_in_view", locale)} value={String(filtered.length)} />
        <Stat label={t("billing.past.stat.total_invoiced", locale)} value={fmtEuro(totals.invoiced)} />
        <Stat
          label={t("billing.past.stat.outstanding", locale)}
          value={fmtEuro(totals.outstanding)}
          tone={totals.overdueCount > 0 ? "red" : totals.outstanding > 0 ? "amber" : undefined}
          hint={totals.overdueCount > 0 ? t("billing.past.stat.outstanding_overdue", locale, { count: totals.overdueCount }) : undefined}
        />
        <Stat label={t("billing.past.stat.paid", locale)} value={String(totals.paidCount)} tone="emerald" />
      </div>

      {/* Filters - same DateRangePicker + preset chips combo as the Clients
          overview, so the filter row reads identically across the Hub. */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
          maxDate={maxDate}
        />
        <div className="flex gap-1 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="h-8 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <TopTabs<StatusFilter> tabs={STATUS_FILTER_TABS} value={status} onChange={setStatus} />

      {/* Table */}
      <Panel className="overflow-hidden">
        {invoices.length === 0 ? (
          // Cache hasn't been populated yet - most likely on a fresh deploy
          // before the hourly cron has fired. Tell the user how to fix it
          // rather than the generic "no matches" line which implies the data
          // exists but doesn't fit the filter.
          <div className="px-5 py-10 text-center text-sm text-muted-foreground space-y-1">
            <p>{t("billing.past.empty_not_loaded_title", locale)}</p>
            <p className="text-xs text-muted-foreground/70">
              {t("billing.past.empty_not_loaded_hint_pre", locale)}
              <span className="font-medium text-foreground/80">{t("billing.past.empty_not_loaded_hint_refresh", locale)}</span>
              {t("billing.past.empty_not_loaded_hint_post", locale)}
            </p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            {t("billing.past.empty_no_match", locale)}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border/40 bg-muted/30 hover:bg-muted/30 [&>th]:h-9">
                <SortableHead label={t("billing.past.col.number", locale)} k="number" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[140px]" />
                <SortableHead label={t("billing.past.col.client", locale)} k="client" current={sortKey} dir={sortDir} onSort={toggleSort} />
                <SortableHead label={t("billing.past.col.date", locale)} k="date" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[130px]" />
                <SortableHead label={t("billing.past.col.amount", locale)} k="amount" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[120px]" />
                <SortableHead label={t("billing.past.col.status", locale)} k="status" current={sortKey} dir={sortDir} onSort={toggleSort} className="w-[120px]" />
                <TableHead className="w-[130px]">{t("billing.past.col.link", locale)}</TableHead>
                <TableHead className="w-[48px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((inv) => {
                const pill = STATUS_PILL[inv.status]
                return (
                  <TableRow key={inv.id} className="border-b border-border/40 row-hover">
                    <TableCell className="py-2.5 font-mono text-xs">
                      {inv.number ?? <span className="text-muted-foreground/60">-</span>}
                    </TableCell>
                    <TableCell className="py-2.5">
                      {inv.clientName ? (
                        inv.clientMondayItemId ? (
                          <Link
                            href={`/clients/${inv.clientMondayItemId}`}
                            className="text-sm font-medium hover:text-primary transition-colors"
                          >
                            {inv.clientName}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium">{inv.clientName}</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground/60 font-mono" title={inv.customerId}>
                          {t("billing.past.unknown_customer", locale, { id: inv.customerId.slice(0, 14) })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-2.5 text-xs tabular-nums">{fmtDate(inv.created)}</TableCell>
                    <TableCell className="py-2.5 text-xs tabular-nums font-medium">
                      {fmtEuro(inv.amountDue)}
                    </TableCell>
                    <TableCell className="py-2.5">
                      <span className={`st-label ${pill.tone}`}>
                        <span className="sd" />
                        {t(pill.labelKey, locale)}
                      </span>
                    </TableCell>
                    <TableCell className="py-2.5">
                      <InvoiceLinkCell hostedUrl={inv.hostedUrl} invoicePdf={inv.invoicePdf} />
                    </TableCell>
                    <TableCell className="py-2.5 text-right">
                      <InvoiceActionMenu
                        invoiceId={inv.id}
                        invoiceNumber={inv.number}
                        status={inv.status}
                        amountDue={inv.amountDue}
                        mondayItemId={inv.clientMondayItemId}
                        onDone={() => router.refresh()}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: "amber" | "red" | "emerald"
}) {
  const valueTone =
    tone === "red"
      ? "text-red-500"
      : tone === "amber"
        ? "text-amber-500"
        : tone === "emerald"
          ? "text-emerald-500"
          : ""
  return (
    <div className="rounded-md border border-border/60 bg-card px-4 py-3">
      <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium">
        {label}
      </p>
      <p className={`text-xl font-semibold mt-0.5 tabular-nums ${valueTone}`}>{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{hint}</p>}
    </div>
  )
}

/**
 * Per-invoice link cell. Primary action copies the Stripe hosted invoice URL
 * (the client-facing, payable invoice page) to the clipboard so the AM can
 * paste it straight into WhatsApp/email. A secondary icon opens that same
 * page in a new tab to preview it. Falls back to the PDF link when Stripe
 * hasn't produced a hosted URL yet (e.g. draft invoices).
 */
function InvoiceLinkCell({
  hostedUrl,
  invoicePdf,
}: {
  hostedUrl: string | null
  invoicePdf: string | null
}) {
  const locale = useLocale()
  const [copied, setCopied] = useState(false)
  const copyTarget = hostedUrl ?? invoicePdf

  if (!copyTarget) {
    return <span className="text-[11px] text-muted-foreground/50">-</span>
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(copyTarget!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked (insecure context / permissions) - open the page
      // so the AM can copy the URL from the address bar instead.
      window.open(copyTarget!, "_blank", "noopener,noreferrer")
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={copy}
        title={t("billing.past.copy_link", locale)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs transition-colors",
          copied
            ? "bg-[var(--st-live)]/12 font-semibold text-[color:var(--st-live)]"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
        )}
      >
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            {t("billing.past.copied", locale)}
          </>
        ) : (
          <>
            <Copy className="h-3 w-3 opacity-60" />
            {t("billing.past.copy_link_label", locale)}
          </>
        )}
      </button>
      {hostedUrl && (
        <a
          href={hostedUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={t("billing.past.open_invoice_page", locale)}
          className="inline-flex items-center text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

function SortableHead({
  label,
  k,
  current,
  dir,
  onSort,
  className,
}: {
  label: string
  k: SortKey
  current: SortKey
  dir: SortDir
  onSort: (k: SortKey) => void
  className?: string
}) {
  const active = current === k
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 uppercase hover:text-foreground transition-colors",
          active ? "text-foreground" : "text-muted-foreground/70",
        )}
      >
        {label}
        <Icon className={cn("h-3 w-3", active ? "opacity-80" : "opacity-40")} />
      </button>
    </TableHead>
  )
}
