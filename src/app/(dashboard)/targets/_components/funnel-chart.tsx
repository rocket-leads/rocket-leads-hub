"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface Props {
  leads: number
  calls: number
  qualified: number
  taken: number
  deals: number
  isLoading: boolean
}

const STAGES = [
  { key: "leads", label: "Leads", color: "bg-muted-foreground/30" },
  { key: "calls", label: "Booked Calls", color: "bg-primary/40" },
  { key: "qualified", label: "Qualified", color: "bg-primary/60" },
  { key: "taken", label: "Taken", color: "bg-primary/80" },
  { key: "deals", label: "Deals", color: "bg-green-500" },
] as const

export const FunnelChart = memo(function FunnelChart({ leads, calls, qualified, taken, deals, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
    )
  }

  const values = { leads, calls, qualified, taken, deals }
  const maxVal = Math.max(leads, 1)

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">Funnel</h3>
      <div className="space-y-2">
        {STAGES.map(({ key, label, color }) => {
          const val = values[key]
          const pct = (val / maxVal) * 100
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-foreground font-medium">{val}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
