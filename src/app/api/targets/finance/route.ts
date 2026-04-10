import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { FinanceOverview, CategoryBreakdown } from "@/types/targets"

const AD_BUDGET_KEYWORDS = [
  "advertentiebudget", "advertising budget", "adspend", "ad spend",
  "ad budget", "mediabudget", "media budget", "budget",
]

function categorizeLineItem(description: string | null): "ad_budget" | "service_fee" {
  if (!description) return "service_fee"
  const lower = description.toLowerCase()
  if (AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))) return "ad_budget"
  return "service_fee"
}

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

function emptyBreakdown(): CategoryBreakdown {
  return { invoiced: 0, cashCollected: 0, open: 0, overdue: 0 }
}

function addToBreakdown(bucket: CategoryBreakdown, amount: number, isPaid: boolean, isOverdue: boolean, isOpen: boolean) {
  bucket.invoiced += amount
  if (isPaid) bucket.cashCollected += amount
  else if (isOverdue) bucket.overdue += amount
  else if (isOpen) bucket.open += amount
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
    const now = Math.floor(Date.now() / 1000)

    // Collect all invoices in the period
    const allInvoices: Stripe.Invoice[] = []
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const page = await stripe.invoices.list({
        created: { gte: startTs, lte: endTs },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })
      for (const inv of page.data) {
        if (inv.status !== "draft" && inv.status !== "void") {
          allInvoices.push(inv)
        }
      }
      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }

    // For each unique customer, check if they have any invoice BEFORE this period
    // If not, all their invoices in this period are "new business"
    const customerIds = [...new Set(allInvoices.map((inv) => inv.customer as string).filter(Boolean))]
    const isNewBusinessCustomer = new Map<string, boolean>()

    for (const customerId of customerIds) {
      // Check if any invoice exists before the start of the period
      const earlier = await stripe.invoices.list({
        customer: customerId,
        created: { lt: startTs },
        limit: 1,
      })
      const hasEarlier = earlier.data.some((inv) => inv.status !== "draft" && inv.status !== "void")
      isNewBusinessCustomer.set(customerId, !hasEarlier)
    }

    // Now aggregate
    const total = emptyBreakdown()
    const serviceFee = emptyBreakdown()
    const serviceFeeNewBusiness = emptyBreakdown()
    const serviceFeeMrr = emptyBreakdown()
    const adBudget = emptyBreakdown()

    for (const inv of allInvoices) {
      const isOverdue = inv.status === "open" && inv.due_date != null && inv.due_date < now
      const isOpen = inv.status === "open" && !isOverdue
      const isPaid = inv.status === "paid"
      const custId = inv.customer as string
      const isNew = isNewBusinessCustomer.get(custId) ?? false

      for (const line of inv.lines?.data ?? []) {
        const cat = categorizeLineItem(line.description)
        const amount = line.amount / 100

        addToBreakdown(total, amount, isPaid, isOverdue, isOpen)

        if (cat === "ad_budget") {
          addToBreakdown(adBudget, amount, isPaid, isOverdue, isOpen)
        } else {
          addToBreakdown(serviceFee, amount, isPaid, isOverdue, isOpen)
          if (isNew) {
            addToBreakdown(serviceFeeNewBusiness, amount, isPaid, isOverdue, isOpen)
          } else {
            addToBreakdown(serviceFeeMrr, amount, isPaid, isOverdue, isOpen)
          }
        }
      }
    }

    const result: FinanceOverview = {
      total, serviceFee, serviceFeeNewBusiness, serviceFeeMrr,
      adBudget, invoiceCount: allInvoices.length,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/finance]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
