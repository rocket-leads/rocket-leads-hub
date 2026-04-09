"use client"

import { format, startOfMonth } from "date-fns"
import { useDateRange } from "../_hooks/use-date-range"
import { useDeliveryData } from "../_hooks/use-delivery-data"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import { cn } from "@/lib/utils"

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

export function DeliveryTab() {
  const { range, setStartDate, setEndDate, presets, applyPreset } = useDateRange()
  const startDate = format(range.startDate, "yyyy-MM-dd")
  const endDate = format(range.endDate, "yyyy-MM-dd")
  const { data, loading } = useDeliveryData(startDate, endDate)

  const churnColor = (data?.churnRate ?? 0) < 0.05
    ? "bg-green-500/20 text-green-500"
    : (data?.churnRate ?? 0) < 0.1
    ? "bg-primary/20 text-primary"
    : "bg-red-500/20 text-red-500"

  return (
    <div className="space-y-4">
      {/* Date picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(new Date(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(new Date(e.target.value))}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          />
        </div>
        <div className="flex gap-1">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="h-7 px-2.5 text-[11px] rounded-md bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue KPIs */}
      <div>
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">Revenue</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <StatCard label="Total Revenue" value={formatCurrency(data?.totalRevenue ?? 0)} loading={loading} />
          <StatCard label="MRR" value={formatCurrency(data?.mrr ?? 0)} sub="Returning customers" loading={loading} />
          <StatCard label="New Business" value={formatCurrency(data?.newBusiness ?? 0)} sub="First-time customers" loading={loading} />
          <StatCard label="Avg Revenue / Customer" value={formatCurrency(data?.avgRevenuePerCustomer ?? 0)} loading={loading} />
          <StatCard label="Active Customers" value={String(data?.activeCustomers ?? 0)} loading={loading} />
        </div>
      </div>

      {/* Churn */}
      <div>
        <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">Retention</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <StatCard
            label="Churn Rate"
            value={formatPercent(data?.churnRate ?? 0)}
            badge={`${data?.churned ?? 0} lost`}
            badgeColor={churnColor}
            loading={loading}
          />
          <StatCard label="Previous Period" value={`${data?.previousPeriodCustomers ?? 0} customers`} loading={loading} />
          <StatCard label="Current Period" value={`${data?.currentPeriodCustomers ?? 0} customers`} loading={loading} />
          <StatCard
            label="Net Change"
            value={`${((data?.currentPeriodCustomers ?? 0) - (data?.previousPeriodCustomers ?? 0) >= 0 ? "+" : "")}${(data?.currentPeriodCustomers ?? 0) - (data?.previousPeriodCustomers ?? 0)}`}
            loading={loading}
          />
        </div>
      </div>

      {/* Revenue by Account Manager */}
      {data?.byAccountManager && data.byAccountManager.length > 0 && (
        <div>
          <h2 className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">Revenue by Account Manager</h2>
          <div className="bg-card rounded-lg border border-border/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="text-left py-2.5 px-4 text-muted-foreground font-medium">Account Manager</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Customers</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">MRR</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">New Business</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.byAccountManager.map((am) => (
                  <tr key={am.name} className="border-b border-border/20 last:border-0">
                    <td className="py-2.5 px-4 font-medium">{am.name}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{am.customers}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(am.mrr)}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(am.newBusiness)}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-medium">{formatCurrency(am.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
