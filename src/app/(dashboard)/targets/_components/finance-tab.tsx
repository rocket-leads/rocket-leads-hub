"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { getDaysInMonth } from "date-fns"
import { useFinanceData, useMonthSelector } from "../_hooks/use-finance-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { RevenueProgressBar } from "./revenue-progress-bar"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"

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

  // ── Projected cash collected (full-month) ──
  // Use historical collection rate (collected / invoiced) × projected invoiced
  const collectionRate = costs?.avgCollectionRate ?? 0
  const projectedCashCollected = projectedServiceFee * collectionRate

  // ── Projected profit (full-month, based on projected cash) ──
  const projectedNetProfit = projectedCashCollected - totalCosts
  const projectedMargin = projectedCashCollected > 0 ? projectedNetProfit / projectedCashCollected : 0

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

      {/* ── PROJECTED END-OF-MONTH (only for current month) ── */}
      {isCurrentMonth && !loading && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Projected End of Month</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <KpiCard
              label="Exp. Invoiced"
              value={projectedServiceFee}
              formatted={formatCurrency(projectedServiceFee)}
              isEstimated
              variant="neutral"
              isLoading={loading}
            />
            <KpiCard
              label="Exp. Cash Collected"
              value={projectedCashCollected}
              formatted={formatCurrency(projectedCashCollected)}
              isEstimated
              variant="neutral"
              isLoading={loading}
            />
            <KpiCard
              label="Exp. Total Costs"
              value={totalCosts}
              formatted={formatCurrency(totalCosts)}
              isEstimated={anyEstimated}
              variant="neutral"
              isLoading={loading}
            />
            <KpiCard
              label="Exp. Net Profit"
              value={projectedNetProfit}
              formatted={formatCurrency(projectedNetProfit)}
              target={t?.netProfit || undefined}
              targetFormatted={t?.netProfit ? `${formatCurrency(projectedNetProfit)} of ${formatCurrency(t.netProfit)}` : undefined}
              isEstimated
              variant="volume"
              isLoading={loading}
            />
            <KpiCard
              label="Exp. Margin"
              value={projectedMargin}
              formatted={formatPercent(projectedMargin)}
              target={t?.profitMargin || undefined}
              targetFormatted={t?.profitMargin ? `${formatPercent(projectedMargin)} of ${formatPercent(t.profitMargin)}` : undefined}
              isEstimated
              variant="volume"
              isLoading={loading}
            />
          </div>
        </div>
      )}

      {/* ── REVENUE — SERVICE FEE ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue — Service Fee</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            { label: "Invoiced", value: sf?.invoiced ?? null, formatted: formatCurrency(sf?.invoiced ?? 0), nbVal: formatCurrency(nb?.invoiced ?? 0), mrrVal: formatCurrency(mrr?.invoiced ?? 0) },
            { label: "Cash Collected", value: sf?.cashCollected ?? null, formatted: formatCurrency(sf?.cashCollected ?? 0), nbVal: formatCurrency(nb?.cashCollected ?? 0), mrrVal: formatCurrency(mrr?.cashCollected ?? 0) },
            { label: "Open", value: sf?.open ?? null, formatted: formatCurrency(sf?.open ?? 0), nbVal: formatCurrency(nb?.open ?? 0), mrrVal: formatCurrency(mrr?.open ?? 0) },
            { label: "Overdue", value: sf?.overdue ?? null, formatted: formatCurrency(sf?.overdue ?? 0), nbVal: formatCurrency(nb?.overdue ?? 0), mrrVal: formatCurrency(mrr?.overdue ?? 0) },
          ]).map((col) => (
            <div key={col.label} className="flex flex-col gap-1">
              <KpiCard label={col.label} value={col.value} formatted={col.formatted} variant="neutral" isLoading={loading} />
              <div className="grid grid-cols-2 gap-1">
                <SubCard label="New Biz" value={col.nbVal} loading={loading} />
                <SubCard label="MRR" value={col.mrrVal} loading={loading} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── REVENUE — AD BUDGET ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue — Ad Budget</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard label="Invoiced" value={finance?.adBudget?.invoiced ?? null} formatted={formatCurrency(finance?.adBudget?.invoiced ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Cash Collected" value={finance?.adBudget?.cashCollected ?? null} formatted={formatCurrency(finance?.adBudget?.cashCollected ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Open" value={finance?.adBudget?.open ?? null} formatted={formatCurrency(finance?.adBudget?.open ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Overdue" value={finance?.adBudget?.overdue ?? null} formatted={formatCurrency(finance?.adBudget?.overdue ?? 0)} variant="neutral" isLoading={loading} />
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

      {/* ── CASH FLOW BALANCE ── */}
      {(() => {
        const cashServiceFee = sf?.cashCollected ?? 0
        const netProfit = cashServiceFee - totalCosts
        const margin = cashServiceFee > 0 ? netProfit / cashServiceFee : 0

        return (
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Cash Flow Balance</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <KpiCard label="Revenue (Cash SF)" value={cashServiceFee} formatted={formatCurrency(cashServiceFee)} variant="neutral" isLoading={loading} />
              <KpiCard label="Total Costs" value={totalCosts} formatted={formatCurrency(totalCosts)} isEstimated={anyEstimated} variant="neutral" isLoading={loading} />
              <KpiCard
                label="Net Profit"
                value={netProfit}
                formatted={formatCurrency(netProfit)}
                target={t?.netProfit || undefined}
                targetFormatted={t?.netProfit ? `${formatCurrency(netProfit)} of ${formatCurrency(t.netProfit)}` : undefined}
                isEstimated={anyEstimated}
                variant="volume"
                isLoading={loading}
              />
              <KpiCard
                label="Margin"
                value={margin}
                formatted={formatPercent(margin)}
                target={t?.profitMargin || undefined}
                targetFormatted={t?.profitMargin ? `${formatPercent(margin)} of ${formatPercent(t.profitMargin)}` : undefined}
                isEstimated={anyEstimated}
                variant="volume"
                isLoading={loading}
              />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
