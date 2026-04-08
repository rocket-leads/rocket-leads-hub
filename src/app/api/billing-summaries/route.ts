import { auth } from "@/lib/auth"
import { fetchBillingSummary } from "@/lib/integrations/stripe"
import { readCache } from "@/lib/cache"
import { NextRequest, NextResponse } from "next/server"
import type { BillingSummary } from "@/lib/integrations/stripe"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ids = req.nextUrl.searchParams.get("customerIds") ?? ""
  const customerIds = ids.split(",").map((s) => s.trim()).filter(Boolean)

  if (customerIds.length === 0) {
    return NextResponse.json({})
  }

  // Try cache first — return cached data if fresh
  const cached = await readCache<Record<string, BillingSummary>>("billing_summaries")
  if (cached) {
    const result: Record<string, BillingSummary> = {}
    let allHit = true
    for (const id of customerIds) {
      if (cached[id]) {
        result[id] = cached[id]
      } else {
        allHit = false
        break
      }
    }
    if (allHit) {
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // Cache miss — fetch live from Stripe
  const results = await Promise.allSettled(customerIds.map((id) => fetchBillingSummary(id)))

  const summaries: Record<string, BillingSummary> = {}
  results.forEach((result, i) => {
    if (result.status === "fulfilled") {
      summaries[customerIds[i]] = result.value
    }
  })

  return NextResponse.json(summaries, {
    headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
  })
}
