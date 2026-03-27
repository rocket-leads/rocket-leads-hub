"use client"

import { useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import type { UtmRow } from "@/lib/kpis"

type SortKey = keyof Omit<UtmRow, "utm">
type SortDir = "asc" | "desc"

type Props = {
  rows: UtmRow[]
  isLoading: boolean
}

export function UtmTable({ rows, isLoading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("leads")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey]
    return sortDir === "asc" ? diff : -diff
  })

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-muted-foreground ml-1">↕</span>
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
  }

  const colClass = "cursor-pointer select-none hover:text-foreground transition-colors"

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No UTM data available for this period.</p>
  }

  return (
    <div className="rounded-md border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ad / UTM</TableHead>
            <TableHead className={colClass} onClick={() => handleSort("leads")}>
              Leads <SortIcon col="leads" />
            </TableHead>
            <TableHead className={colClass} onClick={() => handleSort("bookedCalls")}>
              Booked Calls <SortIcon col="bookedCalls" />
            </TableHead>
            <TableHead className={colClass} onClick={() => handleSort("takenCalls")}>
              Taken Calls <SortIcon col="takenCalls" />
            </TableHead>
            <TableHead className={colClass} onClick={() => handleSort("deals")}>
              Deals <SortIcon col="deals" />
            </TableHead>
            <TableHead className={colClass} onClick={() => handleSort("revenue")}>
              Revenue <SortIcon col="revenue" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.utm}>
              <TableCell className="max-w-[200px] truncate font-mono text-xs" title={row.utm}>
                {row.utm}
              </TableCell>
              <TableCell>{row.leads}</TableCell>
              <TableCell>{row.bookedCalls}</TableCell>
              <TableCell>{row.takenCalls}</TableCell>
              <TableCell>{row.deals}</TableCell>
              <TableCell>
                {row.revenue > 0
                  ? `€${row.revenue.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
