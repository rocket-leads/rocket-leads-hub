import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Euro,
  Users,
  BarChart3,
  CalendarCheck,
  CalendarCheck2,
  Handshake,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import type { KpiResult } from "@/lib/clients/kpis"

function fmt(n: number, type: "currency" | "percent" | "integer" | "multiplier"): string {
  if (!isFinite(n) || (n === 0 && type !== "integer")) {
    if (type === "percent") return "—%"
    if (type === "multiplier") return "—"
    if (type === "currency") return "—"
    return "—"
  }
  switch (type) {
    case "currency":
      return `€${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case "percent":
      return `${n.toFixed(1)}%`
    case "integer":
      return n.toLocaleString("en-GB")
    case "multiplier":
      return `${n.toFixed(2)}x`
  }
}

type KpiCardDef = {
  key: keyof KpiResult
  label: string
  type: "currency" | "percent" | "integer" | "multiplier"
  icon: LucideIcon
  showWhen?: keyof KpiVisibility
  /** "cost" = lower is better, "rate" = higher is better, "neutral" = no trend coloring */
  direction: "cost" | "rate" | "neutral"
}

export type KpiVisibility = {
  leads: boolean
  appointments: boolean
  deals: boolean
}

type KpiGroup = {
  title: string
  cards: KpiCardDef[]
  section: keyof KpiVisibility
}

const KPI_GROUPS: KpiGroup[] = [
  {
    title: "Leads",
    section: "leads",
    cards: [
      { key: "adSpend", label: "Adspend", type: "currency", icon: Euro, direction: "neutral" },
      { key: "leads", label: "Leads", type: "integer", icon: Users, direction: "rate" },
      { key: "costPerLead", label: "Cost per Lead", type: "currency", icon: Euro, direction: "cost" },
      { key: "qrPercent", label: "QR%", type: "percent", icon: BarChart3, showWhen: "appointments", direction: "rate" },
    ],
  },
  {
    title: "Appointments",
    section: "appointments",
    cards: [
      { key: "bookedCalls", label: "Booked Appointments", type: "integer", icon: CalendarCheck, direction: "rate" },
      { key: "costPerBookedCall", label: "Cost per Booked Appt.", type: "currency", icon: Euro, direction: "cost" },
      { key: "suPercent", label: "SU% (Show Up)", type: "percent", icon: BarChart3, direction: "rate" },
      { key: "takenCalls", label: "Taken Appointments", type: "integer", icon: CalendarCheck2, direction: "rate" },
      { key: "costPerTakenCall", label: "Cost per Taken Appt.", type: "currency", icon: Euro, direction: "cost" },
    ],
  },
  {
    title: "Deals",
    section: "deals",
    cards: [
      { key: "deals", label: "Deals", type: "integer", icon: Handshake, direction: "rate" },
      { key: "crPercent", label: "CR%", type: "percent", icon: BarChart3, direction: "rate" },
      { key: "costPerDeal", label: "Cost per Deal", type: "currency", icon: Euro, direction: "cost" },
      { key: "revenue", label: "Closed Revenue", type: "currency", icon: TrendingUp, direction: "rate" },
      { key: "roi", label: "ROI", type: "multiplier", icon: TrendingUp, direction: "rate" },
    ],
  },
]

type TrendStatus = "green" | "orange" | "red"

const STATUS_STYLES: Record<TrendStatus, { border: string; value: string; dot: string }> = {
  green: {
    border: "border-l-[3px] border-l-green-500",
    value: "text-green-400",
    dot: "bg-green-500",
  },
  orange: {
    border: "border-l-[3px] border-l-amber-500",
    value: "text-amber-400",
    dot: "bg-amber-500",
  },
  red: {
    border: "border-l-[3px] border-l-red-500",
    value: "text-red-400",
    dot: "bg-red-500",
  },
}

/**
 * Evaluate a KPI value by comparing to the previous period.
 * - Cost metrics: lower is better. >25% increase = red, any increase = orange, same/better = green.
 * - Rate metrics: higher is better. >25% decrease = red, any decrease = orange, same/better = green.
 */
function evaluateTrend(current: number, previous: number, direction: "cost" | "rate" | "neutral"): TrendStatus | null {
  if (direction === "neutral") return null
  if (!isFinite(current) || !isFinite(previous) || previous === 0 || current === 0) return null

  const pctChange = ((current - previous) / previous) * 100

  if (direction === "cost") {
    // Lower is better: increase = bad
    if (pctChange > 25) return "red"
    if (pctChange > 0) return "orange"
    return "green"
  }

  // Rate: higher is better: decrease = bad
  if (pctChange < -25) return "red"
  if (pctChange < 0) return "orange"
  return "green"
}

type Props = {
  data: KpiResult | null
  previousData?: KpiResult | null
  isLoading: boolean
  visibility?: KpiVisibility
}

export function KpiCards({ data, previousData, isLoading, visibility = { leads: true, appointments: true, deals: true } }: Props) {
  return (
    <div className="space-y-4">
      {KPI_GROUPS.map((group) => {
        if (!visibility[group.section]) return null

        const visibleCards = group.cards.filter(
          (kpi) => !kpi.showWhen || visibility[kpi.showWhen]
        )
        if (visibleCards.length === 0) return null

        const colClass = visibleCards.length <= 3
          ? "grid grid-cols-2 gap-3 sm:grid-cols-3"
          : visibleCards.length === 4
          ? "grid grid-cols-2 gap-3 sm:grid-cols-4"
          : "grid grid-cols-2 gap-3 sm:grid-cols-5"

        return (
          <Card key={group.title} className="overflow-hidden">
            <div className="px-4 pt-3.5 pb-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group.title}
              </h3>
            </div>
            <CardContent className="px-4 pb-4 pt-0">
              <div className={colClass}>
                {visibleCards.map((kpi) => {
                  const Icon = kpi.icon
                  const value = data?.[kpi.key] as number | undefined
                  const prevValue = previousData?.[kpi.key] as number | undefined
                  const status = value != null && prevValue != null
                    ? evaluateTrend(value, prevValue, kpi.direction)
                    : null
                  const styles = status ? STATUS_STYLES[status] : null

                  return (
                    <div key={kpi.key} className={`relative rounded-lg border bg-card/50 overflow-hidden transition-all duration-200 hover:bg-card ${styles?.border ?? "border-l-[3px] border-l-transparent"}`}>
                      <div className="flex h-full flex-col justify-between p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 leading-tight">
                            {kpi.label}
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {status && <span className={`h-1.5 w-1.5 rounded-full ${styles?.dot}`} />}
                            <Icon className="h-3.5 w-3.5 text-muted-foreground/30" />
                          </div>
                        </div>
                        <div className="mt-auto pt-2.5">
                          {isLoading ? (
                            <Skeleton className="h-7 w-20" />
                          ) : (
                            <p className={`text-xl font-bold tabular-nums tracking-tight ${styles?.value ?? "text-foreground"}`}>
                              {data ? fmt(data[kpi.key] as number, kpi.type) : "—"}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
