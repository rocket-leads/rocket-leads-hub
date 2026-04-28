"use client"

import { memo } from "react"
import { ArrowDown, ArrowUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrencyDecimal, formatPercent, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig } from "@/types/targets"

type Status = "good" | "bad" | "neutral"

interface PillarCardProps {
  label: string
  value: string
  subtitle: string
  status: Status
  trendIcon?: "up" | "down" | "flat"
}

function PillarCard({ label, value, subtitle, status, trendIcon }: PillarCardProps) {
  const valueColor = status === "good" ? "text-green-500" : status === "bad" ? "text-red-500" : "text-foreground"
  const Trend = trendIcon === "up" ? ArrowUp : trendIcon === "down" ? ArrowDown : Minus
  const trendColor = trendIcon === "up" ? "text-green-500" : trendIcon === "down" ? "text-red-500" : "text-muted-foreground/40"
  return (
    <div className="bg-card rounded-lg p-5 border border-border/40 flex flex-col gap-2 h-full">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
        {trendIcon && <Trend className={cn("h-3.5 w-3.5", trendColor)} strokeWidth={2.5} />}
      </div>
      <span className={cn("text-3xl font-bold font-mono leading-none tracking-tight", valueColor)}>{value}</span>
      <span className="text-xs text-muted-foreground leading-relaxed">{subtitle}</span>
    </div>
  )
}

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  isLoading: boolean
}

export const HeroPillars = memo(function HeroPillars({ monday, meta, targets, isLoading }: Props) {
  if (isLoading || !monday || !meta) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-card rounded-lg p-5 border border-border/40">
            <Skeleton className="h-3 w-20 mb-3" />
            <Skeleton className="h-8 w-24 mb-3" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    )
  }

  const spend = meta.spend
  const calls = monday.calls
  const qualified = monday.qualifiedCalls
  const taken = monday.takenCalls
  const deals = monday.deals

  const cbc = safeDivide(spend, calls)
  const qualRate = safeDivide(qualified, calls)
  const showUpRate = safeDivide(taken, qualified)
  const convRate = safeDivide(deals, taken)

  const derived = deriveTargets(targets ?? null)
  const cbcTarget = targets?.cbc ?? 0
  const qualRateTarget = derived.qualRate
  const showUpRateTarget = derived.showUpRate
  const convRateTarget = derived.convRate

  // ── 1. CBC (Cost per Booked Call) — the lead-volume driver ──
  const cbcStatus: Status = (cbcTarget === 0 || calls < 4) ? "neutral" : cbc <= cbcTarget ? "good" : "bad"
  const cbcTrend: PillarCardProps["trendIcon"] = (cbcTarget === 0 || calls < 4)
    ? "flat"
    : cbc <= cbcTarget * 0.95 ? "up" : cbc > cbcTarget * 1.05 ? "down" : "flat"
  const cbcSubtitle = cbcTarget > 0
    ? `target ${formatCurrencyDecimal(cbcTarget)} · ${calls} booked`
    : calls > 0
    ? `${calls} booked · set CBC target`
    : "No booked calls yet"

  // ── 2. Qualification Rate — audience match ──
  const qualStatus: Status = (qualRateTarget === 0 || calls < 4) ? "neutral" : qualRate >= qualRateTarget ? "good" : "bad"
  const qualTrend: PillarCardProps["trendIcon"] = (qualRateTarget === 0 || calls < 4)
    ? "flat"
    : qualRate >= qualRateTarget * 1.05 ? "up" : qualRate < qualRateTarget * 0.95 ? "down" : "flat"
  const qualSubtitle = qualRateTarget > 0
    ? `target ${formatPercent(qualRateTarget)} · ${qualified}/${calls}`
    : calls > 0
    ? `${qualified}/${calls} leads qualified`
    : "—"

  // ── 3. Show-up Rate — lead warmth & reminders ──
  const showUpStatus: Status = (showUpRateTarget === 0 || qualified < 4) ? "neutral" : showUpRate >= showUpRateTarget ? "good" : "bad"
  const showUpTrend: PillarCardProps["trendIcon"] = (showUpRateTarget === 0 || qualified < 4)
    ? "flat"
    : showUpRate >= showUpRateTarget * 1.05 ? "up" : showUpRate < showUpRateTarget * 0.95 ? "down" : "flat"
  const showUpSubtitle = showUpRateTarget > 0
    ? `target ${formatPercent(showUpRateTarget)} · ${taken}/${qualified}`
    : qualified > 0
    ? `${taken}/${qualified} showed up`
    : "—"

  // ── 4. Conversion Rate — sales team ──
  const convStatus: Status = (convRateTarget === 0 || taken < 4) ? "neutral" : convRate >= convRateTarget ? "good" : "bad"
  const convTrend: PillarCardProps["trendIcon"] = (convRateTarget === 0 || taken < 4)
    ? "flat"
    : convRate >= convRateTarget * 1.05 ? "up" : convRate < convRateTarget * 0.95 ? "down" : "flat"
  const convSubtitle = convRateTarget > 0
    ? `target ${formatPercent(convRateTarget)} · ${deals}/${taken}`
    : taken > 0
    ? `${deals}/${taken} closed`
    : "—"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <PillarCard
        label="Cost per Booked Call"
        value={calls > 0 ? formatCurrencyDecimal(cbc) : "—"}
        subtitle={cbcSubtitle}
        status={cbcStatus}
        trendIcon={cbcTrend}
      />
      <PillarCard
        label="Qualification Rate"
        value={calls > 0 ? formatPercent(qualRate) : "—"}
        subtitle={qualSubtitle}
        status={qualStatus}
        trendIcon={qualTrend}
      />
      <PillarCard
        label="Show-up Rate"
        value={qualified > 0 ? formatPercent(showUpRate) : "—"}
        subtitle={showUpSubtitle}
        status={showUpStatus}
        trendIcon={showUpTrend}
      />
      <PillarCard
        label="Conversion Rate"
        value={taken > 0 ? formatPercent(convRate) : "—"}
        subtitle={convSubtitle}
        status={convStatus}
        trendIcon={convTrend}
      />
    </div>
  )
})
