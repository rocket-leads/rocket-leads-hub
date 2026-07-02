import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  voidInvoice,
  markInvoiceUncollectible,
  resendInvoice,
  markInvoicePaidOutOfBand,
  createInvoiceCreditNote,
  fetchBillingSummary,
  fetchAllRecentInvoices,
  type BillingSummary,
  type PastInvoice,
} from "@/lib/integrations/stripe"
import { recordBillingEvent, type BillingAction } from "@/lib/billing/audit"
import { readCache, writeCache } from "@/lib/cache"
import type Stripe from "stripe"

/**
 * Finance corrections on an already-sent Stripe invoice: void, mark
 * uncollectible, resend the reminder, mark paid out-of-band (bank transfer),
 * or issue a credit note. Every action writes to Stripe (source of truth),
 * logs to the billing audit trail, and refreshes the payment-status + past-
 * invoices caches so the UI reflects reality immediately.
 *
 * Reachable only from role-gated billing surfaces; we still re-resolve the
 * client's Stripe customer server-side for the cache refresh + audit context.
 */
type Action = "void" | "uncollectible" | "resend" | "pay_offline" | "credit_note"

type Body = {
  action: Action
  invoiceId: string
  mondayItemId?: string
  invoiceNumber?: string | null
  // credit_note only:
  amountEuro?: number
  reason?: string
  refund?: boolean
}

const CREDIT_REASONS = new Set(["duplicate", "fraudulent", "order_change", "product_unsatisfactory"])

const ACTION_TO_AUDIT: Record<Action, BillingAction> = {
  void: "invoice_voided",
  uncollectible: "invoice_uncollectible",
  resend: "invoice_resent",
  pay_offline: "invoice_paid_offline",
  credit_note: "credit_note",
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { action, invoiceId } = body
  if (!invoiceId || typeof invoiceId !== "string") {
    return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })
  }
  if (!action || !(action in ACTION_TO_AUDIT)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  // Resolve the client's Stripe customer for the cache refresh + audit context.
  let stripeCustomerId: string | null = null
  if (body.mondayItemId) {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("clients")
      .select("stripe_customer_id")
      .eq("monday_item_id", body.mondayItemId)
      .maybeSingle()
    stripeCustomerId = (data?.stripe_customer_id as string | null) ?? null
  }

  const actor = { actorUserId: session.user.id, actorEmail: session.user.email ?? null }
  let auditAmount: number | null = null
  const auditDetail: Record<string, unknown> = {}

  try {
    switch (action) {
      case "void":
        await voidInvoice(invoiceId)
        break
      case "uncollectible":
        await markInvoiceUncollectible(invoiceId)
        break
      case "resend":
        await resendInvoice(invoiceId)
        break
      case "pay_offline":
        await markInvoicePaidOutOfBand(invoiceId)
        break
      case "credit_note": {
        const amountEuro = typeof body.amountEuro === "number" ? body.amountEuro : Number(body.amountEuro)
        if (!Number.isFinite(amountEuro) || amountEuro <= 0) {
          return NextResponse.json({ error: "A credit amount greater than 0 is required." }, { status: 400 })
        }
        const reason =
          body.reason && CREDIT_REASONS.has(body.reason)
            ? (body.reason as Stripe.CreditNoteCreateParams.Reason)
            : undefined
        const note = await createInvoiceCreditNote(invoiceId, {
          amountEuro,
          reason,
          refund: !!body.refund,
        })
        auditAmount = amountEuro
        auditDetail.creditNoteId = note.creditNoteId
        auditDetail.refund = !!body.refund
        if (reason) auditDetail.reason = reason
        break
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Stripe action failed" },
      { status: 500 },
    )
  }

  // Audit trail - after the action succeeded.
  await recordBillingEvent({
    action: ACTION_TO_AUDIT[action],
    mondayItemId: body.mondayItemId ?? null,
    stripeCustomerId,
    stripeInvoiceId: invoiceId,
    invoiceNumber: body.invoiceNumber ?? null,
    amountEur: auditAmount,
    detail: Object.keys(auditDetail).length > 0 ? auditDetail : null,
    ...actor,
  })

  // Refresh the payment-status + past-invoices caches so the pill and the list
  // reflect the new state without waiting for the next cron tick.
  if (stripeCustomerId) {
    try {
      const fresh = await fetchBillingSummary(stripeCustomerId)
      const existing = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
      await writeCache("billing_summaries", { ...existing, [stripeCustomerId]: fresh })
    } catch (e) {
      console.error("[invoice-action] summary refresh failed:", e instanceof Error ? e.message : e)
    }
  }
  try {
    const past: PastInvoice[] = await fetchAllRecentInvoices(180)
    await writeCache("past_invoices", past)
    await writeCache("billing_refreshed_at", new Date().toISOString())
  } catch (e) {
    console.error("[invoice-action] past invoices refresh failed:", e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ ok: true })
}
