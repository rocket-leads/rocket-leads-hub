"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus, Trash2, ExternalLink, Check } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type LineItemDraft = {
  id: string
  description: string
  amountEuro: string
}

type Props = {
  mondayItemId: string
  stripeCustomerId: string
  clientName: string
  /** Service fee (e.g. €450). Pre-fills the first line item. */
  fee: number
  /** Ad budget. Pre-fills a second line item *only* when the client runs ads
   *  via Rocket Leads' ad account. Otherwise the field is hidden entirely so
   *  finance doesn't accidentally invoice for ads we don't pay for. */
  adBudget: number
  usesRocketLeadsAdAccount: boolean
  onClose: () => void
}

function fmtEuro(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Build the default line items based on what the agreement says.
 *  Service fee always present (finance can adjust); ad budget only when
 *  routed through our ad account. Description prefilled with the current
 *  month, since invoices are typically a month at a time. */
function buildInitialItems(fee: number, adBudget: number, usesRl: boolean): LineItemDraft[] {
  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  const items: LineItemDraft[] = []
  if (fee > 0) {
    items.push({ id: crypto.randomUUID(), description: `Service fee — ${monthLabel}`, amountEuro: String(fee) })
  }
  if (usesRl && adBudget > 0) {
    items.push({ id: crypto.randomUUID(), description: `Advertising budget — ${monthLabel}`, amountEuro: String(adBudget) })
  }
  if (items.length === 0) {
    items.push({ id: crypto.randomUUID(), description: "", amountEuro: "" })
  }
  return items
}

/**
 * Confirmation dialog launched from the Billing page's "Create invoice" button.
 * Pre-fills line items from the agreement, shows the line-item totals, and on
 * Send pushes a draft → finalize → send chain through Stripe via
 * POST /api/clients/[id]/create-invoice. After success, refreshes the page so
 * the new "open" invoice surfaces in the Stripe payment-state cache.
 */
export function CreateInvoiceDialog({
  mondayItemId,
  stripeCustomerId,
  clientName,
  fee,
  adBudget,
  usesRocketLeadsAdAccount,
  onClose,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<LineItemDraft[]>(() =>
    buildInitialItems(fee, adBudget, usesRocketLeadsAdAccount),
  )
  // 7 days = standard Rocket Leads payment term.
  const [daysUntilDue, setDaysUntilDue] = useState<string>("7")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<{ number: string | null; hostedUrl: string | null } | null>(null)

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const amount = Number(item.amountEuro)
        return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
      }, 0),
    [items],
  )

  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: "", amountEuro: "" },
    ])
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((i) => i.id !== id)))
  }

  function patchItem(id: string, patch: Partial<LineItemDraft>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  async function send() {
    setError(null)
    const cleaned = items
      .map((i) => ({
        description: i.description.trim(),
        amountEuro: Number(i.amountEuro),
      }))
      .filter((i) => i.description && Number.isFinite(i.amountEuro) && i.amountEuro > 0)
    if (cleaned.length === 0) {
      setError("Add at least one line item with a description and amount.")
      return
    }
    const days = Number(daysUntilDue)
    if (!Number.isFinite(days) || days < 0 || days > 90) {
      setError("Due date must be between 0 and 90 days from today.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cleaned, daysUntilDue: days }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        number?: string | null
        hostedUrl?: string | null
        error?: string
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to send invoice")
        return
      }
      setSuccess({ number: data.number ?? null, hostedUrl: data.hostedUrl ?? null })
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invoice")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send invoice — {clientName}</DialogTitle>
        </DialogHeader>

        {success ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-2">
              <Check className="h-4 w-4" />
              Invoice {success.number ?? "draft"} sent to the customer.
            </div>
            <div className="flex items-center justify-end gap-2">
              {success.hostedUrl && (
                <a
                  href={success.hostedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  View in Stripe
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              )}
              <Button size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p>
                <span className="font-medium text-foreground">Stripe customer:</span>{" "}
                <span className="font-mono">{stripeCustomerId}</span>
              </p>
              <p>
                Double-check the line items below — clicking Send creates a real
                Stripe invoice and emails it to the customer.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-[12px] text-muted-foreground">Line items</Label>
              {items.map((item, idx) => (
                <div key={item.id} className="grid grid-cols-[1fr_120px_auto] gap-2 items-center">
                  <Input
                    value={item.description}
                    onChange={(e) => patchItem(item.id, { description: e.target.value })}
                    placeholder="Description"
                    disabled={submitting}
                    className="h-8 text-sm"
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">€</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={item.amountEuro}
                      onChange={(e) => patchItem(item.id, { amountEuro: e.target.value })}
                      placeholder="0.00"
                      disabled={submitting}
                      className="h-8 pl-5 text-sm tabular-nums"
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeItem(item.id)}
                    disabled={submitting || items.length === 1}
                    title={items.length === 1 ? "At least one line item is required" : "Remove line"}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove line {idx + 1}</span>
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="ghost" onClick={addItem} disabled={submitting}>
                <Plus className="h-3.5 w-3.5" />
                Add line
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">Due in (days)</Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={90}
                  value={daysUntilDue}
                  onChange={(e) => setDaysUntilDue(e.target.value)}
                  disabled={submitting}
                  className="h-8 tabular-nums"
                />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium">Total</p>
                <p className="text-xl font-semibold tabular-nums">{fmtEuro(total)}</p>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button size="sm" onClick={send} disabled={submitting}>
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Send invoice
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
