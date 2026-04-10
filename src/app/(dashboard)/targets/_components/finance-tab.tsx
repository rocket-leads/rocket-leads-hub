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
  const { finance, costs, profit, loading } = useFinanceData(year, month)
  const { data: targets } = useTargetsConfig()
  const t = targets ?? null

  const sf = finance?.serviceFee
  const nb = finance?.serviceFeeNewBusiness
  const mrr = finance?.serviceFeeMrr

  // Pro-rata expected (only meaningful for current month)
  const proRataFactor = (() => {
    if (!isCurrentMonth) return 1
    const today = new Date()
    const daysInMonth = getDaysInMonth(today)
    return today.getDate() / daysInMonth
  })()
  const expectedServiceFee = t?.serviceFeeRevenue ? t.serviceFeeRevenue * proRataFactor : undefined
  const expectedAdBudget = t?.adBudgetRevenue ? t.adBudgetRevenue * proRataFactor : undefined
  const expectedTotalCosts = t?.totalCosts ? t.totalCosts * proRataFactor : undefined
  const expectedNetProfit = t?.netProfit ? t.netProfit * proRataFactor : undefined

  // Total revenue target = service fee invoiced only
  const totalRevenueTarget = t?.serviceFeeRevenue ?? 0
  const totalRevenueExpected = totalRevenueTarget * proRataFactor
  const totalRevenueActual = sf?.invoiced ?? 0

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
          current={totalRevenueActual}
          proRata={totalRevenueExpected}
          monthlyTarget={totalRevenueTarget}
          isLoading={loading}
        />
      )}

      {/* ── REVENUE — SERVICE FEE ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue — Service Fee</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* Each column: main card + two sub-cards, all columns same structure */}
          {([
            {
              label: "Invoiced", value: sf?.invoiced ?? null, formatted: formatCurrency(sf?.invoiced ?? 0),
              variant: "neutral" as const,
              nbVal: formatCurrency(nb?.invoiced ?? 0), mrrVal: formatCurrency(mrr?.invoiced ?? 0),
            },
            {
              label: "Cash Collected", value: sf?.cashCollected ?? null, formatted: formatCurrency(sf?.cashCollected ?? 0),
              variant: "neutral" as const,
              nbVal: formatCurrency(nb?.cashCollected ?? 0), mrrVal: formatCurrency(mrr?.cashCollected ?? 0),
            },
            {
              label: "Open", value: sf?.open ?? null, formatted: formatCurrency(sf?.open ?? 0),
              variant: "neutral" as const,
              nbVal: formatCurrency(nb?.open ?? 0), mrrVal: formatCurrency(mrr?.open ?? 0),
            },
            {
              label: "Overdue", value: sf?.overdue ?? null, formatted: formatCurrency(sf?.overdue ?? 0),
              variant: "neutral" as const,
              nbVal: formatCurrency(nb?.overdue ?? 0), mrrVal: formatCurrency(mrr?.overdue ?? 0),
            },
          ] as Array<{
            label: string; value: number | null; formatted: string;
            target?: number; targetFormatted?: string;
            expected?: number; expectedFormatted?: string;
            variant: "cost" | "volume" | "neutral";
            nbVal: string; mrrVal: string;
          }>).map((col) => (
            <div key={col.label} className="flex flex-col gap-1">
              <KpiCard
                label={col.label} value={col.value} formatted={col.formatted}
                target={col.target} targetFormatted={col.targetFormatted}
                expected={col.expected} expectedFormatted={col.expectedFormatted}
                variant={col.variant} isLoading={loading}
              />
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
          <KpiCard
            label="Invoiced"
            value={finance?.adBudget?.invoiced ?? null}
            formatted={formatCurrency(finance?.adBudget?.invoiced ?? 0)}
            target={t?.adBudgetRevenue || undefined}
            targetFormatted={t?.adBudgetRevenue ? `${formatCurrency(finance?.adBudget?.invoiced ?? 0)} of ${formatCurrency(t.adBudgetRevenue)}` : undefined}
            expected={expectedAdBudget}
            expectedFormatted={expectedAdBudget != null ? formatCurrency(expectedAdBudget) : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard label="Cash Collected" value={finance?.adBudget?.cashCollected ?? null} formatted={formatCurrency(finance?.adBudget?.cashCollected ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Open" value={finance?.adBudget?.open ?? null} formatted={formatCurrency(finance?.adBudget?.open ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Overdue" value={finance?.adBudget?.overdue ?? null} formatted={formatCurrency(finance?.adBudget?.overdue ?? 0)} variant="neutral" isLoading={loading} />
        </div>
      </div>

      {/* ── COSTS ── */}
      {(() => {
        const teamEst = costs?.estimated.teamCosts ?? false
        const mktEst = costs?.estimated.marketingCosts ?? false
        const hqEst = costs?.estimated.hqCosts ?? false
        // Total is estimated if any sub-cost is estimated
        const totalEst = teamEst || mktEst || hqEst
        // Profit / margin / accounting profit derive from costs, so they inherit the estimated flag
        const profitEst = totalEst

        return (
          <>
            <div className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Costs</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <KpiCard
                  label="Total Costs"
                  value={costs?.totalCosts ?? null}
                  formatted={formatCurrency(costs?.totalCosts ?? 0)}
                  target={t?.totalCosts || undefined}
                  targetFormatted={t?.totalCosts ? `${formatCurrency(costs?.totalCosts ?? 0)} of ${formatCurrency(t.totalCosts)}` : undefined}
                  expected={expectedTotalCosts}
                  expectedFormatted={expectedTotalCosts != null ? formatCurrency(expectedTotalCosts) : undefined}
                  isEstimated={totalEst}
                  variant="cost"
                  isLoading={loading}
                />
                <KpiCard label="Team Costs" value={costs?.teamCosts ?? null} formatted={formatCurrency(costs?.teamCosts ?? 0)} isEstimated={teamEst} variant="neutral" isLoading={loading} />
                <KpiCard label="Marketing Costs" value={costs?.marketingCosts ?? null} formatted={formatCurrency(costs?.marketingCosts ?? 0)} isEstimated={mktEst} variant="neutral" isLoading={loading} />
                <KpiCard label="HQ Costs" value={costs?.hqCosts ?? null} formatted={formatCurrency(costs?.hqCosts ?? 0)} isEstimated={hqEst} variant="neutral" isLoading={loading} />
              </div>
            </div>

            {/* ── PROFIT ── */}
            <div className="space-y-3">
              <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Profit</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <KpiCard label="Revenue (Cash)" value={profit?.revenue ?? null} formatted={formatCurrency(profit?.revenue ?? 0)} variant="neutral" isLoading={loading} />
                <KpiCard
                  label="Net Profit"
                  value={profit?.netProfit ?? null}
                  formatted={formatCurrency(profit?.netProfit ?? 0)}
                  target={t?.netProfit || undefined}
                  targetFormatted={t?.netProfit ? `${formatCurrency(profit?.netProfit ?? 0)} of ${formatCurrency(t.netProfit)}` : undefined}
                  expected={expectedNetProfit}
                  expectedFormatted={expectedNetProfit != null ? formatCurrency(expectedNetProfit) : undefined}
                  isEstimated={profitEst}
                  variant="volume"
                  isLoading={loading}
                />
                <KpiCard
                  label="Margin"
                  value={profit?.margin ?? null}
                  formatted={formatPercent(profit?.margin ?? 0)}
                  target={t?.profitMargin || undefined}
                  targetFormatted={t?.profitMargin ? `${formatPercent(profit?.margin ?? 0)} of ${formatPercent(t.profitMargin)}` : undefined}
                  isEstimated={profitEst}
                  variant="volume"
                  isLoading={loading}
                />
                <KpiCard label="Accounting Profit" value={profit?.accountingProfit ?? null} formatted={formatCurrency(profit?.accountingProfit ?? 0)} isEstimated={profitEst} variant="neutral" isLoading={loading} />
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}
