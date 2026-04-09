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

  // Serve from cache — cron keeps it fresh every 30 min
  const cached = await readCache<Record<string, BillingSummary>>("billing_summaries")
  if (cached) {
    const summaries: Record<string, BillingSummary> = {}
    for (const id of customerIds) {
      if (cached[id]) summaries[id] = cached[id]
    }
    if (Object.keys(summaries).length > 0) {
      return NextResponse.json(summaries, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  // No cache at all — fetch live (first load only)
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
