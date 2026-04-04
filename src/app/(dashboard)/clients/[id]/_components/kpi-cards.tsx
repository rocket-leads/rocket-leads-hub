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
      return n.toFixed(2)
  }
}

type KpiCardDef = {
  key: keyof KpiResult
  label: string
  type: "currency" | "percent" | "integer" | "multiplier"
  icon: LucideIcon
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
    ],
  },
  {
    title: "Appointments",
    section: "appointments",
    cards: [
      { key: "qrPercent", label: "QR% (Lead → Appointment)", type: "percent", icon: BarChart3 },
      { key: "bookedCalls", label: "Booked Appointments", type: "integer", icon: CalendarCheck },
      { key: "costPerBookedCall", label: "Cost per Booked Appointment", type: "currency", icon: Euro },
      { key: "suPercent", label: "SU% (Show Up)", type: "percent", icon: BarChart3 },
      { key: "takenCalls", label: "Taken Appointments", type: "integer", icon: CalendarCheck2 },
      { key: "costPerTakenCall", label: "Cost per Taken Appointment", type: "currency", icon: Euro },
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

type Props = {
  data: KpiResult | null
  isLoading: boolean
  visibility?: KpiVisibility
}

export function KpiCards({ data, isLoading, visibility = { leads: true, appointments: true, deals: true } }: Props) {
  return (
    <div className="space-y-6">
      {KPI_GROUPS.map((group) => {
        if (!visibility[group.section]) return null

        return (
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
        )
      })}
    </div>
  )
}
