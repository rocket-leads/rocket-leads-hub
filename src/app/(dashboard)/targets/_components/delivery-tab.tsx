"use client"

import { format } from "date-fns"
import { useDateRange } from "../_hooks/use-date-range"
import { useDeliveryData } from "../_hooks/use-delivery-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"

export function DeliveryTab() {
  const { range, setStartDate, setEndDate, presets, applyPreset } = useDateRange()
  const startDate = format(range.startDate, "yyyy-MM-dd")
  const endDate = format(range.endDate, "yyyy-MM-dd")
  const { data, loading } = useDeliveryData(startDate, endDate)
  const { data: targets } = useTargetsConfig()
  const t = targets ?? null

  return (
    <div className="space-y-6">
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

      {/* Revenue */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiCard label="Total Revenue" value={data?.totalRevenue ?? null} formatted={formatCurrency(data?.totalRevenue ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard
            label="MRR"
            value={data?.mrr ?? null}
            formatted={formatCurrency(data?.mrr ?? 0)}
            target={t?.mrr || undefined}
            targetFormatted={t?.mrr ? `${formatCurrency(data?.mrr ?? 0)} of ${formatCurrency(t.mrr)}` : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard
            label="New Business"
            value={data?.newBusiness ?? null}
            formatted={formatCurrency(data?.newBusiness ?? 0)}
            target={t?.newBusiness || undefined}
            targetFormatted={t?.newBusiness ? `${formatCurrency(data?.newBusiness ?? 0)} of ${formatCurrency(t.newBusiness)}` : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard
            label="Avg Revenue / Customer"
            value={data?.avgRevenuePerCustomer ?? null}
            formatted={formatCurrency(data?.avgRevenuePerCustomer ?? 0)}
            target={t?.avgRevenuePerCustomer || undefined}
            targetFormatted={t?.avgRevenuePerCustomer ? `${formatCurrency(data?.avgRevenuePerCustomer ?? 0)} of ${formatCurrency(t.avgRevenuePerCustomer)}` : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard
            label="Active Customers"
            value={data?.activeCustomers ?? null}
            formatted={String(data?.activeCustomers ?? 0)}
            target={t?.activeCustomers || undefined}
            targetFormatted={t?.activeCustomers ? `${data?.activeCustomers ?? 0} of ${t.activeCustomers}` : undefined}
            variant="volume"
            isLoading={loading}
          />
        </div>
      </div>

      {/* Retention */}
      <div className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Retention</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <KpiCard
            label="Churn Rate"
            value={data?.churnRate ?? null}
            formatted={formatPercent(data?.churnRate ?? 0)}
            target={t?.maxChurnRate || undefined}
            targetFormatted={t?.maxChurnRate ? `${formatPercent(data?.churnRate ?? 0)} of ${formatPercent(t.maxChurnRate)}` : undefined}
            variant="cost"
            isLoading={loading}
          />
          <KpiCard label="Churned" value={data?.churned ?? null} formatted={String(data?.churned ?? 0)} variant="neutral" isLoading={loading} />
          <KpiCard label="Previous Period" value={data?.previousPeriodCustomers ?? null} formatted={`${data?.previousPeriodCustomers ?? 0} customers`} variant="neutral" isLoading={loading} />
          <KpiCard label="Current Period" value={data?.currentPeriodCustomers ?? null} formatted={`${data?.currentPeriodCustomers ?? 0} customers`} variant="neutral" isLoading={loading} />
        </div>
      </div>

      {/* Revenue by Account Manager */}
      {data?.byAccountManager && data.byAccountManager.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-foreground">Revenue by Account Manager</h2>
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
