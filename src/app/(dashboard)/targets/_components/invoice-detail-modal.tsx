"use client"

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
}

export function InvoiceDetailModal({ title, details, open, onClose }: Props) {
  if (!open) return null

  const sorted = [...details].sort((a, b) => b.date.localeCompare(a.date))
  const total = sorted.reduce((s, d) => s + d.amount, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <div>
            <h2 className="text-sm font-medium text-foreground">{title}</h2>
            <span className="text-xs text-muted-foreground">{sorted.length} items — Total: {formatCurrency(total)}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border/40">
                <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Date</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Invoice</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Customer</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Type</th>
                <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Status</th>
                <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => {
                const badge = STATUS_BADGE[d.status]
                return (
                  <tr key={`${d.invoiceId}-${i}`} className="border-b border-border/20 last:border-0 hover:bg-muted/30">
                    <td className="py-2.5 px-4 font-mono text-muted-foreground">{d.date}</td>
                    <td className="py-2.5 px-4 font-mono">{d.invoiceNumber || "—"}</td>
                    <td className="py-2.5 px-4">{d.customerName || "—"}</td>
                    <td className="py-2.5 px-4">
                      <span className="text-[10px] text-muted-foreground">
                        {d.category === "ad_budget" ? "Ad Budget" : d.subCategory === "new_business" ? "New Biz" : "MRR"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", badge.className)}>
                        {badge.label}
                      </span>
                    </td>
                    <td className={cn(
                      "py-2.5 px-4 text-right font-mono font-medium",
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
