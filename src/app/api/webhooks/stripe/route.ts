import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Stripe webhook receiver — closes the next-invoice loop in seconds instead
 * of waiting up to 24h for the daily automations cron.
 *
 * When finance sends an invoice in Stripe, Stripe POSTs an `invoice.finalized`
 * event here. We look up the matching Hub client by `stripe_customer_id`,
 * find any open `next_invoice_due_task` for that client, and mark them done
 * with an audit note pointing back at the invoice.
 *
 * The daily cron's auto-complete pass remains as a backup so a missed webhook
 * (signing secret rotation, downtime, Stripe replay) doesn't leave finance
 * tasks lingering.
 *
 * Setup (one-time):
 *   1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   2. URL:  https://hub.rocketleads.com/api/webhooks/stripe
 *   3. Events: invoice.finalized, invoice.sent
 *   4. Copy the signing secret (whsec_…) and set STRIPE_WEBHOOK_SECRET in Vercel
 */
export const runtime = "nodejs"

// We only need the SDK for `constructEvent` here — signature math, no API
// calls. Pass a placeholder API key; the webhook verification uses the
// signing secret, not the API key.
const stripe = new Stripe("sk_placeholder_not_used_for_webhook_verification")

const HANDLED_EVENTS = new Set(["invoice.finalized", "invoice.sent"])

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature")
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 })
  }
  if (!webhookSecret) {
    // Returning 500 — the webhook is reachable but misconfigured. Stripe
    // will retry, which is what we want until env is set up.
    console.error("STRIPE_WEBHOOK_SECRET not configured")
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 })
  }

  // Stripe signature verification needs the raw body — never `req.json()`,
  // which mutates whitespace and breaks the HMAC.
  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  } catch (e) {
    console.error("Stripe webhook signature verification failed:", e)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    // 200 OK so Stripe doesn't retry — we've ack'd the event, just nothing
    // to do for this type.
    return NextResponse.json({ received: true, ignored: event.type })
  }

  const invoice = event.data.object as Stripe.Invoice
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null

  if (!customerId) {
    return NextResponse.json({ received: true, reason: "no_customer_on_invoice" })
  }

  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id, name")
    .eq("stripe_customer_id", customerId)
    .maybeSingle()

  if (!client) {
    // Invoice for a customer that isn't linked to any Hub client. Common
    // case: clients we haven't onboarded yet. Just ack.
    return NextResponse.json({ received: true, reason: "no_matching_hub_client" })
  }

  const { data: openTasks } = await supabase
    .from("inbox_events")
    .select("id, body, source_ref")
    .eq("kind", "task")
    .eq("status", "open")
    .eq("source", "automation")
    .eq("client_id", client.id)
    .filter("source_ref->>rule", "eq", "next_invoice_due_task")

  if (!openTasks || openTasks.length === 0) {
    return NextResponse.json({
      received: true,
      reason: "no_open_finance_task",
      client: client.name,
    })
  }

  const verb = event.type === "invoice.sent" ? "sent" : "finalized"
  const invoiceLabel = invoice.number ?? invoice.id
  const sentDate = new Date(invoice.created * 1000).toISOString().slice(0, 10)
  const note = `\n\n— Auto-completed via Stripe webhook: invoice ${invoiceLabel} ${verb} ${sentDate}.`

  const completed: string[] = []
  for (const task of openTasks) {
    const sourceRef = (task.source_ref ?? {}) as Record<string, unknown>
    const updatedSourceRef = {
      ...sourceRef,
      auto_completed: true,
      auto_completed_at: new Date().toISOString(),
      auto_completed_invoice_id: invoice.id,
      auto_completed_invoice_number: invoice.number ?? null,
      auto_completed_via: "stripe_webhook",
      auto_completed_event_type: event.type,
    }

    const { error } = await supabase
      .from("inbox_events")
      .update({
        status: "done",
        body: (task.body ?? "") + note,
        source_ref: updatedSourceRef,
        completed_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("status", "open") // race guard: skip if cron already closed it

    if (error) {
      console.error("Stripe webhook task update failed:", error.message)
      continue
    }
    completed.push(task.id)
  }

  return NextResponse.json({
    received: true,
    completed: completed.length,
    client: client.name,
    invoice: invoiceLabel,
  })
}
