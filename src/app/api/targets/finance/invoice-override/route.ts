import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Manual MRR / New Business reclassification of a Stripe invoice. Persists
 * to `finance_invoice_overrides`; absence of a row means "use auto-detection".
 *
 * - POST  body: { invoiceId, subCategory: "mrr" | "new_business" }   → upsert
 * - DELETE body: { invoiceId }                                       → revert
 *
 * Both invalidate the targets caches (finance MTD + historicals, delivery,
 * marketing/Monday) so the dashboards reflect the new classification on the
 * very next read instead of waiting for the cron.
 */

async function wipeTargetsCaches() {
  try {
    const supabase = await createAdminClient()
    // Same prefix wildcard the assign-customer route uses — covers MTD keys and
    // historical-month variants in one shot.
    await Promise.all([
      supabase.from("cache_store").delete().like("key", "targets_finance%"),
      supabase.from("cache_store").delete().like("key", "targets_delivery%"),
      supabase.from("cache_store").delete().like("key", "targets_marketing_monday%"),
      supabase.from("cache_store").delete().like("key", "targets_monday:%"),
    ])
  } catch (err) {
    console.warn("[invoice-override] cache wipe failed:", err)
  }
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { invoiceId?: string; subCategory?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { invoiceId, subCategory } = body
  if (!invoiceId || typeof invoiceId !== "string") {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 })
  }
  if (subCategory !== "mrr" && subCategory !== "new_business") {
    return NextResponse.json({ error: "subCategory must be 'mrr' or 'new_business'" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const userId = (session.user as { id?: string })?.id ?? null
    const { error } = await supabase
      .from("finance_invoice_overrides")
      .upsert(
        {
          stripe_invoice_id: invoiceId,
          sub_category: subCategory,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_invoice_id" },
      )
    if (error) throw error
  } catch (err) {
    console.error("[invoice-override] upsert failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upsert failed" },
      { status: 500 },
    )
  }

  await wipeTargetsCaches()
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: { invoiceId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { invoiceId } = body
  if (!invoiceId || typeof invoiceId !== "string") {
    return NextResponse.json({ error: "invoiceId required" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from("finance_invoice_overrides")
      .delete()
      .eq("stripe_invoice_id", invoiceId)
    if (error) throw error
  } catch (err) {
    console.error("[invoice-override] delete failed:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 },
    )
  }

  await wipeTargetsCaches()
  return NextResponse.json({ ok: true })
}
