import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { createAndSendInvoice } from "@/lib/integrations/stripe"

/**
 * Send a Stripe invoice for a client straight from the Hub. Open to anyone
 * with a Hub session — billing flows are visible to finance / members /
 * admins (same trust level as opening /billing).
 *
 * The body is the user-confirmed line items; we don't fabricate amounts on
 * the server because finance is expected to double-check them in the dialog
 * before pressing Send. We DO re-resolve the Stripe customer id from the
 * Monday item id so a stale client-side state can't be tricked into sending
 * an invoice to the wrong customer.
 */
type Body = {
  items?: Array<{ description?: string; amountEuro?: number | string }>
  daysUntilDue?: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 })
  }

  // Server-side authoritative customer id — pulled from Supabase by the
  // Monday item id rather than trusted from the request, so a tampered client
  // state can't redirect the invoice.
  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("monday_item_id, stripe_customer_id, name")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()

  if (!client) {
    return NextResponse.json({ error: "Client not synced to Supabase yet" }, { status: 404 })
  }
  if (!client.stripe_customer_id) {
    return NextResponse.json(
      { error: "No Stripe customer linked for this client. Add a Stripe customer ID on the client first." },
      { status: 400 },
    )
  }

  // Coerce numeric amounts coming from JSON (could be string from form input).
  const items = body.items.map((i) => ({
    description: String(i.description ?? "").trim(),
    amountEuro: typeof i.amountEuro === "string" ? Number(i.amountEuro) : Number(i.amountEuro ?? 0),
  }))

  if (items.some((i) => !Number.isFinite(i.amountEuro))) {
    return NextResponse.json({ error: "Invalid line item amount" }, { status: 400 })
  }

  try {
    const result = await createAndSendInvoice({
      customerId: client.stripe_customer_id,
      items,
      daysUntilDue: body.daysUntilDue,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send invoice" },
      { status: 500 },
    )
  }
}
