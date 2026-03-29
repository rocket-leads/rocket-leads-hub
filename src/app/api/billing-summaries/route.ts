import { auth } from "@/lib/auth"
import { fetchBillingSummary } from "@/lib/integrations/stripe"
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
