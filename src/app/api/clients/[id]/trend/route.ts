import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { NextResponse, type NextRequest } from "next/server"
import type { KpiDailyClientData } from "@/app/api/kpi-summaries/route"

/**
 * Per-client daily trend - the data behind the CPL + Ad Spend line chart
 * on the client detail home tab. Reads the 120d `kpi_daily:<id>` cache
 * written by the daily cron and slices to the requested window.
 *
 * Returned shape is per-day with both metrics pre-computed:
 *   - spend: post campaign-filter daily Meta spend
 *   - leads: Monday-reported leads when Monday CRM is linked, else Meta leads
 *   - cpl:   spend / leads, null when leads == 0 (chart skips the point)
 *
 * Days are dense (zero-filled by the cron) so the chart renders continuous
 * lines without gap-fill logic. CPL is null on zero-lead days so Recharts
 * draws a break instead of a misleading €0 dot.
 */

const ALLOWED_WINDOWS = [14, 30, 90] as const
type AllowedWindow = (typeof ALLOWED_WINDOWS)[number]

export type TrendPoint = {
  date: string         // YYYY-MM-DD
  spend: number        // EUR
  leads: number
  cpl: number | null   // EUR; null when leads == 0
}

export type TrendResponse = {
  mondayItemId: string
  windowDays: AllowedWindow
  /** True when Monday CRM is linked - leads come from Monday. Else from Meta. */
  mondayCrmConnected: boolean
  /** True when the client uses the RL ad account but no campaigns are selected. */
  rlAccountNoCampaign: boolean
  /** Dense daily entries, oldest first. */
  points: TrendPoint[]
}

function isAllowedWindow(n: number): n is AllowedWindow {
  return (ALLOWED_WINDOWS as ReadonlyArray<number>).includes(n)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  if (!mondayItemId?.trim()) {
    return NextResponse.json({ error: "mondayItemId required" }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const daysParam = Number.parseInt(searchParams.get("days") ?? "30", 10)
  const windowDays: AllowedWindow = isAllowedWindow(daysParam) ? daysParam : 30

  // Per-client cache key is populated by the daily refresh-cache cron.
  // Missing cache = empty trend (chart shows "no data yet" state).
  const cached = await readCache<KpiDailyClientData>(`kpi_daily:${mondayItemId}`)
  if (!cached) {
    return NextResponse.json<TrendResponse>({
      mondayItemId,
      windowDays,
      mondayCrmConnected: false,
      rlAccountNoCampaign: false,
      points: [],
    })
  }

  // Slice to the last N days. Days array is already dense + chronological.
  const slice = cached.days.slice(-windowDays)

  const points: TrendPoint[] = slice.map((d) => {
    const leads = cached.mondayCrmConnected ? d.mondayLeads : d.metaLeads
    const cpl = leads > 0 ? d.spend / leads : null
    return {
      date: d.date,
      spend: Number(d.spend.toFixed(2)),
      leads,
      cpl: cpl != null ? Number(cpl.toFixed(2)) : null,
    }
  })

  return NextResponse.json<TrendResponse>({
    mondayItemId,
    windowDays,
    mondayCrmConnected: cached.mondayCrmConnected,
    rlAccountNoCampaign: cached.rlAccountNoCampaign ?? false,
    points,
  })
}
