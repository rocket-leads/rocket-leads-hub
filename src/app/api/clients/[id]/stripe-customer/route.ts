import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import {
  fetchStripeCustomerDetails,
  updateStripeCustomer,
  setStripeCustomerVatId,
  type StripeCustomerUpdate,
  type StripeCustomerDetails,
} from "@/lib/integrations/stripe"
import { parseStripeCustomerIds } from "@/lib/integrations/monday"
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
 * A client should have exactly ONE Stripe customer, but the field can hold
 * multiple comma-separated IDs (legacy data / entity changes). When it does,
 * GET returns them all with their company details so the Billing tab can flag
 * it and let finance pick the correct one (which replaces the other via the
 * normal client-field PATCH). Edits are blocked until it's resolved to one.
 *
 * Reachable only from role-gated surfaces (client Billing tab requires
 * canViewBilling); we still re-resolve the customer id server-side from the
 * Monday item id so a tampered client can't retarget another customer.
 */
async function resolveCustomerIds(mondayItemId: string): Promise<string[]> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  return parseStripeCustomerIds((data?.stripe_customer_id as string | null) ?? null)
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
  const ids = await resolveCustomerIds(mondayItemId)
  if (ids.length === 0) {
    return NextResponse.json({ error: "No Stripe customer linked for this client." }, { status: 404 })
  }
  try {
    // More than one linked → return each customer's details so finance can
    // tell them apart and pick the right one. Best-effort per id: a deleted /
    // unknown id still lists (with nulls) so it can be picked away.
    if (ids.length > 1) {
      const settled = await Promise.all(
        ids.map(async (id): Promise<StripeCustomerDetails> => {
          try {
            return await fetchStripeCustomerDetails(id)
          } catch {
            return {
              id,
              name: null,
              email: null,
              address: { line1: null, line2: null, postalCode: null, city: null, country: null },
              taxId: null,
            }
          }
        }),
      )
      return NextResponse.json({ ok: true, multiple: settled })
    }
    const details = await fetchStripeCustomerDetails(ids[0])
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
  const ids = await resolveCustomerIds(mondayItemId)
  if (ids.length === 0) {
    return NextResponse.json({ error: "No Stripe customer linked for this client." }, { status: 404 })
  }
  // Can't edit customer fields when it's ambiguous which customer is meant.
  if (ids.length > 1) {
    return NextResponse.json(
      { error: "This client has multiple Stripe customers linked. Pick the correct one first." },
      { status: 409 },
    )
  }
  const customerId = ids[0]

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
