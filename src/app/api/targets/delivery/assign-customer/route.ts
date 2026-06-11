import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchClientById, parseStripeCustomerIds, setItemColumnValue } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Appends a Stripe customer ID to a Monday item's `stripe_customer_id` column.
 * One Monday item can hold multiple comma-separated IDs - needed for clients
 * that bill through more than one Stripe customer (entity changes, alt payment
 * methods). Also wipes the delivery cache (MTD + historical months) so the new
 * attribution shows up immediately instead of waiting for cron.
 *
 * Performance: when the client passes `existingStripeIds` (the value already
 * shown on screen), we skip the extra Monday read and write directly. Saves
 * a sequential round-trip per click - assignments that used to take 4-6s now
 * complete in 1-2s. Falls back to a Monday read if `existingStripeIds` is null.
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: {
    stripeCustomerId?: string
    mondayItemId?: string
    boardType?: "onboarding" | "current"
    existingStripeIds?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { stripeCustomerId, mondayItemId, boardType, existingStripeIds } = body
  if (!stripeCustomerId || !mondayItemId || (boardType !== "onboarding" && boardType !== "current")) {
    return NextResponse.json(
      { error: "Required: stripeCustomerId, mondayItemId, boardType ('onboarding' | 'current')" },
      { status: 400 },
    )
  }

  try {
    let existingRaw: string | null | undefined = existingStripeIds
    // Fallback path - only when the client didn't pass existingStripeIds (shouldn't
    // happen from our own UI, but defensive against direct API callers).
    if (existingRaw == null) {
      const existing = await fetchClientById(mondayItemId).catch(() => null)
      existingRaw = existing?.stripeCustomerId ?? ""
    }
    const existingIds = parseStripeCustomerIds(existingRaw)
    if (!existingIds.includes(stripeCustomerId)) {
      const merged = [...existingIds, stripeCustomerId].join(", ")
      await setItemColumnValue(boardType, mondayItemId, "stripe_customer_id", merged)
    }
  } catch (error) {
    console.error("[assign-customer] Monday update failed:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update Monday" },
      { status: 500 },
    )
  }

  // Drop every delivery cache entry - both MTD (`targets_delivery`) and historical
  // months (`targets_delivery:YYYY-MM`). The new AM attribution applies retroactively
  // since the customer-to-AM map is current-state regardless of which period you view.
  try {
    const supabase = await createAdminClient()
    await supabase.from("cache_store").delete().like("key", "targets_delivery%")
  } catch (error) {
    // Cache wipe failure is non-fatal - next ?refresh=1 or cron pass corrects it.
    console.warn("[assign-customer] cache wipe failed:", error)
  }

  return NextResponse.json({ ok: true })
}
