import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { fetchBothBoards } from "@/lib/integrations/monday"
import type { DeliveryOverview, AccountManagerRevenue } from "@/types/targets"

async function getStripe(): Promise<Stripe> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "stripe")
    .single()
  if (!data) throw new Error("Stripe token not configured.")
  return new Stripe(decrypt(data.token_encrypted))
}

async function getAllInvoices(stripe: Stripe, startTs: number, endTs: number) {
  const invoices: Stripe.Invoice[] = []
  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const page = await stripe.invoices.list({
      created: { gte: startTs, lte: endTs },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    invoices.push(...page.data.filter((inv) => inv.status !== "draft" && inv.status !== "void"))
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }

  return invoices
}

async function getCustomerFirstInvoiceDates(stripe: Stripe, customerIds: string[]) {
  const firstInvoiceMap = new Map<string, number>()

  for (const customerId of customerIds) {
    if (firstInvoiceMap.has(customerId)) continue
    const page = await stripe.invoices.list({
      customer: customerId,
      limit: 1,
      status: "paid",
    })
    if (page.data.length > 0) {
      firstInvoiceMap.set(customerId, page.data[0].created)
    }
  }

  return firstInvoiceMap
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  try {
    const stripe = await getStripe()
    const startTs = Math.floor(new Date(startDate).getTime() / 1000)
    const endTs = Math.floor(new Date(endDate + "T23:59:59Z").getTime() / 1000)

    // Calculate previous period for churn comparison
    const periodMs = (endTs - startTs) * 1000
    const prevStartTs = startTs - Math.floor(periodMs / 1000)
    const prevEndTs = startTs - 1

    // Fetch current and previous period invoices + Monday data in parallel
    const [currentInvoices, prevInvoices, mondayData] = await Promise.all([
      getAllInvoices(stripe, startTs, endTs),
      getAllInvoices(stripe, prevStartTs, prevEndTs),
      fetchBothBoards(),
    ])

    // Build Stripe customer ID → account manager map from Monday
    const amMap = new Map<string, string>()
    const allClients = [...mondayData.onboarding, ...mondayData.current]
    for (const client of allClients) {
      if (client.stripeCustomerId) {
        amMap.set(client.stripeCustomerId, client.accountManager || "Unassigned")
      }
    }

    // Get unique customer IDs from current period
    const currentCustomerIds = new Set(currentInvoices.map((inv) => inv.customer as string).filter(Boolean))
    const prevCustomerIds = new Set(prevInvoices.map((inv) => inv.customer as string).filter(Boolean))

    // Check which customers are new business (first invoice is in current period)
    const firstInvoiceDates = await getCustomerFirstInvoiceDates(stripe, [...currentCustomerIds])

    // Aggregate revenue per customer
    const customerRevenue = new Map<string, { invoiced: number; isNew: boolean; am: string }>()
    for (const inv of currentInvoices) {
      const custId = inv.customer as string
      if (!custId) continue

      const existing = customerRevenue.get(custId) || { invoiced: 0, isNew: false, am: "Unassigned" }
      existing.invoiced += inv.amount_due / 100
      existing.am = amMap.get(custId) || "Unassigned"

      // If the customer's first ever invoice was created in this period, it's new business
      const firstCreated = firstInvoiceDates.get(custId)
      if (firstCreated && firstCreated >= startTs && firstCreated <= endTs) {
        existing.isNew = true
      }

      customerRevenue.set(custId, existing)
    }

    // Calculate totals
    let mrr = 0
    let newBusiness = 0
    let totalRevenue = 0

    const amRevenue = new Map<string, { revenue: number; customers: number; mrr: number; newBusiness: number }>()

    for (const [, data] of customerRevenue) {
      totalRevenue += data.invoiced
      if (data.isNew) {
        newBusiness += data.invoiced
      } else {
        mrr += data.invoiced
      }

      const amData = amRevenue.get(data.am) || { revenue: 0, customers: 0, mrr: 0, newBusiness: 0 }
      amData.revenue += data.invoiced
      amData.customers++
      if (data.isNew) amData.newBusiness += data.invoiced
      else amData.mrr += data.invoiced
      amRevenue.set(data.am, amData)
    }

    // Churn: customers in previous period but not in current period
    const churned = [...prevCustomerIds].filter((id) => !currentCustomerIds.has(id)).length

    const byAccountManager: AccountManagerRevenue[] = [...amRevenue.entries()]
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .map(([name, data]) => ({ name, ...data }))

    const activeCustomers = currentCustomerIds.size
    const result: DeliveryOverview = {
      mrr,
      newBusiness,
      totalRevenue,
      activeCustomers,
      avgRevenuePerCustomer: activeCustomers > 0 ? totalRevenue / activeCustomers : 0,
      churnRate: prevCustomerIds.size > 0 ? churned / prevCustomerIds.size : 0,
      previousPeriodCustomers: prevCustomerIds.size,
      currentPeriodCustomers: activeCustomers,
      churned,
      byAccountManager,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/delivery]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
