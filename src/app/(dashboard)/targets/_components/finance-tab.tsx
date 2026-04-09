"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useFinanceData, useMonthSelector } from "../_hooks/use-finance-data"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"
import type { CategoryBreakdown } from "@/types/targets"

function StatCard({ label, value, sub, badge, badgeColor, loading }: {
  label: string; value: string; sub?: string; badge?: string; badgeColor?: string; loading: boolean
}) {
  if (loading) {
    return (
      <div className="bg-card rounded-lg p-3 flex flex-col gap-2 border border-border/40">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-28" />
      </div>
    )
  }
  return (
    <div className="bg-card rounded-lg p-3 border border-border/40">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground block">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold font-mono text-foreground">{value}</span>
        {badge && (
          <span className={cn("text-[10px] font-mono font-medium px-1.5 py-0.5 rounded", badgeColor)}>
            {badge}
          </span>
        )}
      </div>
      {sub && <span className="text-[9px] text-muted-foreground/60 block mt-0.5">{sub}</span>}
    </div>
  )
}

function RevenueRow({ title, data, loading }: { title: string; data: CategoryBreakdown | null; loading: boolean }) {
  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">{title}</h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Invoiced" value={formatCurrency(data?.invoiced ?? 0)} loading={loading} />
        <StatCard label="Cash Collected" value={formatCurrency(data?.cashCollected ?? 0)} loading={loading} />
        <StatCard label="Open" value={formatCurrency(data?.open ?? 0)} loading={loading} />
        <StatCard label="Overdue" value={formatCurrency(data?.overdue ?? 0)} loading={loading} />
      </div>
    </div>
  )
}

function CostTable({ title, rows, loading }: {
  title: string; rows: { label: string; value: number }[]; loading: boolean
}) {
  if (loading) {
    return (
      <div className="bg-card rounded-lg p-4 border border-border/40">
        <Skeleton className="h-4 w-32 mb-3" />
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
      </div>
    )
  }
  return (
    <div className="bg-card rounded-lg p-4 border border-border/40">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div
            key={row.label}
            className={cn(
              "flex items-center justify-between py-1.5 text-xs",
              i === rows.length - 1 && "border-t border-border/50 font-medium",
            )}
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-mono text-foreground">{formatCurrency(row.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FinanceTab() {
  const { year, month, label, isCurrentMonth, goToPrev, goToNext } = useMonthSelector()
  const { finance, costs, profit, loading } = useFinanceData(year, month)

  const margin = profit?.margin ?? 0
  const marginColor = margin > 0.3
    ? "bg-green-500/20 text-green-500"
    : margin > 0.15
    ? "bg-primary/20 text-primary"
    : "bg-red-500/20 text-red-500"

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

      {/* ── REVENUE ── */}
      <div className="space-y-4">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue</h2>
        <RevenueRow title="Service Fee" data={finance?.serviceFee ?? null} loading={loading} />
        <RevenueRow title="Ad Budget" data={finance?.adBudget ?? null} loading={loading} />
      </div>

      {/* ── COSTS ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Costs</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <CostTable
            title="Team Costs"
            rows={[
              { label: "NL", value: costs?.teamCosts.nl ?? 0 },
              { label: "BE", value: costs?.teamCosts.be ?? 0 },
              { label: "DE", value: costs?.teamCosts.de ?? 0 },
              { label: "Total", value: costs?.teamCosts.total ?? 0 },
            ]}
            loading={loading}
          />
          <CostTable
            title="Marketing Costs"
            rows={[
              { label: "NL", value: costs?.marketingCosts.nl ?? 0 },
              { label: "BE", value: costs?.marketingCosts.be ?? 0 },
              { label: "DE", value: costs?.marketingCosts.de ?? 0 },
              { label: "Total", value: costs?.marketingCosts.total ?? 0 },
            ]}
            loading={loading}
          />
          <CostTable
            title="HQ / Other Costs"
            rows={[
              { label: "Software", value: costs?.hqCosts.software ?? 0 },
              { label: "Marketing", value: costs?.hqCosts.marketing ?? 0 },
              { label: "General", value: costs?.hqCosts.general ?? 0 },
              { label: "Total", value: costs?.hqCosts.total ?? 0 },
            ]}
            loading={loading}
          />
        </div>
      </div>

      {/* ── PROFIT ── */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Profit</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard label="Revenue (Cash)" value={formatCurrency(profit?.revenue ?? 0)} loading={loading} />
          <StatCard label="Total Costs" value={formatCurrency(profit?.costs ?? 0)} loading={loading} />
          <StatCard
            label="Net Profit"
            value={formatCurrency(profit?.netProfit ?? 0)}
            badge={formatPercent(margin)}
            badgeColor={marginColor}
            loading={loading}
          />
          <StatCard label="Accounting Profit" value={formatCurrency(profit?.accountingProfit ?? 0)} sub="Invoiced - Costs" loading={loading} />
        </div>
      </div>
    </div>
  )
}
