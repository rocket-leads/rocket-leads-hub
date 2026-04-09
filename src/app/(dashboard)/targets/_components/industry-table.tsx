"use client"

import { memo } from "react"
import type { IndustryData } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"

interface Props {
  data: IndustryData[]
  isLoading: boolean
}

export const IndustryTable = memo(function IndustryTable({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Deals by Industry</h3>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No deal data</p>
      ) : (
        <div className="space-y-1">
          {data.slice(0, 8).map((row) => (
            <div key={row.industry} className="flex items-center justify-between py-1.5 text-xs">
              <span className="text-muted-foreground truncate mr-2">{row.industry}</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono text-foreground">{row.deals}×</span>
                <span className="font-mono text-foreground w-20 text-right">{formatCurrency(row.revenue)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
