import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { fetchDelivery, getMtdRange } from "@/lib/targets/fetchers"
import type { DeliveryOverview } from "@/types/targets"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  // Cache hit only for MTD
  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate) {
    const cached = await readCache<DeliveryOverview>("targets_delivery")
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  try {
    const result = await fetchDelivery(startDate, endDate)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=120" },
    })
  } catch (error) {
    console.error("[targets/delivery]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
