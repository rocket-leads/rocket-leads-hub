import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { fetchMetaTargets, getMtdRange } from "@/lib/targets/fetchers"
import type { MetaTargetsByCountry } from "@/types/targets"

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  const mtd = getMtdRange()
  if (startDate === mtd.startDate && endDate === mtd.endDate) {
    const cached = await readCache<MetaTargetsByCountry>("targets_marketing_meta")
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": "private, s-maxage=60, stale-while-revalidate=300" },
      })
    }
  }

  try {
    const result = await fetchMetaTargets(startDate, endDate)
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
    })
  } catch (error) {
    console.error("[targets/meta]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 })
  }
}
