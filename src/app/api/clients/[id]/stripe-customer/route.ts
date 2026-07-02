import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  fetchStripeCustomerDetails,
  updateStripeCustomer,
  setStripeCustomerVatId,
  type StripeCustomerUpdate,
} from "@/lib/integrations/stripe"
import { recordBillingEvent } from "@/lib/billing/audit"

/**
 * Read + correct a client's Stripe customer record from the Hub.
 *
 * Finance needs to fix wrong VAT numbers, addresses, names and emails without
 * opening the Stripe dashboard - a wrong VAT or country silently produces the
 * wrong BTW on every invoice. All writes go straight to Stripe (the single
 * source of truth); the Hub keeps no shadow copy, so the invoice preview and
 * the actual send always reflect the corrected data.
 *
 * Reachable only from role-gated surfaces (client Billing tab requires
 * canViewBilling); we still re-resolve the customer id server-side from the
 * Monday item id so a tampered client can't retarget another customer.
 */
async function resolveCustomerId(mondayItemId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  return (data?.stripe_customer_id as string | null) ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id: mondayItemId } = await params
  const customerId = await resolveCustomerId(mondayItemId)
  if (!customerId) {
    return NextResponse.json({ error: "No Stripe customer linked for this client." }, { status: 404 })
  }
  try {
    const details = await fetchStripeCustomerDetails(customerId)
    return NextResponse.json({ ok: true, details })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Stripe customer" },
      { status: 500 },
    )
  }
}

type PatchBody = {
  name?: string
  email?: string
  address?: {
    line1?: string
    line2?: string
    postalCode?: string
    city?: string
    country?: string
  }
  /** VAT/BTW number. Empty string clears it (→ 20% BG VAT). Undefined = leave
   *  as-is. */
  vatId?: string
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id: mondayItemId } = await params
  const customerId = await resolveCustomerId(mondayItemId)
  if (!customerId) {
    return NextResponse.json({ error: "No Stripe customer linked for this client." }, { status: 404 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const actor = { actorUserId: session.user.id, actorEmail: session.user.email ?? null }

  try {
    // Customer core fields (name / email / address).
    const custUpdate: StripeCustomerUpdate = {}
    if (typeof body.name === "string") custUpdate.name = body.name.trim()
    if (typeof body.email === "string") custUpdate.email = body.email.trim()
    if (body.address) custUpdate.address = body.address
    const hasCoreUpdate =
      custUpdate.name !== undefined || custUpdate.email !== undefined || custUpdate.address !== undefined
    if (hasCoreUpdate) {
      await updateStripeCustomer(customerId, custUpdate)
      await recordBillingEvent({
        action: "customer_updated",
        mondayItemId,
        stripeCustomerId: customerId,
        detail: {
          name: custUpdate.name,
          email: custUpdate.email,
          address: custUpdate.address ?? undefined,
        },
        ...actor,
      })
    }

    // VAT number (separate Stripe object, separate audit line).
    if (typeof body.vatId === "string") {
      await setStripeCustomerVatId(customerId, body.vatId)
      await recordBillingEvent({
        action: "vat_updated",
        mondayItemId,
        stripeCustomerId: customerId,
        detail: { vatId: body.vatId.trim() || null },
        ...actor,
      })
    }

    const details = await fetchStripeCustomerDetails(customerId)
    return NextResponse.json({ ok: true, details })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update Stripe customer" },
      { status: 500 },
    )
  }
}
