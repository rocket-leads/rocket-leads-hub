import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { fetchOnboardingPaymentStatus } from "@/lib/integrations/stripe"

/**
 * GET /api/clients/[id]/onboarding/payment-status
 *
 * Returns whether the client has paid (any paid invoice on their Stripe
 * customer ID counts). Empty/missing Stripe customer ID resolves to
 * `hasPaid: false` per the product rule that pre-payment clients
 * aren't in Stripe yet.
 *
 * Polled by the wizard's Stap 1 live screen every ~30s while the AM is
 * waiting for payment to land mid-meeting.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const client = await fetchClientById(mondayItemId).catch(() => null)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  const status = await fetchOnboardingPaymentStatus(client.stripeCustomerId || null)
  return NextResponse.json(status)
}
