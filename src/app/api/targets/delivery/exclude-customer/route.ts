import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Customer-level "not Rocket Leads revenue" flag. A row in
 * `finance_excluded_customers` strips that Stripe customer's invoices + credit
 * notes from every revenue surface (Finance totals, Delivery attribution, churn).
 *
 * - POST   body: { stripeCustomerId, customerName? }  → exclude
 * - DELETE body: { stripeCustomerId }                 → restore
 *
 * Both wipe the finance + delivery + monday target caches (MTD and historical
 * months) so the number moves on the very next read instead of waiting for cron.
 */

async function wipeRevenueCaches() {
  try {
    const supabase = await createAdminClient()
    await Promise.all([
      supabase.from("cache_store").delete().like("key", "targets_finance%"),
      supabase.from("cache_store").delete().like("key", "targets_delivery%"),
      supabase.from("cache_store").delete().like("key", "targets_marketing_monday%"),
      supabase.from("cache_store").delete().like("key", "targets_monday:%"),
    ])
  } catch (err) {
    console.warn("[exclude-customer] cache wipe failed:", err)
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { stripeCustomerId?: string; customerName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { stripeCustomerId, customerName } = body
  if (!stripeCustomerId || typeof stripeCustomerId !== "string") {
    return NextResponse.json({ error: "stripeCustomerId required" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const userId = (session.user as { id?: string })?.id ?? null
    const { error } = await supabase
      .from("finance_excluded_customers")
      .upsert(
        {
          stripe_customer_id: stripeCustomerId,
          customer_name: customerName ?? null,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_customer_id" },
      )
    if (error) throw error
  } catch (err) {
    console.error("[exclude-customer] upsert failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upsert failed" },
      { status: 500 },
    )
  }

  await wipeRevenueCaches()
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { stripeCustomerId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { stripeCustomerId } = body
  if (!stripeCustomerId || typeof stripeCustomerId !== "string") {
    return NextResponse.json({ error: "stripeCustomerId required" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from("finance_excluded_customers")
      .delete()
      .eq("stripe_customer_id", stripeCustomerId)
    if (error) throw error
  } catch (err) {
    console.error("[exclude-customer] delete failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    )
  }

  await wipeRevenueCaches()
  return NextResponse.json({ ok: true })
}
