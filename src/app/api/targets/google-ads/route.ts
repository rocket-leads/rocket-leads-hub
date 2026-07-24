import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchGoogleAdsSpend } from "@/lib/targets/fetchers"

// Google Ads spend comes from a Google Sheet (Actual tab). A single sheet read
// is fast, so no historical/warm cache layer here - a short s-maxage covers
// bursts. fetchGoogleAdsSpend never throws (it returns { spend: 0, error } on
// failure) so the Marketing tab degrades to Meta-only spend if the sheet isn't
// shared with the service account yet.
export const maxDuration = 60

export async function GET(request: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 })
  }

  const result = await fetchGoogleAdsSpend(startDate, endDate)
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, s-maxage=300, stale-while-revalidate=600" },
  })
}
