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

/** Per-campaign info used to seed line items when the parent client has
 *  multiple Monday rows (= multiple campaigns) sharing one Stripe customer. */
export type SiblingCampaignSeed = {
  name: string
  fee: number
  adBudget: number
  usesRocketLeadsAdAccount: boolean
}

type Props = {
  mondayItemId: string
  stripeCustomerId: string
  clientName: string
  /** Service fee (e.g. €450). Pre-fills the first line item — used when no
   *  `siblingCampaigns` is provided (single-campaign client). */
  fee: number
  /** Ad budget. Pre-fills a second line item *only* when the client runs ads
   *  via Rocket Leads' ad account. Otherwise the field is hidden entirely so
   *  finance doesn't accidentally invoice for ads we don't pay for. */
  adBudget: number
  usesRocketLeadsAdAccount: boolean
  /** When the parent client has multiple campaigns sharing this Stripe
   *  customer, pass them all here. Each entry contributes its own
   *  service-fee + (when applicable) ad-budget line items, suffixed with the
   *  unique part of the campaign name so the customer can tell which is
   *  which on the invoice. Overrides the single-campaign `fee`/`adBudget`. */
  siblingCampaigns?: SiblingCampaignSeed[]
  onClose: () => void
}

function fmtEuro(amount: number): string {
  return `€${amount.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Strip the longest common prefix shared by all sibling names from one
 *  name, then trim leftover separators. Used to derive a per-campaign
 *  suffix like "B2B" or "B2C" from "O2 Plus | B2B" / "O2 Plus | B2C".
 *  Returns the original name when there's no useful prefix to strip. */
function suffixFromSiblings(name: string, allNames: string[]): string {
  if (allNames.length < 2) return name
  let prefixLen = 0
  const minLen = Math.min(...allNames.map((n) => n.length))
  outer: for (let i = 0; i < minLen; i++) {
    const ch = allNames[0][i]
    for (let j = 1; j < allNames.length; j++) {
      if (allNames[j][i] !== ch) break outer
    }
    prefixLen = i + 1
  }
  if (prefixLen < 3) return name
  const suffix = name.slice(prefixLen).replace(/^[\s|\-:·]+/, "").trim()
  return suffix || name
}

/** Build the default line items based on what the agreement says.
 *
 *  Single-campaign path: service fee + (when via RL) ad budget, both labelled
 *  with the current month.
 *
 *  Multi-campaign path (`siblings`): one fee + one ad-budget per sibling that
 *  has a non-zero amount, each suffixed with the campaign's distinguishing
 *  name part. e.g. for an O2 Plus group:
 *    "Service fee — B2B — May 2026"
 *    "Advertising budget — B2B — May 2026"
 *    "Service fee — B2C — May 2026"
 *  Finance can still edit / add / remove lines before sending. */
function buildInitialItems(
  fee: number,
  adBudget: number,
  usesRl: boolean,
  siblings: SiblingCampaignSeed[] | undefined,
): LineItemDraft[] {
  const monthLabel = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })
  const items: LineItemDraft[] = []

  if (siblings && siblings.length > 1) {
    const allNames = siblings.map((s) => s.name)
    for (const sib of siblings) {
      const suffix = suffixFromSiblings(sib.name, allNames)
      if (sib.fee > 0) {
        items.push({
          id: crypto.randomUUID(),
          description: `Service fee — ${suffix} — ${monthLabel}`,
          amountEuro: String(sib.fee),
        })
      }
      if (sib.usesRocketLeadsAdAccount && sib.adBudget > 0) {
        items.push({
          id: crypto.randomUUID(),
          description: `Advertising budget — ${suffix} — ${monthLabel}`,
          amountEuro: String(sib.adBudget),
        })
      }
    }
  } else {
    if (fee > 0) {
      items.push({ id: crypto.randomUUID(), description: `Service fee — ${monthLabel}`, amountEuro: String(fee) })
    }
    if (usesRl && adBudget > 0) {
      items.push({ id: crypto.randomUUID(), description: `Advertising budget — ${monthLabel}`, amountEuro: String(adBudget) })
    }
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
  siblingCampaigns,
  onClose,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<LineItemDraft[]>(() =>
    buildInitialItems(fee, adBudget, usesRocketLeadsAdAccount, siblingCampaigns),
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
