"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, Check, Loader2, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import type { StripeCustomerDetails } from "@/lib/integrations/stripe"
import { BillingSectionShell } from "./billing-section-shell"

type CustomerResponse = {
  /** Present when exactly one Stripe customer is linked. */
  details?: StripeCustomerDetails
  /** Present when MULTIPLE are linked - finance must resolve to one. */
  multiple?: StripeCustomerDetails[]
}

/**
 * Editable Stripe customer card. Lets finance fix the customer's name, email,
 * billing address and VAT/BTW number without leaving the Hub - a wrong VAT or
 * country silently produces the wrong BTW on every invoice. All writes go
 * straight to Stripe (the source of truth) via PATCH /api/clients/[id]/stripe-customer.
 */
type FormState = {
  name: string
  email: string
  line1: string
  line2: string
  postalCode: string
  city: string
  country: string
  vatId: string
}

function toForm(d: StripeCustomerDetails): FormState {
  return {
    name: d.name ?? "",
    email: d.email ?? "",
    line1: d.address.line1 ?? "",
    line2: d.address.line2 ?? "",
    postalCode: d.address.postalCode ?? "",
    city: d.address.city ?? "",
    country: d.address.country ?? "",
    vatId: d.taxId?.value ?? "",
  }
}

export function StripeCustomerCard({
  mondayItemId,
  stripeCustomerId,
}: {
  mondayItemId: string
  stripeCustomerId: string | null
}) {
  const queryClient = useQueryClient()
  const query = useQuery<CustomerResponse>({
    queryKey: ["stripe-customer", mondayItemId],
    queryFn: async () => {
      const r = await fetch(`/api/clients/${mondayItemId}/stripe-customer`)
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Failed to load Stripe customer")
      return data
    },
    enabled: !!stripeCustomerId,
  })

  const [form, setForm] = useState<FormState | null>(null)
  const [saved, setSaved] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Which of the multiple linked customers is being applied (its id), so we can
  // spin just that row's button.
  const [applyingId, setApplyingId] = useState<string | null>(null)

  const multiple = query.data?.multiple

  useEffect(() => {
    if (query.data?.details) {
      const f = toForm(query.data.details)
      setForm(f)
      setSaved(f)
    }
  }, [query.data])

  if (!stripeCustomerId) return null

  /** Resolve a multi-customer client to ONE: write the chosen id to the Monday-
   *  backed stripe_customer_id field (replacing the others), then refetch. */
  async function pickCustomer(id: string) {
    setApplyingId(id)
    setError(null)
    try {
      const r = await fetch(`/api/clients/${mondayItemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldKey: "stripe_customer_id", value: id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((data as { error?: string }).error ?? "Failed to set Stripe customer")
      // Re-fetch this card + the invoice list now that it's a single customer.
      await queryClient.invalidateQueries({ queryKey: ["stripe-customer", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["billing", mondayItemId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to set Stripe customer")
    } finally {
      setApplyingId(null)
    }
  }

  const patch = (k: keyof FormState, v: string) =>
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev))

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved)

  async function save() {
    if (!form || !saved) return
    setSaving(true)
    setError(null)
    // Only send what changed. VAT + core fields are separate audit lines
    // server-side, but the endpoint accepts them in one payload.
    const body: Record<string, unknown> = {}
    if (form.name !== saved.name) body.name = form.name
    if (form.email !== saved.email) body.email = form.email
    if (
      form.line1 !== saved.line1 ||
      form.line2 !== saved.line2 ||
      form.postalCode !== saved.postalCode ||
      form.city !== saved.city ||
      form.country !== saved.country
    ) {
      body.address = {
        line1: form.line1,
        line2: form.line2,
        postalCode: form.postalCode,
        city: form.city,
        country: form.country,
      }
    }
    if (form.vatId !== saved.vatId) body.vatId = form.vatId

    try {
      const r = await fetch(`/api/clients/${mondayItemId}/stripe-customer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? "Save failed")
      const fresh = toForm(data.details as StripeCustomerDetails)
      setForm(fresh)
      setSaved(fresh)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  return (
    <BillingSectionShell
      icon={Building2}
      title="Stripe customer details"
      subtitle="Edits save directly to Stripe. Fix these before sending an invoice - a wrong VAT or country changes the BTW."
      actions={
        dirty ? (
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save to Stripe
          </Button>
        ) : null
      }
    >
      {query.isLoading ? (
        <div className="py-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Stripe customer…
        </div>
      ) : query.isError ? (
        <div className="py-6 text-center text-sm text-destructive">
          {query.error instanceof Error ? query.error.message : "Failed to load Stripe customer"}
        </div>
      ) : multiple ? (
        // Multiple Stripe customers linked - block editing/invoicing and make
        // finance pick the correct one. Company details are shown so they can
        // tell them apart. Picking one writes it as the single linked customer
        // (replacing the others).
        <div className="space-y-3">
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">This client has {multiple.length} Stripe customers linked.</p>
              <p className="text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                A client should have exactly one. Pick the correct one below — it becomes the single
                linked customer and the other is removed. Invoicing is blocked until this is resolved.
              </p>
            </div>
          </div>
          {multiple.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-border/60 px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{c.name ?? "(no name)"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {c.email ?? "no email"}
                  {c.address.city ? ` · ${c.address.city}` : ""}
                  {c.taxId?.value ? ` · VAT ${c.taxId.value}` : ""}
                </p>
                <p className="text-[10px] font-mono text-muted-foreground/50 truncate">{c.id}</p>
              </div>
              <Button size="sm" onClick={() => pickCustomer(c.id)} disabled={applyingId !== null}>
                {applyingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Use this one
              </Button>
            </div>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : form ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company name" value={form.name} onChange={(v) => patch("name", v)} disabled={saving} />
            <Field label="Email" value={form.email} onChange={(v) => patch("email", v)} disabled={saving} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Address line 1" value={form.line1} onChange={(v) => patch("line1", v)} disabled={saving} />
            <Field label="Address line 2" value={form.line2} onChange={(v) => patch("line2", v)} disabled={saving} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Postal code" value={form.postalCode} onChange={(v) => patch("postalCode", v)} disabled={saving} />
            <Field label="City" value={form.city} onChange={(v) => patch("city", v)} disabled={saving} />
            <Field label="Country (2-letter)" value={form.country} onChange={(v) => patch("country", v.toUpperCase())} disabled={saving} placeholder="NL" />
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <Field label="VAT / BTW number" value={form.vatId} onChange={(v) => patch("vatId", v)} disabled={saving} placeholder="NL123456789B01" />
            <p className="text-[11px] text-muted-foreground/70 pb-2">
              {form.vatId.trim()
                ? "Valid VAT → reverse charge, 0% BTW on invoices."
                : "No VAT → Stripe charges 20% BG VAT on invoices."}
            </p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Stripe customer…
        </div>
      )}
    </BillingSectionShell>
  )
}

function Field({
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
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  )
}
