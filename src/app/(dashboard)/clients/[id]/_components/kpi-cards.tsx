import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DollarSign,
  Users,
  Target,
  BarChart3,
  PhoneCall,
  PhoneIncoming,
  Handshake,
  TrendingUp,
  type LucideIcon,
} from "lucide-react"
import type { KpiResult } from "@/lib/kpis"

function fmt(n: number, type: "currency" | "percent" | "integer" | "multiplier"): string {
  if (!isFinite(n) || (n === 0 && type !== "integer")) {
    if (type === "percent") return "—%"
    if (type === "multiplier") return "—"
    if (type === "currency") return "—"
    return "—"
  }
  switch (type) {
    case "currency":
      return `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case "percent":
      return `${n.toFixed(1)}%`
    case "integer":
      return n.toLocaleString("nl-NL")
    case "multiplier":
      return n.toFixed(2)
  }
}

type KpiCardDef = {
  key: keyof KpiResult
  label: string
  type: "currency" | "percent" | "integer" | "multiplier"
  icon: LucideIcon
}

type KpiGroup = {
  title: string
  cards: KpiCardDef[]
}

const KPI_GROUPS: KpiGroup[] = [
  {
    title: "Acquisitie",
    cards: [
      { key: "adSpend", label: "Adspend", type: "currency", icon: DollarSign },
      { key: "leads", label: "Leads", type: "integer", icon: Users },
      { key: "costPerLead", label: "Cost per Lead", type: "currency", icon: Target },
      { key: "qrPercent", label: "QR% (Lead → Call)", type: "percent", icon: BarChart3 },
    ],
  },
  {
    title: "Calls",
    cards: [
      { key: "bookedCalls", label: "Booked Calls", type: "integer", icon: PhoneCall },
      { key: "costPerBookedCall", label: "Cost per Booked Call", type: "currency", icon: DollarSign },
      { key: "suPercent", label: "SU% (Show Up)", type: "percent", icon: BarChart3 },
      { key: "takenCalls", label: "Taken Calls", type: "integer", icon: PhoneIncoming },
    ],
  },
  {
    title: "Deals & Revenue",
    cards: [
      { key: "costPerTakenCall", label: "Cost per Taken Call", type: "currency", icon: DollarSign },
      { key: "deals", label: "Deals", type: "integer", icon: Handshake },
      { key: "crPercent", label: "CR%", type: "percent", icon: BarChart3 },
      { key: "costPerDeal", label: "Cost per Deal", type: "currency", icon: Target },
    ],
  },
  {
    title: "Revenue & ROI",
    cards: [
      { key: "revenue", label: "Closed Revenue", type: "currency", icon: TrendingUp },
      { key: "roi", label: "ROI", type: "multiplier", icon: TrendingUp },
    ],
  },
]

type Props = {
  data: KpiResult | null
  isLoading: boolean
}

export function KpiCards({ data, isLoading }: Props) {
  return (
    <div className="space-y-6">
      {KPI_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            {group.title}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {group.cards.map((kpi) => {
              const Icon = kpi.icon
              return (
                <Card key={kpi.key} className="relative overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {kpi.label}
                      </p>
                      <Icon className="h-4 w-4 text-muted-foreground/50" />
                    </div>
                    <div className="mt-2">
                      {isLoading ? (
                        <Skeleton className="h-8 w-24" />
                      ) : (
                        <p className="text-2xl font-bold tracking-tight">
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
      ))}
    </div>
  )
}
