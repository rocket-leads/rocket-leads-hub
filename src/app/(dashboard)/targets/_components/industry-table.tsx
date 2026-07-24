"use client"

import { memo } from "react"
import type { IndustryData } from "@/types/targets"
import { formatCurrency } from "@/lib/targets/formatters"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

interface Props {
  data: IndustryData[]
  isLoading: boolean
}

export const IndustryTable = memo(function IndustryTable({ data, isLoading }: Props) {
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

  const rows = data.slice(0, 8)
  const totalDeals = rows.reduce((s, r) => s + r.deals, 0)
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const avgDealSize = totalDeals > 0 ? totalRevenue / totalDeals : 0

  return (
    <div className="section-card">
      <div className="section-head">
        <div className="section-title">
          Deals by Industry
          {rows.length > 0 && <span className="count">{rows.length}</span>}
        </div>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No deal data</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Industry</TableHead>
              <TableHead className="text-right">Deals</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Avg / Deal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const avg = row.deals > 0 ? row.revenue / row.deals : 0
              return (
                <TableRow key={row.industry}>
                  <TableCell className="text-muted-foreground truncate max-w-[160px]">{row.industry}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{row.deals}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatCurrency(row.revenue)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">{formatCurrency(avg)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{totalDeals}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{formatCurrency(totalRevenue)}</TableCell>
              <TableCell className="text-right font-mono font-bold tabular-nums">{formatCurrency(avgDealSize)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  )
})
