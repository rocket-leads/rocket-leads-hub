import { createAdminClient } from "@/lib/supabase/server"

/**
 * Billing audit trail helper - writes one row to `billing_events` per finance
 * action taken from the Hub (send / void / credit / paid-offline / customer
 * edit). See migration 20240079. Reads power the per-client history on the
 * Billing tab so every correction is traceable.
 */

export type BillingAction =
  | "invoice_sent"
  | "invoice_voided"
  | "invoice_uncollectible"
  | "invoice_resent"
  | "invoice_paid_offline"
  | "credit_note"
  | "customer_updated"
  | "vat_updated"

export type BillingEventInput = {
  action: BillingAction
  mondayItemId?: string | null
  stripeCustomerId?: string | null
  stripeInvoiceId?: string | null
  invoiceNumber?: string | null
  amountEur?: number | null
  detail?: Record<string, unknown> | null
  actorUserId?: string | null
  actorEmail?: string | null
}

export type BillingEvent = {
  id: string
  createdAt: string
  action: BillingAction
  mondayItemId: string | null
  stripeCustomerId: string | null
  stripeInvoiceId: string | null
  invoiceNumber: string | null
  amountEur: number | null
  detail: Record<string, unknown> | null
  actorEmail: string | null
}

/**
 * Record a billing action. Best-effort: a logging failure must never break the
 * underlying finance operation (the invoice already went out / was voided), so
 * errors are swallowed and logged. The trail is important but not load-bearing
 * for the action itself.
 */
export async function recordBillingEvent(event: BillingEventInput): Promise<void> {
  try {
    const supabase = await createAdminClient()
    const { error } = await supabase.from("billing_events").insert({
      action: event.action,
      monday_item_id: event.mondayItemId ?? null,
      stripe_customer_id: event.stripeCustomerId ?? null,
      stripe_invoice_id: event.stripeInvoiceId ?? null,
      invoice_number: event.invoiceNumber ?? null,
      amount_eur: event.amountEur ?? null,
      detail: event.detail ?? null,
      actor_user_id: event.actorUserId ?? null,
      actor_email: event.actorEmail ?? null,
    })
    if (error) {
      console.error("[billing-audit] insert failed:", error.message)
    }
  } catch (e) {
    console.error("[billing-audit] insert threw:", e instanceof Error ? e.message : e)
  }
}

/** Fetch the audit trail for one client (most recent first). */
export async function fetchBillingEvents(
  mondayItemId: string,
  limit = 50,
): Promise<BillingEvent[]> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("billing_events")
    .select(
      "id, created_at, action, monday_item_id, stripe_customer_id, stripe_invoice_id, invoice_number, amount_eur, detail, actor_email",
    )
    .eq("monday_item_id", mondayItemId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data.map((r) => ({
    id: r.id as string,
    createdAt: r.created_at as string,
    action: r.action as BillingAction,
    mondayItemId: (r.monday_item_id as string | null) ?? null,
    stripeCustomerId: (r.stripe_customer_id as string | null) ?? null,
    stripeInvoiceId: (r.stripe_invoice_id as string | null) ?? null,
    invoiceNumber: (r.invoice_number as string | null) ?? null,
    amountEur: r.amount_eur != null ? Number(r.amount_eur) : null,
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    actorEmail: (r.actor_email as string | null) ?? null,
  }))
}
