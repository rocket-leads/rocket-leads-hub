import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchInvoicedAdBudget } from "@/lib/stripe-client"
import { fetchMetaInsights } from "@/lib/meta"
import { isRocketLeadsAdAccount } from "@/lib/ad-account"
import { NextRequest, NextResponse } from "next/server"

export type AdBudgetBalance = {
  invoicedTotal: number
  actualSpendTotal: number
  balance: number
  lineItems: Array<{
    invoiceNumber: string | null
    date: number
    description: string
    amount: number
  }>
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id: mondayItemId } = await params
  const stripeCustomerIdParam = req.nextUrl.searchParams.get("stripeCustomerId") ?? ""
  const adAccountIdParam = req.nextUrl.searchParams.get("adAccountId") ?? ""

  const supabase = await createAdminClient()
  const { data: client } = await supabase
    .from("clients")
    .select("stripe_customer_id, meta_ad_account_id")
    .eq("monday_item_id", mondayItemId)
    .single()

  const stripeCustomerId = client?.stripe_customer_id ?? stripeCustomerIdParam
  const adAccountId = client?.meta_ad_account_id ?? adAccountIdParam

  if (!isRocketLeadsAdAccount(adAccountId)) {
    return NextResponse.json({ error: "Not a Rocket Leads ad account client" }, { status: 400 })
  }

  if (!stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe Customer ID linked" }, { status: 404 })
  }

  // Fetch invoiced ad budget and total actual Meta spend in parallel
  const [invoiced, insights] = await Promise.all([
    fetchInvoicedAdBudget(stripeCustomerId),
    adAccountId
      ? fetchMetaInsights(adAccountId, "2020-01-01", new Date().toISOString().slice(0, 10)).catch(() => [])
      : Promise.resolve([]),
  ])

  const actualSpendTotal = insights.reduce((sum, i) => sum + i.spend, 0)
  const balance = invoiced.totalInvoiced - actualSpendTotal

  return NextResponse.json({
    invoicedTotal: invoiced.totalInvoiced,
    actualSpendTotal,
    balance,
    lineItems: invoiced.lineItems,
  } satisfies AdBudgetBalance)
}
