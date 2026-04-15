"use client"

import { memo } from "react"
import { startOfMonth, differenceInDays, getDaysInMonth, max as dateMax } from "date-fns"
import { Lightbulb, TrendingUp } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatCurrencyDecimal, formatPercent, safeDivide } from "@/lib/targets/formatters"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  range: DateRange
  isLoading: boolean
}

function proRata(monthlyTarget: number, range: DateRange): number {
  if (monthlyTarget <= 0) return 0
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = dateMax([range.startDate, refMonthStart])
  const days = differenceInDays(range.endDate, effectiveStart) + 1
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

interface Insight {
  type: "positive" | "warning" | "critical"
  text: string
}

// ─── The 4 root-cause pillars ───────────────────────────────────────────────
// 1. CBC (creatives, targeting, ad testing)
// 2. Qualification Rate (ICP, messaging, lead form filtering)
// 3. Show-up Rate (reminders, lead warmth, scheduling)
// 4. Conversion Rate (sales quality, proposition, closability)
//
// CPD and ROAS are OUTCOMES of these 4. Never cite CPD/ROAS as a root cause.

interface PillarStatus {
  name: string
  onTrack: boolean
  value: string
  target: string
}

function generateInsights(
  m: MondayTargetsData,
  meta: MetaTargetsData,
  t: TargetsConfig,
  range: DateRange,
): Insight[] {
  const insights: Insight[] = []
  const spend = meta.spend
  const calls = m.calls
  const qualified = m.qualifiedCalls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue

  const prCalls = Math.round(proRata(t.calls, range))
  const prTaken = Math.round(proRata(t.takenCalls, range))
  const prDeals = Math.round(proRata(t.deals, range))

  const cbc = safeDivide(spend, calls)
  const qualRate = safeDivide(qualified, calls)
  const showUpRate = safeDivide(taken, qualified)
  const conversionRate = safeDivide(deals, taken)
  const roas = safeDivide(revenue, spend)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0
  const callsOnTrack = prCalls > 0 && calls >= prCalls

  // Evaluate the 4 pillars
  const cbcOnTrack = t.cbc > 0 ? cbc <= t.cbc : true
  const qualOnTrack = calls > 3 ? qualRate >= 0.75 : true
  const showUpOnTrack = qualified > 3 ? showUpRate >= 0.80 : true
  const convOnTrack = taken > 3 ? conversionRate >= 0.30 : true

  const pillars: PillarStatus[] = [
    { name: "CBC", onTrack: cbcOnTrack, value: formatCurrencyDecimal(cbc), target: t.cbc > 0 ? formatCurrencyDecimal(t.cbc) : "—" },
    { name: "Qualification Rate", onTrack: qualOnTrack, value: formatPercent(qualRate), target: "75%" },
    { name: "Show-up Rate", onTrack: showUpOnTrack, value: formatPercent(showUpRate), target: "80%" },
    { name: "Conversion Rate", onTrack: convOnTrack, value: formatPercent(conversionRate), target: "30%" },
  ]

  const offTrack = pillars.filter((p) => !p.onTrack)
  const onTrack = pillars.filter((p) => p.onTrack)

  // ── Combined pillar insight ──
  if (offTrack.length === 0) {
    insights.push({
      type: "positive",
      text: `All 4 pillars on track: ${onTrack.map((p) => `${p.name} (${p.value})`).join(", ")}. Funnel is healthy.`,
    })
  } else if (offTrack.length <= 2) {
    const offStr = offTrack.map((p) => `${p.name} at ${p.value} (target: ${p.target})`).join(" and ")
    const onStr = onTrack.map((p) => `${p.name} (${p.value})`).join(", ")
    insights.push({
      type: "warning",
      text: `${offStr} ${offTrack.length === 1 ? "is" : "are"} off track. ${onTrack.length > 0 ? `On track: ${onStr}.` : ""}`,
    })
  } else {
    const offStr = offTrack.map((p) => `${p.name} ${p.value}`).join(", ")
    insights.push({
      type: "critical",
      text: `${offTrack.length} of 4 pillars off track (${offStr}). Funnel needs attention across multiple stages.`,
    })
  }

  // ── Ad spend diagnostic (only when CBC is fine but volume is behind) ──
  if (cbcOnTrack && !callsOnTrack && prCalls > 0) {
    const neededSpend = t.cbc * prCalls
    insights.push({
      type: "warning",
      text: `CBC is efficient (${formatCurrencyDecimal(cbc)}) but booked calls are behind (${calls}/${prCalls}). Ad spend of ${formatCurrencyDecimal(spend)} is the bottleneck — need ~${formatCurrencyDecimal(neededSpend)} at current efficiency.`,
    })
  }

  // ── Deal value misalignment ──
  if (deals > 0 && expectedDealValue > 0 && avgDealValue < expectedDealValue * 0.8) {
    insights.push({
      type: "warning",
      text: `Avg deal value is ${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected. Even at ${t.deals} deals/month, revenue would only reach ~${formatCurrency(t.deals * avgDealValue)} — below the ${formatCurrency(t.revenue)} target.`,
    })
  }

  // ── ROAS — trace back to pillars, never cite CPD as root cause ──
  if (spend > 0 && deals > 0) {
    if (roas >= 4) {
      insights.push({ type: "positive", text: `ROAS at ${roas.toFixed(1)}× (target: 4×).` })
    } else {
      // Find the root causes from the 4 pillars
      const rootCauses = offTrack.map((p) => p.name)
      const rootStr = rootCauses.length > 0
        ? `Driven by: ${rootCauses.join(", ").toLowerCase()}.`
        : avgDealValue < expectedDealValue * 0.8
        ? "Driven by: low avg deal value."
        : "Review all 4 funnel pillars."
      insights.push({ type: roas < 3 ? "critical" : "warning", text: `ROAS at ${roas.toFixed(1)}× — below the 4× target. ${rootStr}` })
    }
  }

  return insights
}

function generateProposals(insights: Insight[], m: MondayTargetsData, meta: MetaTargetsData, t: TargetsConfig, range: DateRange): string[] {
  const proposals: string[] = []
  const spend = meta.spend
  const calls = m.calls
  const qualified = m.qualifiedCalls
  const taken = m.takenCalls
  const deals = m.deals
  const revenue = m.closedRevenue
  const cbc = safeDivide(spend, calls)
  const qualRate = safeDivide(qualified, calls)
  const showUpRate = safeDivide(taken, qualified)
  const conversionRate = safeDivide(deals, taken)
  const avgDealValue = deals > 0 ? revenue / deals : 0
  const expectedDealValue = t.deals > 0 && t.revenue > 0 ? t.revenue / t.deals : 0
  const prCalls = t.calls ? Math.round(proRata(t.calls, range)) : 0
  const noShows = qualified - taken

  const cbcOffTrack = t.cbc > 0 && cbc > t.cbc
  const qualOffTrack = calls > 3 && qualRate < 0.75
  const showUpOffTrack = qualified > 3 && showUpRate < 0.80
  const convOffTrack = taken > 3 && conversionRate < 0.30
  const spendIssue = !cbcOffTrack && prCalls > 0 && calls < prCalls
  const dealValueIssue = deals > 0 && expectedDealValue > 0 && avgDealValue < expectedDealValue * 0.8

  // ── Pillar 1: CBC ──
  if (cbcOffTrack) {
    proposals.push(`CBC is ${formatCurrencyDecimal(cbc)} (target: ${formatCurrencyDecimal(t.cbc)}). Iterate on creatives — test new hooks, angles, and formats. Focus on the top-performing ad direction and create 3-5 fresh variations.`)
  }

  // ── Spend issue (CBC fine but volume behind) ──
  if (spendIssue) {
    const neededSpend = t.cbc * prCalls
    proposals.push(`Scale ad spend from ${formatCurrencyDecimal(spend)} to ~${formatCurrencyDecimal(neededSpend)}. CBC is proven at ${formatCurrencyDecimal(cbc)} — the only gap between ${calls} and ${prCalls} booked calls is budget.`)
  }

  // ── Pillar 2: Qualification Rate ──
  if (qualOffTrack) {
    proposals.push(`Qualification rate is ${formatPercent(qualRate)} (target: 75%) — we're reaching people who don't match the ICP. Refine ad messaging to speak directly to the ideal customer profile, use industry-specific angles, and add qualifying questions to the lead form.`)
  }

  // ── Pillar 3: Show-up Rate ──
  if (showUpOffTrack) {
    proposals.push(`Show-up rate is ${formatPercent(showUpRate)} — ${noShows} no-shows from ${qualified} qualified leads. WhatsApp reminders are already active — audit their delivery timing and open rates. Consider a personal confirmation call 2h before the appointment, and check if leads can book too far ahead (reducing urgency).`)
  }

  // ── Pillar 4: Conversion Rate ──
  if (convOffTrack) {
    proposals.push(`Conversion rate is ${formatPercent(conversionRate)} (target: 30%) — ${taken} taken calls resulted in only ${deals} deals. Review: are leads ICP-fit and closeable? Is the sales proposition strong enough? Evaluate the sales team's close technique and whether pricing/packaging needs adjustment.`)
  }

  // ── Deal value issue ──
  if (dealValueIssue) {
    proposals.push(`Avg deal value is ${formatCurrency(avgDealValue)} vs ${formatCurrency(expectedDealValue)} expected. Revenue target can't be hit on volume alone. Steer sales towards HTO packages or review discounting practices.`)
  }

  // ── Everything on track ──
  if (!cbcOffTrack && !qualOffTrack && !showUpOffTrack && !convOffTrack && !spendIssue && !dealValueIssue) {
    proposals.push("All 4 pillars and deal value are on track. Iterate on winning creatives — same direction, fresh executions to stay ahead of ad fatigue.")
    proposals.push("Test a secondary marketing angle alongside the winner to build pipeline diversification for next month.")
  }

  return proposals
}

export const MarketingInsights = memo(function MarketingInsights({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card rounded-lg p-4 border border-border/40">
          <Skeleton className="h-4 w-32 mb-3" />
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border/40">
          <Skeleton className="h-4 w-40 mb-3" />
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        </div>
      </div>
    )
  }

  if (!monday || !meta || !targets) return null

  const insights = generateInsights(monday, meta, targets, range)
  const proposals = generateProposals(insights, monday, meta, targets, range)

  const dotColor = (type: Insight["type"]) =>
    type === "positive" ? "bg-green-500" : type === "warning" ? "bg-yellow-500" : "bg-red-500"

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* Key Insights */}
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Key Insights</h3>
        </div>
        <div className="space-y-2.5">
          {insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${dotColor(insight.type)}`} />
              <span className="text-xs text-foreground/90 leading-relaxed">{insight.text}</span>
            </div>
          ))}
          {insights.length === 0 && (
            <span className="text-xs text-muted-foreground">Set targets in Settings to enable insights.</span>
          )}
        </div>
      </div>

      {/* Optimisation Proposal */}
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Optimisation Proposal</h3>
        </div>
        <div className="space-y-2.5">
          {proposals.map((proposal, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="text-xs text-muted-foreground/60 font-mono shrink-0">{i + 1}.</span>
              <span className="text-xs text-foreground/90 leading-relaxed">{proposal}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
