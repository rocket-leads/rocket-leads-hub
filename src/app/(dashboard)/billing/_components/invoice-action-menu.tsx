"use client"

import { useState } from "react"
import {
  MoreHorizontal,
  Bell,
  Banknote,
  Ban,
  FileMinus2,
  FileX2,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"

/** Hub-side invoice status (mirrors stripe.ts InvoiceRow["status"]). */
export type InvoiceStatus = "paid" | "open" | "overdue" | "void" | "draft"

type ApiAction = "resend" | "pay_offline" | "void" | "uncollectible" | "credit_note"

type Props = {
  invoiceId: string
  invoiceNumber: string | null
  status: InvoiceStatus
  amountDue: number
  /** Client Monday item id - passed through for audit + cache refresh. */
  mondayItemId?: string | null
  /** Called after any successful action so the parent can refresh its data. */
  onDone?: () => void
}

function fmtEuro(n: number): string {
  return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const CREDIT_REASONS: Array<{ value: string; labelKey: Parameters<typeof t>[0] }> = [
  { value: "order_change", labelKey: "billing.action.reason.order_change" },
  { value: "product_unsatisfactory", labelKey: "billing.action.reason.product_unsatisfactory" },
  { value: "duplicate", labelKey: "billing.action.reason.duplicate" },
  { value: "fraudulent", labelKey: "billing.action.reason.fraudulent" },
]

export function InvoiceActionMenu({
  invoiceId,
  invoiceNumber,
  status,
  amountDue,
  mondayItemId,
  onDone,
}: Props) {
  const locale = useLocale()
  // The action awaiting confirmation (null = menu closed / nothing pending).
  const [pending, setPending] = useState<ApiAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Credit-note form state.
  const [creditAmount, setCreditAmount] = useState<string>("")
  const [creditReason, setCreditReason] = useState<string>("order_change")
  const [creditRefund, setCreditRefund] = useState<boolean>(false)

  const isOpen = status === "open" || status === "overdue"
  const isPaid = status === "paid"
  // Void/draft invoices have no actionable corrections.
  const hasActions = isOpen || isPaid

  function openAction(action: ApiAction) {
    setError(null)
    if (action === "credit_note") {
      setCreditAmount(amountDue > 0 ? String(amountDue) : "")
      setCreditReason("order_change")
      setCreditRefund(isPaid) // default to refunding when the invoice is already paid
    }
    setPending(action)
  }

  async function run() {
    if (!pending) return
    setBusy(true)
    setError(null)

    const body: Record<string, unknown> = {
      action: pending,
      invoiceId,
      mondayItemId: mondayItemId ?? undefined,
      invoiceNumber: invoiceNumber ?? undefined,
    }
    if (pending === "credit_note") {
      const amt = Number(creditAmount)
      if (!Number.isFinite(amt) || amt <= 0) {
        setError(t("billing.action.err_credit_amount", locale))
        setBusy(false)
        return
      }
      body.amountEuro = amt
      body.reason = creditReason
      body.refund = isPaid ? creditRefund : false
    }

    try {
      const res = await fetch("/api/billing/invoice-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? t("billing.action.err_action_failed", locale))
        setBusy(false)
        return
      }
      setPending(null)
      setBusy(false)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("billing.action.err_action_failed", locale))
      setBusy(false)
    }
  }

  if (!hasActions) {
    return <span className="text-muted-foreground/30 text-xs">–</span>
  }

  const label = invoiceNumber ?? t("billing.action.this_invoice", locale)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none disabled:opacity-50">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">{t("billing.action.aria", locale)}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isOpen && (
            <>
              <DropdownMenuItem onClick={() => openAction("resend")}>
                <Bell className="h-3.5 w-3.5" />
                {t("billing.action.resend_reminder", locale)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("pay_offline")}>
                <Banknote className="h-3.5 w-3.5" />
                {t("billing.action.mark_paid_bank", locale)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openAction("credit_note")}>
                <FileMinus2 className="h-3.5 w-3.5" />
                {t("billing.action.credit_note_dots", locale)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("void")} className="text-red-600">
                <Ban className="h-3.5 w-3.5" />
                {t("billing.action.void_invoice", locale)}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("uncollectible")}>
                <FileX2 className="h-3.5 w-3.5" />
                {t("billing.action.mark_uncollectible", locale)}
              </DropdownMenuItem>
            </>
          )}
          {isPaid && (
            <DropdownMenuItem onClick={() => openAction("credit_note")}>
              <FileMinus2 className="h-3.5 w-3.5" />
              {t("billing.action.credit_note_refund_dots", locale)}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending === "resend" && t("billing.action.title.resend", locale, { label })}
              {pending === "pay_offline" && t("billing.action.title.pay_offline", locale, { label })}
              {pending === "void" && t("billing.action.title.void", locale, { label })}
              {pending === "uncollectible" && t("billing.action.title.uncollectible", locale, { label })}
              {pending === "credit_note" && t("billing.action.title.credit_note", locale, { label })}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {pending === "resend" && (
              <p className="text-sm text-muted-foreground">
                {t("billing.action.desc.resend", locale)}
              </p>
            )}
            {pending === "pay_offline" && (
              <p className="text-sm text-muted-foreground">
                {t("billing.action.desc.pay_offline_pre", locale)}<span className="font-medium text-foreground">{t("billing.past.status.paid", locale)}</span>{t("billing.action.desc.pay_offline_post", locale)}
              </p>
            )}
            {pending === "void" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  {t("billing.action.desc.void_1", locale)}
                </p>
                <p className="inline-flex items-start gap-1.5 text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {t("billing.action.desc.void_warning", locale)}
                </p>
              </div>
            )}
            {pending === "uncollectible" && (
              <p className="text-sm text-muted-foreground">
                {t("billing.action.desc.uncollectible", locale)}
              </p>
            )}
            {pending === "credit_note" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {isPaid
                    ? t("billing.action.desc.credit_note_paid", locale)
                    : t("billing.action.desc.credit_note_open", locale)}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[12px] text-muted-foreground">{t("billing.action.credit_amount", locale)}</Label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">€</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={creditAmount}
                        onChange={(e) => setCreditAmount(e.target.value)}
                        disabled={busy}
                        className="h-9 pl-5 tabular-nums"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[12px] text-muted-foreground">{t("billing.action.reason_label", locale)}</Label>
                    <select
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      disabled={busy}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      {CREDIT_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{t(r.labelKey, locale)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {isPaid && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={creditRefund}
                      onChange={(e) => setCreditRefund(e.target.checked)}
                      disabled={busy}
                      className="h-4 w-4 rounded border-border"
                    />
                    {t("billing.action.refund_checkbox", locale)}
                  </label>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  {t("billing.action.invoice_total", locale, { amount: fmtEuro(amountDue) })}
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPending(null)} disabled={busy}>
                {t("common.cancel", locale)}
              </Button>
              <Button
                size="sm"
                variant={pending === "void" ? "destructive" : "default"}
                onClick={run}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {pending === "resend" && t("billing.action.btn.resend", locale)}
                {pending === "pay_offline" && t("billing.action.btn.pay_offline", locale)}
                {pending === "void" && t("billing.action.btn.void", locale)}
                {pending === "uncollectible" && t("billing.action.btn.uncollectible", locale)}
                {pending === "credit_note" && t("billing.action.btn.credit_note", locale)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
