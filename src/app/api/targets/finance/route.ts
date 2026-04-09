import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import Stripe from "stripe"
import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import type { FinanceOverview } from "@/types/targets"

// Keywords for categorizing Stripe line items
const AD_BUDGET_KEYWORDS = [
  "advertentiebudget", "advertising budget", "adspend", "ad spend",
  "ad budget", "mediabudget", "media budget", "budget",
]

const SERVICE_FEE_KEYWORDS = [
  "service fee", "management fee", "service", "management",
  "fee", "maandelijkse", "monthly", "retainer",
]

function categorizeLineItem(description: string | null): "ad_budget" | "service_fee" | "unknown" {
  if (!description) return "unknown"
  const lower = description.toLowerCase()
  if (AD_BUDGET_KEYWORDS.some((kw) => lower.includes(kw))) return "ad_budget"
  if (SERVICE_FEE_KEYWORDS.some((kw) => lower.includes(kw))) return "service_fee"
  return "unknown"
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

    // Fetch invoices created in period (for "invoiced" amount)
    let invoiced = 0
    let open = 0
    let overdue = 0
    let invoiceCount = 0
    const byCategory = { serviceFee: 0, adBudget: 0, unknown: 0 }
    const now = Math.floor(Date.now() / 1000)

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
        const amount = inv.amount_due / 100
        invoiced += amount

        if (inv.status === "open") {
          if (inv.due_date && inv.due_date < now) {
            overdue += amount
          } else {
            open += amount
          }
        }

        // Categorize by line items
        for (const line of inv.lines?.data ?? []) {
          const cat = categorizeLineItem(line.description)
          const lineAmount = line.amount / 100
          if (cat === "ad_budget") byCategory.adBudget += lineAmount
          else if (cat === "service_fee") byCategory.serviceFee += lineAmount
          else byCategory.unknown += lineAmount
        }
      }

      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }

    // Fetch cash collected (successful charges in period)
    let cashCollected = 0
    hasMore = true
    startingAfter = undefined

    while (hasMore) {
      const page: Awaited<ReturnType<typeof stripe.charges.list>> = await stripe.charges.list({
        created: { gte: startTs, lte: endTs },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      })

      for (const charge of page.data) {
        if (charge.status === "succeeded" && !charge.refunded) {
          cashCollected += charge.amount / 100
        }
      }

      hasMore = page.has_more
      startingAfter = page.data[page.data.length - 1]?.id
    }

    const result: FinanceOverview = {
      invoiced,
      cashCollected,
      open,
      overdue,
      invoiceCount,
      byCategory,
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/finance]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
