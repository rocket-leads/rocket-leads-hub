"use client"

import { memo } from "react"
import type { CloserData } from "@/types/targets"
import { formatCurrency, formatPercent, safeDivide } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

interface Props {
  data: CloserData[]
  isLoading: boolean
}

export const ClosersTable = memo(function ClosersTable({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="section-card">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </div>
      </div>
    )
  }

  // Show-up rate: taken (which now includes Not Updated) ÷ qualified (all past).
  // Not Updated is folded into Taken so the conversion rate can't be gamed by
  // skipping status updates - but we keep the Not Updated column so the data-
  // quality issue is still visible.

  const totalQualified = data.reduce((s, r) => s + r.qualifiedCalls, 0)
  const totalUpcoming = data.reduce((s, r) => s + r.upcomingCalls, 0)
  const totalTaken = data.reduce((s, r) => s + r.takenCalls, 0)
  const totalNotUpdated = data.reduce((s, r) => s + r.notUpdated, 0)
  const totalDeals = data.reduce((s, r) => s + r.deals, 0)
  const totalRevenue = data.reduce((s, r) => s + r.revenue, 0)
  const totalShowUp = safeDivide(totalTaken, totalQualified)
  const totalConv = safeDivide(totalDeals, totalTaken)
  const totalAvg = safeDivide(totalRevenue, totalDeals)

  return (
    <div className="section-card">
      <div className="section-head">
        <div className="section-title">
          Performance by Closer
          {data.length > 0 && <span className="count">{data.length}</span>}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No closer data</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Closer</TableHead>
              <TableHead className="text-right" title="Past appointments scheduled with this closer (all statuses)">Qualified</TableHead>
              <TableHead className="text-right">Taken</TableHead>
              <TableHead className="text-right" title="Taken ÷ Qualified. Not Updated is included in Taken so closers can't game the conversion rate.">Show-up</TableHead>
              <TableHead className="text-right" title="Past appointments still in Qualified / Gepland status - closer hasn't updated">Not Updated</TableHead>
              <TableHead className="text-right" title="Future appointments scheduled in the period - pending workload">Upcoming</TableHead>
              <TableHead className="text-right">Deals</TableHead>
              <TableHead className="text-right">Conv</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Avg / Deal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const showUp = safeDivide(row.takenCalls, row.qualifiedCalls)
              const conv = safeDivide(row.deals, row.takenCalls)
              const avg = safeDivide(row.revenue, row.deals)
              const isUnassigned = row.closer === "Unassigned"
              return (
                <TableRow key={row.closer}>
                  <TableCell className={cn("truncate max-w-[140px]", isUnassigned ? "text-muted-foreground/60 italic" : "text-muted-foreground")}>{row.closer}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.qualifiedCalls}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.takenCalls}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.qualifiedCalls > 0 ? formatPercent(showUp) : "-"}</TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", row.notUpdated > 0 ? "text-[var(--st-warn)]" : "text-muted-foreground/40")}>{row.notUpdated > 0 ? row.notUpdated : "-"}</TableCell>
                  <TableCell className={cn("text-right font-mono tabular-nums", row.upcomingCalls > 0 ? "text-foreground" : "text-muted-foreground/40")}>{row.upcomingCalls > 0 ? row.upcomingCalls : "-"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.deals}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.takenCalls > 0 ? formatPercent(conv) : "-"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.revenue)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{row.deals > 0 ? formatCurrency(avg) : "-"}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalQualified}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalTaken}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalQualified > 0 ? formatPercent(totalShowUp) : "-"}</TableCell>
              <TableCell className={cn("text-right font-mono font-bold tabular-nums", totalNotUpdated > 0 ? "text-[var(--st-warn)]" : "text-muted-foreground/40")}>{totalNotUpdated > 0 ? totalNotUpdated : "-"}</TableCell>
              <TableCell className={cn("text-right font-mono font-bold tabular-nums", totalUpcoming > 0 ? "text-foreground" : "text-muted-foreground/40")}>{totalUpcoming > 0 ? totalUpcoming : "-"}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalDeals}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalTaken > 0 ? formatPercent(totalConv) : "-"}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{formatCurrency(totalRevenue)}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalDeals > 0 ? formatCurrency(totalAvg) : "-"}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  )
})
