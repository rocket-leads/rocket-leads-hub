import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { debugGoogleAdsSheet } from "@/lib/targets/fetchers"

// Admin-only diagnostic for the Google Ads spend sheet. Answers "the sheet says
// ~€1k but Google says ~€2.5k" by dumping what the reader actually sees: the
// header/layout, per-column in-range sums (to spot spend living in C/D/E instead
// of B, or split across columns), the exact in-range rows, and any rows dropped
// because their date cell didn't parse. Open with ?startDate=YYYY-MM-DD&endDate=…
// (defaults to month-to-date).
export const maxDuration = 60

function defaultRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { startDate: fmt(start), endDate: fmt(now) }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 401 })
  }

  const def = defaultRange()
  const startDate = req.nextUrl.searchParams.get("startDate") || def.startDate
  const endDate = req.nextUrl.searchParams.get("endDate") || def.endDate

  try {
    const result = await debugGoogleAdsSheet(startDate, endDate)
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "debug failed" },
      { status: 500 },
    )
  }
}
