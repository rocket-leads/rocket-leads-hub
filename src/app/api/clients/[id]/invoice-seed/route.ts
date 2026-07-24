import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { getAgreement, agreementMonthly } from "@/lib/clients/agreement"
import { isRocketLeadsAdAccount } from "@/lib/clients/ad-account"

/**
 * Billing seed for the global "Create invoice" flow: given a client picked
 * from the search box, return everything the create-invoice dialog needs to
 * open (Stripe customer, payment date, service fee + ad budget from the
 * agreement). The per-row "Create invoice" on the Billing page already has
 * this data inline; this endpoint provides it for a client picked ad-hoc.
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

  const agreement = await getAgreement(mondayItemId)

  return NextResponse.json({
    ok: true,
    seed: {
      mondayItemId,
      name: client.name,
      stripeCustomerId: client.stripeCustomerId || null,
      cycleStartDate: client.cycleStartDate || null,
      fee: agreementMonthly(agreement),
      // Kept separate so each becomes its own invoice line.
      serviceFee: agreement.platforms.reduce((s, p) => s + (agreement.platform_fees[p] ?? 0), 0),
      followUpFee: agreement.follow_up ? agreement.follow_up_fee : 0,
      adBudget: agreement.ad_budget,
      usesRocketLeadsAdAccount: isRocketLeadsAdAccount(client.metaAdAccountId),
    },
  })
}
