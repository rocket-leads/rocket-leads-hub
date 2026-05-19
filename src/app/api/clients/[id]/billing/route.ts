import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBillingData, type BillingData } from "@/lib/integrations/stripe"
import { readCache, writeCache } from "@/lib/cache"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const stripeCustomerIdParam = req.nextUrl.searchParams.get("stripeCustomerId") ?? ""

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("stripe_customer_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const stripeCustomerId = client?.stripe_customer_id ?? stripeCustomerIdParam
  if (!stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe Customer ID linked for this client." }, { status: 404 })
  }

  // Cron warms `billing:<id>` every 30min — serve from cache regardless of age
  // when present (same pattern as kpi_summaries and billing_summaries). On a
  // cache miss, fall through to live fetch + write so the next reader is fast.
  try {
    const cached = await readCache<BillingData>(`billing:${stripeCustomerId}`)
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
    const fresh = await fetchBillingData(stripeCustomerId)
    void writeCache(`billing:${stripeCustomerId}`, fresh)
    return NextResponse.json(fresh, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch billing data" },
      { status: 500 }
    )
  }
}
