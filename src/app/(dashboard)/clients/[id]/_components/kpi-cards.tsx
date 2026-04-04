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
import { evaluateKpi, type KpiTargets, type TargetStatus } from "@/lib/clients/targets"

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
      { key: "adSpend", label: "Adspend", type: "currency", icon: Euro },
      { key: "leads", label: "Leads", type: "integer", icon: Users },
      { key: "costPerLead", label: "Cost per Lead", type: "currency", icon: Euro },
      { key: "qrPercent", label: "QR%", type: "percent", icon: BarChart3, showWhen: "appointments" },
    ],
  },
  {
    title: "Appointments",
    section: "appointments",
    cards: [
      { key: "bookedCalls", label: "Booked Appointments", type: "integer", icon: CalendarCheck },
      { key: "costPerBookedCall", label: "Cost per Booked Appt.", type: "currency", icon: Euro },
      { key: "suPercent", label: "SU% (Show Up)", type: "percent", icon: BarChart3 },
      { key: "takenCalls", label: "Taken Appointments", type: "integer", icon: CalendarCheck2 },
      { key: "costPerTakenCall", label: "Cost per Taken Appt.", type: "currency", icon: Euro },
    ],
  },
  {
    title: "Deals",
    section: "deals",
    cards: [
      { key: "deals", label: "Deals", type: "integer", icon: Handshake },
      { key: "crPercent", label: "CR%", type: "percent", icon: BarChart3 },
      { key: "costPerDeal", label: "Cost per Deal", type: "currency", icon: Euro },
      { key: "revenue", label: "Closed Revenue", type: "currency", icon: TrendingUp },
      { key: "roi", label: "ROI", type: "multiplier", icon: TrendingUp },
    ],
  },
]

const STATUS_STYLES: Record<TargetStatus, { border: string; value: string; dot: string }> = {
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

type Props = {
  data: KpiResult | null
  isLoading: boolean
  visibility?: KpiVisibility
  targets?: KpiTargets | null
}

export function KpiCards({ data, isLoading, visibility = { leads: true, appointments: true, deals: true }, targets }: Props) {
  return (
    <div className="space-y-5">
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
          <div key={group.title}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                {group.title}
              </h3>
              <div className="flex-1 h-px bg-border/40" />
            </div>
            <div className={colClass}>
              {visibleCards.map((kpi) => {
                const Icon = kpi.icon
                const value = data?.[kpi.key] as number | undefined
                const status = targets && value != null ? evaluateKpi(kpi.key, value, targets) : null
                const styles = status ? STATUS_STYLES[status] : null

                return (
                  <Card key={kpi.key} className={`relative overflow-hidden transition-all duration-200 hover:shadow-md hover:shadow-black/5 ${styles?.border ?? "border-l-[3px] border-l-transparent"}`}>
                    <CardContent className="flex h-full flex-col justify-between p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 leading-tight">
                          {kpi.label}
                        </p>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {status && <span className={`h-1.5 w-1.5 rounded-full ${styles?.dot}`} />}
                          <Icon className="h-3.5 w-3.5 text-muted-foreground/30" />
                        </div>
                      </div>
                      <div className="mt-auto pt-3">
                        {isLoading ? (
                          <Skeleton className="h-7 w-20" />
                        ) : (
                          <p className={`text-xl font-bold tabular-nums tracking-tight ${styles?.value ?? "text-foreground"}`}>
                            {data ? fmt(data[kpi.key] as number, kpi.type) : "—"}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
