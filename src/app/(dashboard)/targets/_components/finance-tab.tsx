"use client"

import { useState, useCallback } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { getDaysInMonth } from "date-fns"
import { useFinanceData, useMonthSelector } from "../_hooks/use-finance-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { RevenueProgressBar } from "./revenue-progress-bar"
import { InvoiceDetailModal } from "./invoice-detail-modal"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import type { InvoiceDetail } from "@/types/targets"

function SubCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-muted/30 rounded-lg p-3 flex flex-col gap-0.5 border border-border/20">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-6 w-20" />
      </div>
    )
  }
  return (
    <div className="bg-muted/30 rounded-lg p-3 flex flex-col gap-0.5 border border-border/20 h-full">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
      <span className="text-xl font-bold font-mono leading-tight tracking-tight text-foreground">{value}</span>
    </div>
  )
}

export function FinanceTab() {
  const { year, month, label, isCurrentMonth, goToPrev, goToNext } = useMonthSelector()
  const { finance, costs, loading } = useFinanceData(year, month)
  const { data: targets } = useTargetsConfig()
  const t = targets ?? null

  // Drill-down modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState("")
  const [modalDetails, setModalDetails] = useState<InvoiceDetail[]>([])

  const openDetail = useCallback((title: string, filter: (d: InvoiceDetail) => boolean) => {
    const all = finance?.details ?? []
    setModalTitle(title)
    setModalDetails(all.filter(filter))
    setModalOpen(true)
  }, [finance?.details])

  const sf = finance?.serviceFee
  const nb = finance?.serviceFeeNewBusiness
  const mrr = finance?.serviceFeeMrr

  // ── Pro-rata factor: how far through the month are we ──
  const proRataFactor = (() => {
    if (!isCurrentMonth) return 1
    const today = new Date()
    const daysInMonth = getDaysInMonth(today)
    return today.getDate() / daysInMonth
  })()

  // ── Revenue actuals ──
  const actualServiceFee = sf?.invoiced ?? 0
  // ── PROJECTED full-month revenue (extrapolate at current pace) ──
  const projectedServiceFee = isCurrentMonth && proRataFactor > 0 ? actualServiceFee / proRataFactor : actualServiceFee

  // ── Costs: the API returns full-month values (either actual from sheet or 3-month average) ──
  const teamCosts = costs?.teamCosts ?? 0
  const marketingCosts = costs?.marketingCosts ?? 0
  const hqCosts = costs?.hqCosts ?? 0
  const totalCosts = costs?.totalCosts ?? 0
  const teamEst = costs?.estimated.teamCosts ?? false
  const mktEst = costs?.estimated.marketingCosts ?? false
  const anyEstimated = teamEst || mktEst

  // ── Projected profit uses projected invoiced as revenue base ──

  // ── Target progress bar ──
  const totalRevenueTarget = t?.serviceFeeRevenue ?? 0
  const totalRevenueExpected = totalRevenueTarget * proRataFactor

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="flex items-center gap-3">
        <button onClick={goToPrev} className="h-8 w-8 rounded-md bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium min-w-[80px] text-center">{label}</span>
        <button onClick={goToNext} disabled={isCurrentMonth} className="h-8 w-8 rounded-md bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Service Fee Invoiced progress bar */}
      {totalRevenueTarget > 0 && (
        <RevenueProgressBar
          label="Service Fee — Invoiced"
          current={actualServiceFee}
          proRata={totalRevenueExpected}
          monthlyTarget={totalRevenueTarget}
          isLoading={loading}
        />
      )}

      {/* ── REVENUE — SERVICE FEE ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue — Service Fee</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="flex flex-col gap-1 cursor-pointer" onClick={() => openDetail("Service Fee — Invoiced", (d) => d.category === "service_fee")}>
            <KpiCard label="Invoiced" value={sf?.invoiced ?? null} formatted={formatCurrency(sf?.invoiced ?? 0)} variant="neutral" isLoading={loading} />
            <div className="grid grid-cols-2 gap-1">
              <SubCard label="New Biz" value={formatCurrency(nb?.invoiced ?? 0)} loading={loading} />
              <SubCard label="MRR" value={formatCurrency(mrr?.invoiced ?? 0)} loading={loading} />
            </div>
          </div>
          <div className="flex flex-col gap-1 cursor-pointer" onClick={() => openDetail("Service Fee — Cash Collected", (d) => d.category === "service_fee" && (d.status === "paid" || d.status === "credit" || d.status === "credit_old"))}>
            <KpiCard label="Cash Collected" value={sf?.cashCollected ?? null} formatted={formatCurrency(sf?.cashCollected ?? 0)} variant="neutral" isLoading={loading} />
            <div className="grid grid-cols-2 gap-1">
              <SubCard label="New Biz" value={formatCurrency(nb?.cashCollected ?? 0)} loading={loading} />
              <SubCard label="MRR" value={formatCurrency(mrr?.cashCollected ?? 0)} loading={loading} />
            </div>
          </div>
          <div className="flex flex-col gap-1 cursor-pointer" onClick={() => openDetail("Service Fee — Open", (d) => d.category === "service_fee" && d.status === "open")}>
            <KpiCard label="Open" value={sf?.open ?? null} formatted={formatCurrency(sf?.open ?? 0)} variant="neutral" isLoading={loading} />
            <div className="grid grid-cols-2 gap-1">
              <SubCard label="New Biz" value={formatCurrency(nb?.open ?? 0)} loading={loading} />
              <SubCard label="MRR" value={formatCurrency(mrr?.open ?? 0)} loading={loading} />
            </div>
          </div>
          <div className="flex flex-col gap-1 cursor-pointer" onClick={() => openDetail("Service Fee — Overdue", (d) => d.category === "service_fee" && d.status === "overdue")}>
            <KpiCard label="Overdue" value={sf?.overdue ?? null} formatted={formatCurrency(sf?.overdue ?? 0)} variant="neutral" isLoading={loading} />
            <div className="grid grid-cols-2 gap-1">
              <SubCard label="New Biz" value={formatCurrency(nb?.overdue ?? 0)} loading={loading} />
              <SubCard label="MRR" value={formatCurrency(mrr?.overdue ?? 0)} loading={loading} />
            </div>
          </div>
        </div>
      </div>

      {/* ── REVENUE — AD BUDGET ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue — Ad Budget</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="cursor-pointer" onClick={() => openDetail("Ad Budget — Invoiced", (d) => d.category === "ad_budget")}>
            <KpiCard label="Invoiced" value={finance?.adBudget?.invoiced ?? null} formatted={formatCurrency(finance?.adBudget?.invoiced ?? 0)} variant="neutral" isLoading={loading} />
          </div>
          <div className="cursor-pointer" onClick={() => openDetail("Ad Budget — Cash Collected", (d) => d.category === "ad_budget" && (d.status === "paid" || d.status === "credit"))}>
            <KpiCard label="Cash Collected" value={finance?.adBudget?.cashCollected ?? null} formatted={formatCurrency(finance?.adBudget?.cashCollected ?? 0)} variant="neutral" isLoading={loading} />
          </div>
          <div className="cursor-pointer" onClick={() => openDetail("Ad Budget — Open", (d) => d.category === "ad_budget" && d.status === "open")}>
            <KpiCard label="Open" value={finance?.adBudget?.open ?? null} formatted={formatCurrency(finance?.adBudget?.open ?? 0)} variant="neutral" isLoading={loading} />
          </div>
          <div className="cursor-pointer" onClick={() => openDetail("Ad Budget — Overdue", (d) => d.category === "ad_budget" && d.status === "overdue")}>
            <KpiCard label="Overdue" value={finance?.adBudget?.overdue ?? null} formatted={formatCurrency(finance?.adBudget?.overdue ?? 0)} variant="neutral" isLoading={loading} />
          </div>
        </div>
      </div>

      {/* ── COSTS (full-month: actual from sheet or 3-month average) ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Costs (Full Month)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard label="Total Costs" value={totalCosts} formatted={formatCurrency(totalCosts)} isEstimated={anyEstimated} variant="neutral" isLoading={loading} />
          <KpiCard label="Team Costs" value={teamCosts} formatted={formatCurrency(teamCosts)} isEstimated={teamEst} variant="neutral" isLoading={loading} />
          <KpiCard label="Marketing Costs" value={marketingCosts} formatted={formatCurrency(marketingCosts)} isEstimated={mktEst} variant="neutral" isLoading={loading} />
          <KpiCard label="HQ Costs" value={hqCosts} formatted={formatCurrency(hqCosts)} variant="neutral" isLoading={loading} />
        </div>
      </div>

      {/* ── PROFIT ── */}
      {(() => {
        const revenueForProfit = projectedServiceFee
        const netProfit = revenueForProfit - totalCosts
        const margin = revenueForProfit > 0 ? netProfit / revenueForProfit : 0

        return (
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Profit</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KpiCard label="Revenue" value={revenueForProfit} formatted={formatCurrency(revenueForProfit)} isEstimated={isCurrentMonth} variant="neutral" isLoading={loading} />
              <KpiCard label="Total Costs" value={totalCosts} formatted={formatCurrency(totalCosts)} isEstimated={anyEstimated} variant="neutral" isLoading={loading} />
              <KpiCard
                label="Net Profit"
                value={netProfit}
                formatted={formatCurrency(netProfit)}
                target={t?.netProfit || undefined}
                targetFormatted={t?.netProfit ? `${formatCurrency(netProfit)} of ${formatCurrency(t.netProfit)}` : undefined}
                isEstimated={isCurrentMonth || anyEstimated}
                variant="volume"
                isLoading={loading}
              />
              <KpiCard
                label="Margin"
                value={margin}
                formatted={formatPercent(margin)}
                target={t?.profitMargin || undefined}
                targetFormatted={t?.profitMargin ? `${formatPercent(margin)} of ${formatPercent(t.profitMargin)}` : undefined}
                isEstimated={isCurrentMonth || anyEstimated}
                variant="volume"
                isLoading={loading}
              />
            </div>
          </div>
        )
      })()}

      {/* Drill-down modal */}
      <InvoiceDetailModal
        title={modalTitle}
        details={modalDetails}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  )
}
