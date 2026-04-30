import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { setItemColumnValue } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Writes a Stripe customer ID into a Monday item's `stripe_customer_id` column so
 * the Delivery dashboard can attribute that customer's revenue to the right AM on
 * the next refresh. Also wipes the delivery cache (MTD + historical months) so
 * the new mapping is reflected immediately instead of waiting for cron.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { stripeCustomerId?: string; mondayItemId?: string; boardType?: "onboarding" | "current" }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { stripeCustomerId, mondayItemId, boardType } = body
  if (!stripeCustomerId || !mondayItemId || (boardType !== "onboarding" && boardType !== "current")) {
    return NextResponse.json(
      { error: "Required: stripeCustomerId, mondayItemId, boardType ('onboarding' | 'current')" },
      { status: 400 },
    )
  }

  try {
    await setItemColumnValue(boardType, mondayItemId, "stripe_customer_id", stripeCustomerId)
  } catch (error) {
    console.error("[assign-customer] Monday update failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Monday" },
      { status: 500 },
    )
  }

  // Drop every delivery cache entry — both MTD (`targets_delivery`) and historical
  // months (`targets_delivery:YYYY-MM`). The new AM attribution applies retroactively
  // since the customer-to-AM map is current-state regardless of which period you view.
  try {
    const supabase = await createAdminClient()
    await supabase.from("cache_store").delete().like("key", "targets_delivery%")
  } catch (error) {
    // Cache wipe failure is non-fatal — next ?refresh=1 or cron pass corrects it.
    console.warn("[assign-customer] cache wipe failed:", error)
  }

  return NextResponse.json({ ok: true })
}
