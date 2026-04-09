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

const SERVICE_FEE_KEYWORDS = [
  "service fee", "management fee", "service", "management",
  "fee", "maandelijkse", "monthly", "retainer",
]

function categorizeLineItem(description: string | null): "ad_budget" | "service_fee" {
  if (!description) return "service_fee"
  const lower = description.toLowerCase()
  if (AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))) return "ad_budget"
  // Default to service fee (including unknown) since most revenue is service
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

    const serviceFee = emptyBreakdown()
    const adBudget = emptyBreakdown()
    const total = emptyBreakdown()
    let invoiceCount = 0

    // Fetch all invoices created in period
    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const page = await stripe.invoices.list({
        created: { gte: startTs, lte: endTs },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })

      for (const inv of page.data) {
        if (inv.status === "draft" || inv.status === "void") continue
        invoiceCount++

        const isOverdue = inv.status === "open" && inv.due_date && inv.due_date < now
        const isOpen = inv.status === "open" && !isOverdue
        const isPaid = inv.status === "paid"

        // Categorize each line item
        for (const line of inv.lines?.data ?? []) {
          const cat = categorizeLineItem(line.description)
          const amount = line.amount / 100
          const bucket = cat === "ad_budget" ? adBudget : serviceFee

          bucket.invoiced += amount
          total.invoiced += amount

          if (isPaid) {
            bucket.cashCollected += amount
            total.cashCollected += amount
          } else if (isOverdue) {
            bucket.overdue += amount
            total.overdue += amount
          } else if (isOpen) {
            bucket.open += amount
            total.open += amount
          }
        }
      }

      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }

    const result: FinanceOverview = { total, serviceFee, adBudget, invoiceCount }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/finance]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
