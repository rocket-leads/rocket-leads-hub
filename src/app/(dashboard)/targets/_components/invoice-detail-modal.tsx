"use client"

import { useEffect, useState } from "react"
import { ArrowUpDown } from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"
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

// 187N bare status label (dot + mono uppercase, no fill) - tone maps to the
// design-system status tokens via the `.st-label` classes in globals.css.
type StTone = "live" | "warn" | "error" | "pending" | "idle"
const STATUS_BADGE: Record<InvoiceDetail["status"], { label: string; tone: StTone; order: number }> = {
  paid: { label: "Paid", tone: "live", order: 1 },
  open: { label: "Open", tone: "warn", order: 2 },
  overdue: { label: "Overdue", tone: "error", order: 3 },
  credit: { label: "Credit", tone: "pending", order: 4 },
  credit_prev: { label: "Credit (prev)", tone: "pending", order: 5 },
  credit_old: { label: "Credit (old)", tone: "idle", order: 6 },
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
      <div className="absolute inset-0 bg-foreground/25 supports-backdrop-filter:backdrop-blur-sm" onClick={onClose} />

      <div style={{ position: "fixed", top: "15vh", left: "50%", transform: "translateX(-50%)", width: "90vw", maxWidth: "48rem", height: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }} className="bg-popover ring-1 ring-foreground/10 rounded-2xl shadow-2xl z-50">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border/40 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">{title}</h2>
            <span className="text-xs text-muted-foreground">{details.length} line items</span>
          </div>
          <DismissButton onClick={onClose} stopPropagation={false} />
        </div>

        {/* Summary */}
        <div className="px-6 py-4 border-b border-border/40 bg-muted/10 shrink-0">
          <div className="grid grid-cols-4 gap-3">
            {/* Invoiced */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Invoiced</span>
              <span className="text-base font-bold font-mono text-foreground">{formatCurrency(totalInvoiced)}</span>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                <div className="flex justify-between"><span className="text-[var(--st-live)]">Paid</span><span className="font-mono text-[var(--st-live)]">{formatCurrency(totalPaid)}</span></div>
                {totalOpen > 0 && <div className="flex justify-between"><span className="text-[var(--st-warn)]">Open</span><span className="font-mono text-[var(--st-warn)]">{formatCurrency(totalOpen)}</span></div>}
                {totalOverdue > 0 && <div className="flex justify-between"><span className="text-[var(--st-error)]">Overdue</span><span className="font-mono text-[var(--st-error)]">{formatCurrency(totalOverdue)}</span></div>}
              </div>
            </div>

            {/* Credits */}
            <div className="bg-card rounded-lg p-3 border border-border/40">
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground block mb-1">Credits</span>
              <span className="text-base font-bold font-mono text-foreground">{allCredited > 0 ? `-${formatCurrency(allCredited)}` : "€0"}</span>
              <div className="mt-1.5 space-y-0.5 text-[10px]">
                {sameMonthCredited > 0 && <div className="flex justify-between"><span className="text-[var(--st-pending)]">This month</span><span className="font-mono text-[var(--st-pending)]">-{formatCurrency(sameMonthCredited)}</span></div>}
                {prevMonthCredited > 0 && <div className="flex justify-between"><span className="text-[var(--st-pending)]/70">Prev month</span><span className="font-mono text-[var(--st-pending)]/70">-{formatCurrency(prevMonthCredited)}</span></div>}
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
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">Filter</span>
          <div className="flex gap-1.5 flex-wrap">
            {FILTER_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn("chip h-7", filter === key && "active")}
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
                <th className="text-left py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium cursor-pointer select-none" onClick={() => toggleSort("date")}>
                  <span className="flex items-center gap-1">Date {sortKey === "date" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-left py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium">Invoice</th>
                <th className="text-left py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium cursor-pointer select-none" onClick={() => toggleSort("customer")}>
                  <span className="flex items-center gap-1">Customer {sortKey === "customer" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-left py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium">Type</th>
                <th className="text-left py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  <span className="flex items-center gap-1">Status {sortKey === "status" && <ArrowUpDown className="h-2.5 w-2.5" />}</span>
                </th>
                <th className="text-right py-2 px-5 font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium cursor-pointer select-none" onClick={() => toggleSort("amount")}>
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
                      ) : "-"}
                    </td>
                    <td className="py-2 px-5 truncate max-w-[180px]">{d.customerName || "-"}</td>
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
                      <span className={`st-label ${badge.tone}`}>
                        <span className="sd" />
                        {badge.label}
                      </span>
                    </td>
                    <td className={cn(
                      "py-2 px-5 text-right font-mono font-medium",
                      d.amount < 0 ? "text-[var(--st-error)]" : "text-foreground",
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
