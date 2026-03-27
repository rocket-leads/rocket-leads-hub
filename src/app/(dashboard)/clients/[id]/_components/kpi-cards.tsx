import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { KpiResult } from "@/lib/kpis"

function fmt(n: number, type: "currency" | "percent" | "integer" | "ratio" | "multiplier"): string {
  if (!isFinite(n) || n === 0 && type !== "integer") {
    if (type === "percent") return "—%"
    if (type === "multiplier") return "—x"
    if (type === "currency") return "—"
    return "—"
  }
  switch (type) {
    case "currency":
      return `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    case "percent":
      return `${n.toFixed(1)}%`
    case "integer":
      return n.toLocaleString("nl-NL")
    case "multiplier":
      return `${n.toFixed(2)}x`
    case "ratio":
      return `€${n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }
}

type KpiCardDef = {
  key: keyof KpiResult
  label: string
  type: "currency" | "percent" | "integer" | "ratio" | "multiplier"
  description?: string
}

const KPI_CARDS: KpiCardDef[] = [
  { key: "adSpend", label: "Ad Spend", type: "currency" },
  { key: "leads", label: "Leads", type: "integer" },
  { key: "costPerLead", label: "Cost per Lead", type: "ratio" },
  { key: "qrPercent", label: "QR% (Lead → Call)", type: "percent" },
  { key: "bookedCalls", label: "Booked Calls", type: "integer" },
  { key: "costPerBookedCall", label: "Cost per Booked Call", type: "ratio" },
  { key: "suPercent", label: "SU% (Show Up)", type: "percent" },
  { key: "takenCalls", label: "Taken Calls", type: "integer" },
  { key: "costPerTakenCall", label: "Cost per Taken Call", type: "ratio" },
  { key: "deals", label: "Deals", type: "integer" },
  { key: "crPercent", label: "CR% (Close Rate)", type: "percent" },
  { key: "costPerDeal", label: "Cost per Deal", type: "ratio" },
  { key: "revenue", label: "Revenue", type: "currency" },
  { key: "roi", label: "ROI", type: "multiplier" },
]

type Props = {
  data: KpiResult | null
  isLoading: boolean
}

export function KpiCards({ data, isLoading }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {KPI_CARDS.map((kpi) => (
        <Card key={kpi.key} className="col-span-1">
          <CardHeader className="pb-1 pt-3 px-3">
            <CardTitle className="text-xs font-medium text-muted-foreground leading-tight">
              {kpi.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            {isLoading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <p className="text-xl font-bold">
                {data ? fmt(data[kpi.key] as number, kpi.type) : "—"}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
