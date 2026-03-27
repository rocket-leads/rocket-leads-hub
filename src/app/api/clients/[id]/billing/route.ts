import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchBillingData } from "@/lib/stripe-client"
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

  try {
    const data = await fetchBillingData(stripeCustomerId)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch billing data" },
      { status: 500 }
    )
  }
}
