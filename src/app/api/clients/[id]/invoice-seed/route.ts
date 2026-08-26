import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { parseEuro } from "@/lib/clients/agreement"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"

/**
 * Billing seed for the global "Create invoice" flow: given a client picked
 * from the search box, return everything the create-invoice dialog needs to
 * open (Stripe customer, payment date, service fee + ad budget). All money
 * fields are read LIVE from Monday (not the Supabase agreement store) so the
 * seeded invoice matches the board 1:1 - same source as the per-row Billing
 * page. See src/app/(dashboard)/billing/page.tsx for the rationale.
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

  const client = await fetchClientById(mondayItemId)
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 })
  }

  // Monday-live money fields (see billing/page.tsx for the full rationale):
  //   service fee   = "Monthly fee"   (service_fee column)
  //   follow-up fee = "Followup Fee"  (billed whenever filled)
  //   ad budget     = "Adbudget RL"   (billed whenever filled)
  const serviceFee = parseEuro(client.serviceFee)
  const followUpFee = parseEuro(client.followUpFee)

  return NextResponse.json({
    ok: true,
    seed: {
      mondayItemId,
      name: client.name,
      stripeCustomerId: client.stripeCustomerId || null,
      cycleStartDate: client.cycleStartDate || null,
      fee: serviceFee + followUpFee,
      // Kept separate so each becomes its own invoice line.
      serviceFee,
      followUpFee,
      adBudget: parseEuro(client.adBudgetRl),
      usesRocketLeadsAdAccount: isRocketLeadsAdAccount(client.metaAdAccountId),
    },
  })
}
