"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Plus, Trash2, ExternalLink, Check, ChevronLeft, AlertCircle, CalendarClock, Pencil } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { addMonthsIso } from "@/lib/clients/billing-cycle"
import type { InvoiceDraftPreview } from "@/lib/integrations/stripe"

type InvoiceMode = "monthly" | "oneoff"

function fmtDateLong(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

type LineItemDraft = {
  id: string
  description: string
  amountEuro: string
  /** Discount line: the amount is entered positive but SUBTRACTED from the
   *  total (and sent to Stripe as a negative invoice item). Lets finance apply
   *  "first month free" / promo credits without typing minus signs. */
  discount?: boolean
}

/** Resolve a draft line to its signed EUR amount (discounts are negative). */
function signedAmount(item: LineItemDraft): number {
  const n = Number(item.amountEuro)
  if (!Number.isFinite(n)) return NaN
  return item.discount ? -Math.abs(n) : n
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`), UTC so no DST drift. */
function daysBetweenIso(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number)
  const [by, bm, bd] = b.split("-").map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Today as a local `YYYY-MM-DD`. */
function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Prorate a package's monthly price to the part of the CURRENT period still to
 * run - i.e. from today up to the next payment date. The current period is the
 * month ending at the payment date, so a package added halfway is billed for
 * ~half now (once), and the full monthly amount rides the regular invoice from
 * the next cycle (finance updates the agreement separately).
 *
 * Returns null when there's no valid payment date to prorate against.
 */
function computeProration(
  monthly: number,
  cycleStartDate: string | null | undefined,
): { amount: number; daysRemaining: number; daysInPeriod: number; from: string; to: string } | null {
  if (!cycleStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(cycleStartDate) || !Number.isFinite(monthly)) return null
  const to = cycleStartDate
  const periodStart = addMonthsIso(cycleStartDate, -1)
  if (!periodStart) return null
  const daysInPeriod = daysBetweenIso(periodStart, to)
  const from = todayIso()
  const daysRemaining = Math.max(0, Math.min(daysBetweenIso(from, to), daysInPeriod))
  const amount = daysInPeriod > 0 ? Math.round(((monthly * daysRemaining) / daysInPeriod) * 100) / 100 : 0
  return { amount, daysRemaining, daysInPeriod, from, to }
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
  /** Service fee (e.g. €450). Pre-fills the first line item - used when no
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
  /** Current payment date (cycle start, `YYYY-MM-DD`) or null. Seeds the
   *  "next payment date" default (this + 1 month) shown on a monthly send so
   *  finance can confirm/override where the cycle lands next. */
  cycleStartDate?: string | null
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

/** Build the default line items based on what the agreement says. */
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
          description: `Service fee - ${suffix} - ${monthLabel}`,
          amountEuro: String(sib.fee),
        })
      }
      if (sib.usesRocketLeadsAdAccount && sib.adBudget > 0) {
        items.push({
          id: crypto.randomUUID(),
          description: `Advertising budget - ${suffix} - ${monthLabel}`,
          amountEuro: String(sib.adBudget),
        })
      }
    }
  } else {
    if (fee > 0) {
      items.push({ id: crypto.randomUUID(), description: `Service fee - ${monthLabel}`, amountEuro: String(fee) })
    }
    if (usesRl && adBudget > 0) {
      items.push({ id: crypto.randomUUID(), description: `Advertising budget - ${monthLabel}`, amountEuro: String(adBudget) })
    }
  }

  if (items.length === 0) {
    items.push({ id: crypto.randomUUID(), description: "", amountEuro: "" })
  }
  return items
}

/** Map Stripe's `tax_id.type` enum to a short human label finance can
 *  recognise. Falls back to the raw enum when we haven't seen a particular
 *  region yet - the actual VAT number value next to it carries the meaning. */
function taxIdLabel(type: string): string {
  switch (type) {
    case "eu_vat": return "BTW"
    case "nl_btw": return "BTW"
    case "be_vat": return "BTW"
    case "de_vat": return "VAT"
    case "gb_vat": return "VAT"
    case "us_ein": return "EIN"
    default: return type.toUpperCase().replace(/_/g, " ")
  }
}

/**
 * Two-step confirmation dialog launched from the Billing page's "Create
 * invoice" button.
 *
 * State machine: edit → preview → success
 *
 * 1. **edit**    - line-item form. "Preview" POSTs `action: preview` which
 *    is a READ-ONLY Stripe call (customer + tax IDs only) - no draft is
 *    created, nothing exists in Stripe until the actual send fires.
 * 2. **preview** - Finance reviews recipient + line items + BTW status.
 *    Two paths: "Confirm & send" → one-shot draft + finalize + email
 *    (action: send) | "Back to edit" → return to edit (no Stripe call,
 *    no cleanup needed since preview never created anything).
 * 3. **success** - same chip + Close + "View in Stripe" the old flow had.
 */
export function CreateInvoiceDialog({
  mondayItemId,
  stripeCustomerId,
  clientName,
  fee,
  adBudget,
  usesRocketLeadsAdAccount,
  siblingCampaigns,
  cycleStartDate,
  onClose,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState<LineItemDraft[]>(() =>
    buildInitialItems(fee, adBudget, usesRocketLeadsAdAccount, siblingCampaigns),
  )
  const [daysUntilDue, setDaysUntilDue] = useState<string>("7")
  const [error, setError] = useState<string | null>(null)

  // Invoice mode. "monthly" = the recurring invoice, advances the payment date
  // on send. "oneoff" = a standalone extra charge that leaves the cycle alone.
  const [mode, setMode] = useState<InvoiceMode>("monthly")
  // Next payment date the cycle advances to on a monthly send. Defaults to the
  // current payment date + 1 month (standard cadence); finance overrides it for
  // quarterly / 2-month clients. Empty when the client has no cycle yet - then
  // finance can type one here to establish the first payment date.
  const [nextPaymentDate, setNextPaymentDate] = useState<string>(
    () => (cycleStartDate ? addMonthsIso(cycleStartDate, 1) ?? "" : ""),
  )

  // Proration helper (invoice-dialog approach): finance types a package's
  // monthly price; we add a prorated line for the days left until the payment
  // date. The full monthly amount rides future cycles once finance updates the
  // agreement separately.
  const [showProration, setShowProration] = useState(false)
  const [prorationMonthly, setProrationMonthly] = useState("")
  const [prorationLabel, setProrationLabel] = useState("")
  const prorationPreview = prorationMonthly.trim()
    ? computeProration(Number(prorationMonthly), cycleStartDate)
    : null

  function addProrationLine() {
    if (!prorationPreview || prorationPreview.amount <= 0) return
    const label = prorationLabel.trim() || "Package"
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        description: `Pro-rata: ${label} (${fmtDateLong(prorationPreview.from)} – ${fmtDateLong(prorationPreview.to)})`,
        amountEuro: String(prorationPreview.amount),
      },
    ])
    setShowProration(false)
    setProrationMonthly("")
    setProrationLabel("")
  }

  // State machine - exactly one of these is the active state.
  const [step, setStep] = useState<"edit" | "previewing" | "preview" | "sending" | "success">("edit")
  const [preview, setPreview] = useState<InvoiceDraftPreview | null>(null)
  const [success, setSuccess] = useState<{ number: string | null; hostedUrl: string | null; newCycleStartDate: string | null; mode: InvoiceMode; warnings: string[] } | null>(null)

  // Inline recipient edit (from the preview screen). Fixing the customer's
  // name / email / address / VAT here writes straight to Stripe, then the
  // preview is re-fetched so the BTW recalculates (a corrected VAT flips 0% ⇆
  // 20%). Avoids leaving the send flow just to fix a typo.
  const [editingRecipient, setEditingRecipient] = useState(false)
  const [savingRecipient, setSavingRecipient] = useState(false)
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [recipientForm, setRecipientForm] = useState({
    name: "", email: "", line1: "", line2: "", postalCode: "", city: "", country: "", vatId: "",
  })

  function startEditRecipient() {
    const c = preview?.customer
    setRecipientForm({
      name: c?.name ?? "",
      email: c?.email ?? "",
      line1: c?.address?.line1 ?? "",
      line2: c?.address?.line2 ?? "",
      postalCode: c?.address?.postal_code ?? "",
      city: c?.address?.city ?? "",
      country: c?.address?.country ?? "",
      vatId: c?.taxIds?.[0]?.value ?? "",
    })
    setRecipientError(null)
    setEditingRecipient(true)
  }

  async function saveRecipient() {
    setSavingRecipient(true)
    setRecipientError(null)
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/stripe-customer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: recipientForm.name,
          email: recipientForm.email,
          address: {
            line1: recipientForm.line1,
            line2: recipientForm.line2,
            postalCode: recipientForm.postalCode,
            city: recipientForm.city,
            country: recipientForm.country,
          },
          vatId: recipientForm.vatId,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) {
        setRecipientError(data.error ?? "Failed to update recipient")
        setSavingRecipient(false)
        return
      }
      // Re-fetch the preview INLINE (don't flip back to the edit screen) so the
      // recipient block + BTW/total reflect the edit while staying on review.
      const cleaned = items
        .map((i) => ({ description: i.description.trim(), amountEuro: signedAmount(i) }))
        .filter((i) => i.description && Number.isFinite(i.amountEuro) && i.amountEuro !== 0)
      const pres = await fetch(`/api/clients/${mondayItemId}/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", items: cleaned, daysUntilDue: Number(daysUntilDue), mode }),
      })
      const pdata = (await pres.json().catch(() => ({}))) as (InvoiceDraftPreview & { ok: true }) | { ok?: false; error?: string }
      if (pres.ok && "ok" in pdata && pdata.ok === true) {
        const { ok: _ok, ...previewData } = pdata
        void _ok
        setPreview(previewData as InvoiceDraftPreview)
      }
      setEditingRecipient(false)
      setSavingRecipient(false)
    } catch (e) {
      setRecipientError(e instanceof Error ? e.message : "Failed to update recipient")
      setSavingRecipient(false)
    }
  }

  const total = useMemo(
    () =>
      items.reduce((sum, item) => {
        const amount = signedAmount(item)
        return Number.isFinite(amount) && amount !== 0 ? sum + amount : sum
      }, 0),
    [items],
  )

  function addItem() {
    setItems((prev) => [...prev, { id: crypto.randomUUID(), description: "", amountEuro: "" }])
  }

  function addDiscount() {
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), description: "Discount", amountEuro: "", discount: true },
    ])
  }

  function removeItem(id: string) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((i) => i.id !== id)))
  }

  function patchItem(id: string, patch: Partial<LineItemDraft>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  /** Reads the form, validates, then asks the server for a preview (no
   *  Stripe mutation). Successful response advances to the preview state. */
  async function fetchPreview() {
    setError(null)
    const cleaned = items
      .map((i) => ({
        description: i.description.trim(),
        amountEuro: signedAmount(i),
      }))
      .filter((i) => i.description && Number.isFinite(i.amountEuro) && i.amountEuro !== 0)
    if (cleaned.length === 0) {
      setError("Add at least one line item with a description and amount.")
      return
    }
    const days = Number(daysUntilDue)
    if (!Number.isFinite(days) || days < 0 || days > 90) {
      setError("Due date must be between 0 and 90 days from today.")
      return
    }

    setStep("previewing")
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", items: cleaned, daysUntilDue: days, mode }),
      })
      const data = (await res.json().catch(() => ({}))) as
        | (InvoiceDraftPreview & { ok: true })
        | { ok?: false; error?: string }
      if (!res.ok || !("ok" in data) || data.ok !== true) {
        const errMsg = "error" in data && data.error ? data.error : "Failed to build invoice preview"
        setError(errMsg)
        setStep("edit")
        return
      }
      const { ok: _ok, ...previewData } = data
      void _ok
      setPreview(previewData as InvoiceDraftPreview)
      setStep("preview")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build invoice preview")
      setStep("edit")
    }
  }

  function backToEdit() {
    // No Stripe cleanup needed - preview was read-only.
    setPreview(null)
    setStep("edit")
  }

  /** Sends the invoice atomically (server-side: create draft → finalize →
   *  email + post-send cache refreshes). Triggered from the preview screen
   *  after Finance has approved the recipient + amounts + BTW. */
  async function sendInvoice() {
    setError(null)
    const cleaned = items
      .map((i) => ({
        description: i.description.trim(),
        amountEuro: signedAmount(i),
      }))
      .filter((i) => i.description && Number.isFinite(i.amountEuro) && i.amountEuro !== 0)
    if (cleaned.length === 0) {
      setError("Add at least one line item with a description and amount.")
      return
    }
    const days = Number(daysUntilDue)
    if (!Number.isFinite(days) || days < 0 || days > 90) {
      setError("Due date must be between 0 and 90 days from today.")
      return
    }

    // For a monthly send, a next payment date is required so the cycle can
    // advance. One-off invoices never touch the cycle, so the field is skipped.
    if (mode === "monthly" && nextPaymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextPaymentDate)) {
      setError("Enter a valid next payment date (or clear it to leave the cycle unchanged).")
      return
    }

    setStep("sending")
    try {
      const res = await fetch(`/api/clients/${mondayItemId}/create-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          items: cleaned,
          daysUntilDue: days,
          mode,
          ...(mode === "monthly" && nextPaymentDate ? { nextCycleDate: nextPaymentDate } : {}),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        number?: string | null
        hostedUrl?: string | null
        newCycleStartDate?: string | null
        postSendWarnings?: string[]
        error?: string
      }
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Failed to send invoice")
        setStep("preview")
        return
      }
      setSuccess({
        number: data.number ?? null,
        hostedUrl: data.hostedUrl ?? null,
        newCycleStartDate: data.newCycleStartDate ?? null,
        mode,
        warnings: data.postSendWarnings ?? [],
      })
      setStep("success")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send invoice")
      setStep("preview")
    }
  }

  const inFlight = step === "previewing" || step === "sending"

  return (
    <Dialog open onOpenChange={(o) => !o && !inFlight && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "preview" || step === "sending"
              ? `Review invoice - ${clientName}`
              : step === "success"
                ? `Invoice sent - ${clientName}`
                : `Create invoice - ${clientName}`}
          </DialogTitle>
        </DialogHeader>

        {step === "success" && success ? (
          <div className="space-y-3 py-2">
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-2">
              <Check className="h-4 w-4" />
              Invoice {success.number ?? "draft"} sent to the customer.
            </div>

            {/* Cycle outcome - so finance sees exactly where the payment date
                landed (or that a one-off left it untouched). */}
            {success.mode === "oneoff" ? (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                One-off charge - the payment cycle was left unchanged.
              </p>
            ) : success.newCycleStartDate ? (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />
                Next payment date set to <span className="font-medium text-foreground">{fmtDateLong(success.newCycleStartDate)}</span>. You can still adjust it on the Billing page.
              </p>
            ) : null}

            {/* Post-send Monday sync warnings - surfaced so finance knows when
                the admin column / invoice date didn't auto-update and a manual
                touch in Monday is needed. Without this, ProSteal-style issues
                (Stripe send OK, Monday status stuck on "Overdue", invoice date
                not advanced) silently rot until someone notices. */}
            {success.warnings.length > 0 && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-medium inline-flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Stripe send went through, but Monday didn't fully sync:
                </p>
                <ul className="list-disc pl-5 space-y-0.5">
                  {success.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

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
        ) : step === "preview" || step === "sending" ? (
          // Preview screen - the actual customer-facing invoice as Stripe
          // sees it before we finalize. Finance's last chance to catch a
          // wrong customer, wrong BTW number, missing line, etc.
          <div className="space-y-4">
            {/* Customer block - editable inline so finance can fix wrong
                recipient details (name / email / address / VAT) at the moment
                of review, without leaving the send flow. Saving writes to
                Stripe and re-runs the preview so the BTW recalculates. */}
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-xs">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Recipient</p>
                {step === "preview" && !editingRecipient && (
                  <button
                    type="button"
                    onClick={startEditRecipient}
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                )}
              </div>

              {editingRecipient ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <RecipientInput label="Company name" value={recipientForm.name} onChange={(v) => setRecipientForm((f) => ({ ...f, name: v }))} disabled={savingRecipient} />
                    <RecipientInput label="Email" value={recipientForm.email} onChange={(v) => setRecipientForm((f) => ({ ...f, email: v }))} disabled={savingRecipient} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <RecipientInput label="Address line 1" value={recipientForm.line1} onChange={(v) => setRecipientForm((f) => ({ ...f, line1: v }))} disabled={savingRecipient} />
                    <RecipientInput label="Address line 2" value={recipientForm.line2} onChange={(v) => setRecipientForm((f) => ({ ...f, line2: v }))} disabled={savingRecipient} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <RecipientInput label="Postal code" value={recipientForm.postalCode} onChange={(v) => setRecipientForm((f) => ({ ...f, postalCode: v }))} disabled={savingRecipient} />
                    <RecipientInput label="City" value={recipientForm.city} onChange={(v) => setRecipientForm((f) => ({ ...f, city: v }))} disabled={savingRecipient} />
                    <RecipientInput label="Country" value={recipientForm.country} onChange={(v) => setRecipientForm((f) => ({ ...f, country: v.toUpperCase() }))} disabled={savingRecipient} placeholder="NL" />
                  </div>
                  <RecipientInput label="VAT / BTW number" value={recipientForm.vatId} onChange={(v) => setRecipientForm((f) => ({ ...f, vatId: v }))} disabled={savingRecipient} placeholder="NL123456789B01" />
                  {recipientError && <p className="text-[11px] text-destructive">{recipientError}</p>}
                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    <Button size="xs" variant="ghost" onClick={() => setEditingRecipient(false)} disabled={savingRecipient}>Cancel</Button>
                    <Button size="xs" onClick={saveRecipient} disabled={savingRecipient}>
                      {savingRecipient ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Save to Stripe
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="font-medium text-sm text-foreground">{preview?.customer.name ?? "(no name)"}</p>
                  {preview?.customer.email && (
                    <p className="text-muted-foreground">{preview.customer.email}</p>
                  )}
                  {preview?.customer.address && (
                    <p className="text-muted-foreground mt-0.5">
                      {[
                        preview.customer.address.line1,
                        preview.customer.address.line2,
                        [preview.customer.address.postal_code, preview.customer.address.city].filter(Boolean).join(" "),
                        preview.customer.address.country,
                      ].filter(Boolean).join(", ")}
                    </p>
                  )}
                  {preview && preview.customer.taxIds.length > 0 && (
                    <p className="text-muted-foreground mt-1">
                      {preview.customer.taxIds.map((t, i) => (
                        <span key={i} className="mr-2">
                          <span className="text-foreground/70 font-medium">{taxIdLabel(t.type)}</span> {t.value}
                        </span>
                      ))}
                    </p>
                  )}
                  {preview && preview.customer.taxIds.length === 0 && (
                    // Stripe `automatic_tax` handles the 20% BG VAT on send (no
                    // tax ID → BG origin default rate). This is just a heads-up
                    // for Finance so the BTW row below isn't a surprise.
                    <p className="mt-1 inline-flex items-center gap-1 text-muted-foreground/70 font-medium">
                      No tax ID on file - Stripe will charge 20% BG VAT.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Line items as Stripe will render them */}
            <div className="rounded-md border border-border/60">
              <div className="px-3 py-2 border-b border-border/60 bg-muted/20">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Line items</p>
              </div>
              <div className="divide-y divide-border/40">
                {preview?.lineItems.map((line, idx) => (
                  <div key={idx} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <span className="text-foreground/90 leading-snug">{line.description}</span>
                    <span className="tabular-nums shrink-0 text-foreground">{fmtEuro(line.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2 border-t border-border/60 space-y-1 text-sm">
                {/* BTW row is ALWAYS rendered (even at 0%) so Finance sees
                    the tax situation explicitly. The note below explains why
                    it's 0% - reverse-charge with a valid BTW ID is fine,
                    "no BTW + no tax ID" is a real red flag worth catching. */}
                {(() => {
                  const subtotal = preview?.subtotal ?? 0
                  const tax = preview?.tax ?? 0
                  const total = preview?.total ?? 0
                  // Effective rate from what Stripe will actually charge -
                  // single source of truth so the % matches the € amount.
                  const ratePct = subtotal > 0 ? Math.round((tax / subtotal) * 1000) / 10 : 0
                  const rateLabel = ratePct === 0 ? "0%" : `${ratePct.toFixed(ratePct % 1 === 0 ? 0 : 1)}%`
                  const hasTaxId = (preview?.customer.taxIds.length ?? 0) > 0
                  return (
                    <>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Subtotal (excl. BTW)</span>
                        <span className="tabular-nums">{fmtEuro(subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>BTW ({rateLabel})</span>
                        <span className="tabular-nums">{fmtEuro(tax)}</span>
                      </div>
                      <div className="flex items-center justify-between font-semibold pt-1 border-t border-border/40">
                        <span>Total</span>
                        <span className="tabular-nums">{fmtEuro(total)}</span>
                      </div>
                      {/* BTW interpretation - explains the rate Finance sees so
                          the % isn't a black box. Stripe `automatic_tax`
                          drives the actual send; preview rules mirror that:
                          - Has tax ID → reverse charge, 0%.
                          - No tax ID → 20% BG VAT (BG origin default).
                          The legacy "0% + no tax ID" case is no longer
                          possible - Stripe will always apply the BG rate when
                          there's no valid tax ID - but we keep an amber
                          fallback in case the local mirror ever diverges. */}
                      {tax === 0 && hasTaxId && (
                        <p className="text-[11px] text-muted-foreground/80 pt-1.5">
                          Reverse charge - klant heeft een geldig BTW-nummer, geen BTW gerekend.
                        </p>
                      )}
                      {tax > 0 && !hasTaxId && (
                        <p className="text-[11px] text-muted-foreground/80 pt-1.5">
                          20% BG VAT - Stripe rekent dit automatisch op de factuur (geen losse regel, wel zichtbaar als BTW-totaal).
                        </p>
                      )}
                      {tax === 0 && !hasTaxId && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1.5 inline-flex items-start gap-1">
                          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>Preview-mismatch: Stripe past 20% BG VAT toe op send. Controleer de definitieve factuur na verzenden.</span>
                        </p>
                      )}
                    </>
                  )
                })()}
                {preview?.daysUntilDue != null && (
                  <p className="text-[11px] text-muted-foreground/70 pt-1">
                    Due in {preview.daysUntilDue} day{preview.daysUntilDue === 1 ? "" : "s"} from today.
                  </p>
                )}
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={backToEdit} disabled={inFlight}>
                <ChevronLeft className="h-3.5 w-3.5" />
                Back to edit
              </Button>
              <Button size="sm" onClick={sendInvoice} disabled={inFlight}>
                {step === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirm &amp; send
              </Button>
            </div>
          </div>
        ) : (
          // Edit screen - same line-item form as before, but the primary
          // action now creates a Stripe draft and transitions to preview.
          <div className="space-y-4">
            {/* Mode selector - pill toggle (raw buttons are the sanctioned
                pattern for pill selectors per the Hub button rules). */}
            <div className="inline-flex rounded-md border border-border/60 p-0.5 bg-muted/30">
              {([
                { key: "monthly" as const, label: "Monthly invoice" },
                { key: "oneoff" as const, label: "One-off invoice" },
              ]).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  disabled={inFlight}
                  className={cn(
                    "h-8 px-3 rounded text-xs font-medium transition-colors",
                    mode === opt.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-0.5">
              <p>
                <span className="font-medium text-foreground">Stripe customer:</span>{" "}
                <span className="font-mono">{stripeCustomerId}</span>
              </p>
              <p>
                {mode === "monthly"
                  ? "Recurring invoice - advances the client's payment date on send."
                  : "One-off charge - won't change the payment cycle, MRR or admin status."}
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
                    disabled={inFlight}
                    className="h-8 text-sm"
                  />
                  <div className="relative">
                    <span
                      className={cn(
                        "pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs",
                        item.discount ? "text-red-500" : "text-muted-foreground",
                      )}
                    >
                      {item.discount ? "−€" : "€"}
                    </span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={item.amountEuro}
                      onChange={(e) => patchItem(item.id, { amountEuro: e.target.value })}
                      placeholder="0.00"
                      disabled={inFlight}
                      className={cn("h-8 text-sm tabular-nums", item.discount ? "pl-7" : "pl-5")}
                    />
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => removeItem(item.id)}
                    disabled={inFlight || items.length === 1}
                    title={items.length === 1 ? "At least one line item is required" : "Remove line"}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span className="sr-only">Remove line {idx + 1}</span>
                  </Button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={addItem} disabled={inFlight}>
                  <Plus className="h-3.5 w-3.5" />
                  Add line
                </Button>
                <Button size="sm" variant="ghost" onClick={addDiscount} disabled={inFlight} className="text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Add discount
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowProration((v) => !v)} disabled={inFlight} className="text-muted-foreground">
                  <Plus className="h-3.5 w-3.5" />
                  Pro-rata
                </Button>
              </div>

              {/* Prorated charge helper - type a package's monthly price, get a
                  line for the days left until the payment date. */}
              {showProration && (
                <div className="rounded-md border border-border/60 px-3 py-2.5 space-y-2">
                  <p className="text-[12px] font-medium text-foreground">Prorated charge</p>
                  {!cycleStartDate ? (
                    <p className="text-[11px] text-muted-foreground">Set a payment date first to prorate against it.</p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Package monthly price</Label>
                          <div className="relative">
                            <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">€</span>
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.01"
                              value={prorationMonthly}
                              onChange={(e) => setProrationMonthly(e.target.value)}
                              placeholder="0.00"
                              disabled={inFlight}
                              className="h-8 pl-5 text-sm tabular-nums"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Description</Label>
                          <Input
                            value={prorationLabel}
                            onChange={(e) => setProrationLabel(e.target.value)}
                            placeholder="e.g. Google Ads"
                            disabled={inFlight}
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      {prorationPreview && prorationPreview.amount > 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {prorationPreview.daysRemaining} of {prorationPreview.daysInPeriod} days →{" "}
                          <span className="font-medium text-foreground">{fmtEuro(prorationPreview.amount)}</span> until{" "}
                          {fmtDateLong(prorationPreview.to)}
                        </p>
                      ) : prorationMonthly.trim() ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Payment date is today or past - no partial period to prorate. Add the full amount as a normal line instead.
                        </p>
                      ) : null}
                      <div className="flex items-center justify-end gap-2">
                        <Button size="xs" variant="ghost" onClick={() => setShowProration(false)} disabled={inFlight}>Cancel</Button>
                        <Button size="xs" onClick={addProrationLine} disabled={inFlight || !prorationPreview || prorationPreview.amount <= 0}>
                          Add line
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Next payment date - monthly only. On send, the cycle advances
                to this date (default: current payment date + 1 month). Finance
                overrides it for quarterly / 2-month clients. One-off invoices
                never touch the cycle, so the field is hidden for them. */}
            {mode === "monthly" && (
              <div className="rounded-md border border-border/60 px-3 py-2.5 space-y-1.5">
                <Label className="text-[12px] text-muted-foreground inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Next payment date
                </Label>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="date"
                    value={nextPaymentDate}
                    onChange={(e) => setNextPaymentDate(e.target.value)}
                    disabled={inFlight}
                    className="h-8 w-auto tabular-nums"
                  />
                  {cycleStartDate && (
                    <span className="text-[11px] text-muted-foreground/70">
                      after this invoice · currently {fmtDateLong(cycleStartDate)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  Defaults to +1 month. Set +2 or +3 months for quarterly clients. Invoice goes out 7 days before this date.
                </p>
              </div>
            )}

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
                  disabled={inFlight}
                  className="h-8 tabular-nums"
                />
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground/70 uppercase tracking-wider font-medium">Subtotal</p>
                <p className="text-xl font-semibold tabular-nums">{fmtEuro(total)}</p>
              </div>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={inFlight}>
                Cancel
              </Button>
              <Button size="sm" onClick={fetchPreview} disabled={inFlight}>
                {step === "previewing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Preview
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Compact labelled input for the inline recipient editor. */
function RecipientInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
    </div>
  )
}
