"use client"

import { useEffect, useState } from "react"
import { X, ArrowUpDown } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { formatCurrency } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"
import type { InvoiceDetail } from "@/types/targets"

interface Props {
  title: string
  details: InvoiceDetail[]
  open: boolean
  onClose: () => void
}

const STATUS_BADGE: Record<InvoiceDetail["status"], { label: string; className: string; order: number }> = {
  paid: { label: "Paid", className: "bg-green-500/15 text-green-500", order: 1 },
  open: { label: "Open", className: "bg-yellow-500/15 text-yellow-500", order: 2 },
  overdue: { label: "Overdue", className: "bg-red-500/15 text-red-500", order: 3 },
  credit: { label: "Credit", className: "bg-blue-500/15 text-blue-500", order: 4 },
  credit_prev: { label: "Credit (prev)", className: "bg-blue-500/10 text-blue-400", order: 5 },
  credit_old: { label: "Credit (old)", className: "bg-muted-foreground/15 text-muted-foreground", order: 6 },
}

type SortKey = "date" | "status" | "amount" | "customer"
type FilterStatus = "all" | "paid" | "open" | "overdue" | "credits"

const FILTER_OPTIONS: Array<{ key: FilterStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "credits", label: "Credits" },
]

export function InvoiceDetailModal({ title, details, open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortAsc, setSortAsc] = useState(false)
  const [filter, setFilter] = useState<FilterStatus>("all")
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null)
  const [savingFor, setSavingFor] = useState<string | null>(null)

  async function setOverride(invoiceId: string, subCategory: "mrr" | "new_business" | null) {
    setSavingFor(invoiceId)
    try {
      const res = await fetch("/api/targets/finance/invoice-override", {
        method: subCategory === null ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subCategory === null ? { invoiceId } : { invoiceId, subCategory }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["targets-finance"] }),
        queryClient.invalidateQueries({ queryKey: ["targets-delivery"] }),
        queryClient.invalidateQueries({ queryKey: ["targets-monday"] }),
      ])
    } catch (e) {
      console.error("Override failed:", e)
    } finally {
      setSavingFor(null)
      setOpenMenuFor(null)
    }
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [open, onClose])

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  if (!open) return null

  // Filter
  const filtered = details.filter((d) => {
    if (filter === "all") return true
    if (filter === "credits") return d.status === "credit" || d.status === "credit_prev" || d.status === "credit_old"
    return d.status === filter
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === "date") cmp = a.date.localeCompare(b.date)
    else if (sortKey === "status") cmp = STATUS_BADGE[a.status].order - STATUS_BADGE[b.status].order
    else if (sortKey === "amount") cmp = a.amount - b.amount
    else if (sortKey === "customer") cmp = (a.customerName ?? "").localeCompare(b.customerName ?? "")
    return sortAsc ? cmp : -cmp
  })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc)
    else { setSortKey(key); setSortAsc(false) }
  }

  // Summary (always from full details, not filtered)
  const invoices = details.filter((d) => !d.status.startsWith("credit"))
  const sameCredits = details.filter((d) => d.status === "credit")
  const prevCredits = details.filter((d) => d.status === "credit_prev")
  const oldCredits = details.filter((d) => d.status === "credit_old")

  const totalInvoiced = invoices.reduce((s, d) => s + d.amount, 0)
  const totalPaid = invoices.filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0)
  const totalOpen = invoices.filter((d) => d.status === "open").reduce((s, d) => s + d.amount, 0)
  const totalOverdue = invoices.filter((d) => d.status === "overdue").reduce((s, d) => s + d.amount, 0)
  const sameMonthCredited = Math.abs(sameCredits.reduce((s, d) => s + d.amount, 0))
  const prevMonthCredited = Math.abs(prevCredits.reduce((s, d) => s + d.amount, 0))
  const oldCredited = Math.abs(oldCredits.reduce((s, d) => s + d.amount, 0))
  const allCredited = sameMonthCredited + prevMonthCredited + oldCredited

  const grossAmount = totalInvoiced - sameMonthCredited - prevMonthCredited
  const netAmount = totalInvoiced - allCredited

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div style={{ position: "fixed", top: "15vh", left: "50%", transform: "translateX(-50%)", width: "90vw", maxWidth: "48rem", height: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }} className="bg-card border border-border rounded-xl shadow-2xl z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/40 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <span className="text-xs text-muted-foreground">{details.length} line items</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary */}
        <div className="px-6 py-4 border-b border-border/40 bg-muted/10 shrink-0">
          <div className="grid grid-cols-4 gap-3">
            {/* Invoiced */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Invoiced</span>
              <span className="text-base font-bold font-mono text-foreground">{formatCurrency(totalInvoiced)}</span>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                <div className="flex justify-between"><span className="text-green-500">Paid</span><span className="font-mono text-green-500">{formatCurrency(totalPaid)}</span></div>
                {totalOpen > 0 && <div className="flex justify-between"><span className="text-yellow-500">Open</span><span className="font-mono text-yellow-500">{formatCurrency(totalOpen)}</span></div>}
                {totalOverdue > 0 && <div className="flex justify-between"><span className="text-red-500">Overdue</span><span className="font-mono text-red-500">{formatCurrency(totalOverdue)}</span></div>}
              </div>
            </div>

            {/* Credits */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Credits</span>
              <span className="text-base font-bold font-mono text-foreground">{allCredited > 0 ? `-${formatCurrency(allCredited)}` : "€0"}</span>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                {sameMonthCredited > 0 && <div className="flex justify-between"><span className="text-blue-500">This month</span><span className="font-mono text-blue-500">-{formatCurrency(sameMonthCredited)}</span></div>}
                {prevMonthCredited > 0 && <div className="flex justify-between"><span className="text-blue-400">Prev month</span><span className="font-mono text-blue-400">-{formatCurrency(prevMonthCredited)}</span></div>}
                {oldCredited > 0 && <div className="flex justify-between"><span className="text-muted-foreground/50">Older</span><span className="font-mono text-muted-foreground/50">-{formatCurrency(oldCredited)}</span></div>}
              </div>
            </div>

            {/* Gross */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Gross Amount</span>
              <span className="text-base font-bold font-mono text-foreground">{formatCurrency(grossAmount)}</span>
              <div className="mt-1.5 text-[10px] text-muted-foreground/60">
                Invoiced − this &amp; prev month credits
              </div>
            </div>

            {/* Net */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Net Amount</span>
              <span className="text-base font-bold font-mono text-foreground">{formatCurrency(netAmount)}</span>
              <div className="mt-1.5 text-[10px] text-muted-foreground/60">
                Invoiced − all credits
              </div>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="px-6 py-2 border-b border-border/40 shrink-0 flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Filter:</span>
          <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
            {FILTER_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "h-6 px-2.5 text-[10px] font-medium rounded transition-colors",
                  filter === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground ml-auto">{sorted.length} items</span>
        </div>

        {/* Scrollable table */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10 shadow-sm">
              <tr className="border-b border-border/40">
                <th className="text-left py-2 px-5 text-muted-foreground font-medium cursor-pointer select-none" onClick={() => toggleSort("date")}>
                  <span className="flex items-center gap-1">Date {sortKey === "date" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-left py-2 px-5 text-muted-foreground font-medium">Invoice</th>
                <th className="text-left py-2 px-5 text-muted-foreground font-medium cursor-pointer select-none" onClick={() => toggleSort("customer")}>
                  <span className="flex items-center gap-1">Customer {sortKey === "customer" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-left py-2 px-5 text-muted-foreground font-medium">Type</th>
                <th className="text-left py-2 px-5 text-muted-foreground font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  <span className="flex items-center gap-1">Status {sortKey === "status" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-right py-2 px-5 text-muted-foreground font-medium cursor-pointer select-none" onClick={() => toggleSort("amount")}>
                  <span className="flex items-center gap-1 justify-end">Amount {sortKey === "amount" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => {
                const badge = STATUS_BADGE[d.status]
                const isOld = d.status === "credit_old"
                const hasUrl = !!d.hostedUrl
                return (
                  <tr
                    key={`${d.invoiceId}-${i}`}
                    onClick={hasUrl ? () => window.open(d.hostedUrl!, "_blank", "noopener,noreferrer") : undefined}
                    className={cn(
                      "border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors",
                      hasUrl && "cursor-pointer",
                      isOld && "opacity-40",
                    )}
                  >
                    <td className="py-2 px-5 font-mono text-muted-foreground">{d.date}</td>
                    <td className="py-2 px-5 font-mono">
                      {d.invoiceNumber ? (
                        hasUrl ? (
                          <span className="text-primary hover:underline">{d.invoiceNumber}</span>
                        ) : (
                          d.invoiceNumber
                        )
                      ) : "—"}
                    </td>
                    <td className="py-2 px-5 truncate max-w-[180px]">{d.customerName || "—"}</td>
                    <td className="py-2 px-5 relative" onClick={(e) => e.stopPropagation()}>
                      {d.category === "ad_budget" ? (
                        <span className="text-[10px] text-muted-foreground">Ad Budget</span>
                      ) : (
                        <button
                          type="button"
                          disabled={savingFor === d.invoiceId}
                          onClick={() => setOpenMenuFor(openMenuFor === d.invoiceId ? null : d.invoiceId)}
                          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline underline-offset-2 disabled:opacity-50"
                          title="Click to reclassify this invoice"
                        >
                          {d.subCategory === "new_business" ? "New Biz" : "MRR"} ▾
                        </button>
                      )}
                      {openMenuFor === d.invoiceId && d.category !== "ad_budget" && (
                        <div className="absolute left-3 top-full mt-1 z-10 bg-popover border border-border rounded-md shadow-lg py-1 text-[11px] min-w-[140px]">
                          <button
                            type="button"
                            onClick={() => setOverride(d.invoiceId, "mrr")}
                            className={cn(
                              "w-full text-left px-3 py-1.5 hover:bg-muted",
                              d.subCategory === "mrr" && "font-semibold",
                            )}
                          >
                            MRR
                          </button>
                          <button
                            type="button"
                            onClick={() => setOverride(d.invoiceId, "new_business")}
                            className={cn(
                              "w-full text-left px-3 py-1.5 hover:bg-muted",
                              d.subCategory === "new_business" && "font-semibold",
                            )}
                          >
                            New Business
                          </button>
                          <div className="h-px bg-border my-1" />
                          <button
                            type="button"
                            onClick={() => setOverride(d.invoiceId, null)}
                            className="w-full text-left px-3 py-1.5 hover:bg-muted text-muted-foreground"
                          >
                            Use auto-detection
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-5">
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", badge.className)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className={cn(
                      "py-2 px-5 text-right font-mono font-medium",
                      d.amount < 0 ? "text-red-500" : "text-foreground",
                    )}>
                      {formatCurrency(d.amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
