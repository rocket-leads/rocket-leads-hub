"use client"

import { useEffect } from "react"
import { X } from "lucide-react"
import { formatCurrency } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"
import type { InvoiceDetail } from "@/types/targets"

interface Props {
  title: string
  details: InvoiceDetail[]
  open: boolean
  onClose: () => void
}

const STATUS_BADGE: Record<InvoiceDetail["status"], { label: string; className: string }> = {
  paid: { label: "Paid", className: "bg-green-500/15 text-green-500" },
  open: { label: "Open", className: "bg-yellow-500/15 text-yellow-500" },
  overdue: { label: "Overdue", className: "bg-red-500/15 text-red-500" },
  credit: { label: "Credit", className: "bg-blue-500/15 text-blue-500" },
  credit_old: { label: "Old credit", className: "bg-muted-foreground/15 text-muted-foreground line-through" },
}

export function InvoiceDetailModal({ title, details, open, onClose }: Props) {
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

  const sorted = [...details].sort((a, b) => b.date.localeCompare(a.date))

  const invoices = sorted.filter((d) => d.status !== "credit" && d.status !== "credit_old")
  const sameMonthCredits = sorted.filter((d) => d.status === "credit")
  const oldCredits = sorted.filter((d) => d.status === "credit_old")

  const totalInvoiced = invoices.reduce((s, d) => s + d.amount, 0)
  const totalPaid = invoices.filter((d) => d.status === "paid").reduce((s, d) => s + d.amount, 0)
  const totalOpen = invoices.filter((d) => d.status === "open").reduce((s, d) => s + d.amount, 0)
  const totalOverdue = invoices.filter((d) => d.status === "overdue").reduce((s, d) => s + d.amount, 0)
  const totalCredited = Math.abs(sameMonthCredits.reduce((s, d) => s + d.amount, 0))
  const totalOldCredited = Math.abs(oldCredits.reduce((s, d) => s + d.amount, 0))
  const netTotal = totalInvoiced - totalCredited

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div style={{ position: "fixed", top: "15vh", left: "50%", transform: "translateX(-50%)", width: "90vw", maxWidth: "48rem", height: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }} className="bg-card border border-border rounded-xl shadow-2xl z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <span className="text-xs text-muted-foreground">{sorted.length} line items</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Summary cards */}
        <div className="px-6 py-4 border-b border-border/40 bg-muted/10 shrink-0">
          <div className="grid grid-cols-3 gap-3">
            {/* Invoiced */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Total Invoiced</span>
              <span className="text-lg font-bold font-mono text-foreground">{formatCurrency(totalInvoiced)}</span>
              <div className="mt-2 space-y-0.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-green-500">Paid</span>
                  <span className="font-mono text-green-500">{formatCurrency(totalPaid)}</span>
                </div>
                {totalOpen > 0 && (
                  <div className="flex justify-between">
                    <span className="text-yellow-500">Open</span>
                    <span className="font-mono text-yellow-500">{formatCurrency(totalOpen)}</span>
                  </div>
                )}
                {totalOverdue > 0 && (
                  <div className="flex justify-between">
                    <span className="text-red-500">Overdue</span>
                    <span className="font-mono text-red-500">{formatCurrency(totalOverdue)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Credits */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Credits</span>
              <span className="text-lg font-bold font-mono text-foreground">
                {totalCredited > 0 || totalOldCredited > 0 ? `-${formatCurrency(totalCredited + totalOldCredited)}` : "€0"}
              </span>
              <div className="mt-2 space-y-0.5 text-[11px]">
                {totalCredited > 0 && (
                  <div className="flex justify-between">
                    <span className="text-blue-500">Same month</span>
                    <span className="font-mono text-blue-500">-{formatCurrency(totalCredited)}</span>
                  </div>
                )}
                {totalOldCredited > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground/60">Old invoices</span>
                    <span className="font-mono text-muted-foreground/60">-{formatCurrency(totalOldCredited)}</span>
                  </div>
                )}
                {totalOldCredited > 0 && (
                  <div className="text-[9px] text-muted-foreground/40 mt-1">Old credits not counted in net total</div>
                )}
              </div>
            </div>

            {/* Net Total */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">Net Total</span>
              <span className="text-lg font-bold font-mono text-foreground">{formatCurrency(netTotal)}</span>
              <div className="mt-2 text-[11px] text-muted-foreground">
                {formatCurrency(totalInvoiced)} invoiced
                {totalCredited > 0 && <> − {formatCurrency(totalCredited)} credited</>}
              </div>
            </div>
          </div>
        </div>

        {/* Scrollable table */}
        <div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card z-10 shadow-sm">
              <tr className="border-b border-border/40">
                <th className="text-left py-2.5 px-5 text-muted-foreground font-medium">Date</th>
                <th className="text-left py-2.5 px-5 text-muted-foreground font-medium">Invoice</th>
                <th className="text-left py-2.5 px-5 text-muted-foreground font-medium">Customer</th>
                <th className="text-left py-2.5 px-5 text-muted-foreground font-medium">Type</th>
                <th className="text-left py-2.5 px-5 text-muted-foreground font-medium">Status</th>
                <th className="text-right py-2.5 px-5 text-muted-foreground font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => {
                const badge = STATUS_BADGE[d.status]
                const isOldCredit = d.status === "credit_old"
                return (
                  <tr key={`${d.invoiceId}-${i}`} className={cn(
                    "border-b border-border/20 last:border-0 hover:bg-muted/30 transition-colors",
                    isOldCredit && "opacity-40",
                  )}>
                    <td className="py-2.5 px-5 font-mono text-muted-foreground">{d.date}</td>
                    <td className="py-2.5 px-5 font-mono">{d.invoiceNumber || "—"}</td>
                    <td className="py-2.5 px-5 truncate max-w-[180px]">{d.customerName || "—"}</td>
                    <td className="py-2.5 px-5">
                      <span className="text-[10px] text-muted-foreground">
                        {d.category === "ad_budget" ? "Ad Budget" : d.subCategory === "new_business" ? "New Biz" : "MRR"}
                      </span>
                    </td>
                    <td className="py-2.5 px-5">
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", badge.className)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className={cn(
                      "py-2.5 px-5 text-right font-mono font-medium",
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
