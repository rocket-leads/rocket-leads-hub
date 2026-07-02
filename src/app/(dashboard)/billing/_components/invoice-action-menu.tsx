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

const CREDIT_REASONS: Array<{ value: string; label: string }> = [
  { value: "order_change", label: "Order change" },
  { value: "product_unsatisfactory", label: "Product unsatisfactory" },
  { value: "duplicate", label: "Duplicate" },
  { value: "fraudulent", label: "Fraudulent" },
]

export function InvoiceActionMenu({
  invoiceId,
  invoiceNumber,
  status,
  amountDue,
  mondayItemId,
  onDone,
}: Props) {
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
        setError("Enter a credit amount greater than 0.")
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
        setError(data.error ?? "Action failed")
        setBusy(false)
        return
      }
      setPending(null)
      setBusy(false)
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed")
      setBusy(false)
    }
  }

  if (!hasActions) {
    return <span className="text-muted-foreground/30 text-xs">–</span>
  }

  const label = invoiceNumber ?? "this invoice"

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Invoice actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isOpen && (
            <>
              <DropdownMenuItem onClick={() => openAction("resend")}>
                <Bell className="h-3.5 w-3.5" />
                Resend reminder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("pay_offline")}>
                <Banknote className="h-3.5 w-3.5" />
                Mark paid (bank transfer)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openAction("credit_note")}>
                <FileMinus2 className="h-3.5 w-3.5" />
                Credit note…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("void")} className="text-red-600 dark:text-red-400">
                <Ban className="h-3.5 w-3.5" />
                Void invoice
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openAction("uncollectible")}>
                <FileX2 className="h-3.5 w-3.5" />
                Mark uncollectible
              </DropdownMenuItem>
            </>
          )}
          {isPaid && (
            <DropdownMenuItem onClick={() => openAction("credit_note")}>
              <FileMinus2 className="h-3.5 w-3.5" />
              Credit note / refund…
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pending === "resend" && `Resend reminder – ${label}`}
              {pending === "pay_offline" && `Mark paid – ${label}`}
              {pending === "void" && `Void invoice – ${label}`}
              {pending === "uncollectible" && `Mark uncollectible – ${label}`}
              {pending === "credit_note" && `Credit note – ${label}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {pending === "resend" && (
              <p className="text-sm text-muted-foreground">
                Re-send the invoice email to the customer as a payment reminder. No amounts change.
              </p>
            )}
            {pending === "pay_offline" && (
              <p className="text-sm text-muted-foreground">
                Record this invoice as paid outside Stripe (e.g. bank transfer). Stripe marks it paid,
                so the payment status flips to <span className="font-medium text-foreground">Paid</span>.
                Only do this once the money has actually landed.
              </p>
            )}
            {pending === "void" && (
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Voiding cancels the invoice – the customer owes nothing and it can&apos;t be reopened.
                  Use this for an invoice sent in error.
                </p>
                <p className="inline-flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  This cannot be undone.
                </p>
              </div>
            )}
            {pending === "uncollectible" && (
              <p className="text-sm text-muted-foreground">
                Mark this invoice as uncollectible (written-off bad debt). It stays on the books but
                stops counting as expected income.
              </p>
            )}
            {pending === "credit_note" && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {isPaid
                    ? "Issue a credit note against this paid invoice. Refund the money to the customer, or credit their Stripe balance for next time."
                    : "Issue a credit note to reduce what the customer owes on this invoice."}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[12px] text-muted-foreground">Credit amount</Label>
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
                    <Label className="text-[12px] text-muted-foreground">Reason</Label>
                    <select
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      disabled={busy}
                      className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                    >
                      {CREDIT_REASONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
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
                    Refund the money to the customer (otherwise credit their Stripe balance)
                  </label>
                )}
                <p className="text-[11px] text-muted-foreground/60">
                  Invoice total: {fmtEuro(amountDue)}
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
                Cancel
              </Button>
              <Button
                size="sm"
                variant={pending === "void" ? "destructive" : "default"}
                onClick={run}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {pending === "resend" && "Resend"}
                {pending === "pay_offline" && "Mark paid"}
                {pending === "void" && "Void invoice"}
                {pending === "uncollectible" && "Mark uncollectible"}
                {pending === "credit_note" && "Issue credit note"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
