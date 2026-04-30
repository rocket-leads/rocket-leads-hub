"use client"

import { Fragment, useState } from "react"
import { format } from "date-fns"
import { useQueryClient } from "@tanstack/react-query"
import { useDateRange } from "../_hooks/use-date-range"
import { useDeliveryData } from "../_hooks/use-delivery-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { KpiCard } from "./kpi-card"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import type { UnassignedCustomer, UnlinkedMondayItem } from "@/types/targets"

export function DeliveryTab() {
  const { range, setStartDate, setEndDate, presets, applyPreset } = useDateRange()
  const startDate = format(range.startDate, "yyyy-MM-dd")
  const endDate = format(range.endDate, "yyyy-MM-dd")
  const { data, loading } = useDeliveryData(startDate, endDate)
  const { data: targets } = useTargetsConfig()
  const t = targets ?? null
  const [showUnassigned, setShowUnassigned] = useState(false)

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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
            label="Service Fee Revenue"
            value={data?.serviceFeeRevenue ?? null}
            formatted={formatCurrency(data?.serviceFeeRevenue ?? 0)}
            variant="neutral"
            isLoading={loading}
          />
          <KpiCard
            label="Ad Budget"
            value={data?.adBudget ?? null}
            formatted={formatCurrency(data?.adBudget ?? 0)}
            variant="neutral"
            isLoading={loading}
          />
          <KpiCard
            label="Total Revenue"
            value={data?.totalRevenue ?? null}
            formatted={formatCurrency(data?.totalRevenue ?? 0)}
            variant="neutral"
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
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Ad Budget</th>
                  <th className="text-right py-2.5 px-4 text-muted-foreground font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.byAccountManager.map((am) => {
                  const isUnassigned = am.name === "Unassigned"
                  const expandable = isUnassigned && (data.unassignedCustomers?.length ?? 0) > 0
                  const expanded = expandable && showUnassigned
                  return (
                    <Fragment key={am.name}>
                      <tr
                        className={`border-b border-border/20 last:border-0 ${expandable ? "cursor-pointer hover:bg-muted/30" : ""}`}
                        onClick={expandable ? () => setShowUnassigned((v) => !v) : undefined}
                      >
                        <td className="py-2.5 px-4 font-medium">
                          <span className="flex items-center gap-1.5">
                            {expandable && (
                              <span className={`text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
                            )}
                            {am.name}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">{am.customers}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(am.mrr)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(am.newBusiness)}</td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatCurrency(am.adBudget)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-medium">{formatCurrency(am.revenue)}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-muted/20 border-b border-border/20 last:border-0">
                          <td colSpan={6} className="py-3 px-4">
                            <div className="space-y-2">
                              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                                {data.unassignedCustomers!.length} customer{data.unassignedCustomers!.length === 1 ? "" : "s"} need a fix
                              </p>
                              <div className="space-y-1">
                                {data.unassignedCustomers!.map((u) => (
                                  <UnassignedRow
                                    key={u.customerId}
                                    customer={u}
                                    unlinkedItems={data.unlinkedMondayItems ?? []}
                                  />
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Unassigned customer row ────────────────────────────────────────────────

function UnassignedRow({
  customer,
  unlinkedItems,
}: {
  customer: UnassignedCustomer
  unlinkedItems: UnlinkedMondayItem[]
}) {
  const queryClient = useQueryClient()
  const [assigning, setAssigning] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function assignTo(item: UnlinkedMondayItem) {
    if (assigning) return
    setAssigning(true)
    setError(null)
    try {
      const res = await fetch("/api/targets/delivery/assign-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripeCustomerId: customer.customerId,
          mondayItemId: item.id,
          boardType: item.boardType,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed (${res.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ["targets-delivery"] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign")
      setAssigning(false)
    }
    // On success the row will disappear via refetch — no need to reset state.
  }

  // Manual picker filtering: cap at 8 and tell the user when there are more.
  const lowerQuery = query.toLowerCase().trim()
  const filtered = lowerQuery
    ? unlinkedItems.filter((i) => i.name.toLowerCase().includes(lowerQuery))
    : unlinkedItems
  const visiblePool = filtered.slice(0, 8)
  const moreCount = Math.max(0, filtered.length - visiblePool.length)

  return (
    <div className="rounded-md bg-card border border-border/40 px-3 py-2 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{customer.customerName}</span>
            <a
              href={`https://dashboard.stripe.com/customers/${customer.customerId}`}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
            >
              Stripe ↗
            </a>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {customer.reason === "no_monday_match" ? (
              <>No Monday item links this Stripe customer.</>
            ) : (
              <>
                Linked Monday item exists but Account Manager is empty.{" "}
                {customer.mondayItemId && (
                  <a
                    href={`/clients/${customer.mondayItemId}`}
                    className="text-primary hover:underline"
                  >
                    Open client →
                  </a>
                )}
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono font-medium">{formatCurrency(customer.revenue)}</div>
          <div className="text-[10px] text-muted-foreground font-mono">
            fee {formatCurrency(customer.fee)} · ad {formatCurrency(customer.adBudget)}
          </div>
        </div>
      </div>

      {customer.reason === "no_monday_match" && (
        <div className="space-y-1.5">
          {/* Smart suggestions */}
          {customer.suggestions && customer.suggestions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                Suggested:
              </span>
              {customer.suggestions.map((s) => (
                <button
                  key={s.mondayItemId}
                  disabled={assigning}
                  onClick={() => assignTo({ id: s.mondayItemId, name: s.itemName, boardType: s.boardType })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 px-2 py-1 text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`${s.boardType} board · ${Math.round(s.score * 100)}% match`}
                >
                  <span className="font-medium">{s.itemName}</span>
                  <span className="text-[9px] text-muted-foreground">
                    {Math.round(s.score * 100)}%
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Manual picker toggle + dropdown */}
          <div>
            {!pickerOpen ? (
              <button
                disabled={assigning}
                onClick={() => setPickerOpen(true)}
                className="text-[11px] text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
              >
                {customer.suggestions && customer.suggestions.length > 0 ? "Pick another item…" : "Pick a Monday item…"}
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search Monday items..."
                    className="flex-1 h-7 rounded-md border border-border bg-card px-2 text-[11px]"
                    disabled={assigning}
                  />
                  <button
                    onClick={() => { setPickerOpen(false); setQuery("") }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    disabled={assigning}
                  >
                    Cancel
                  </button>
                </div>
                {visiblePool.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic">
                    {unlinkedItems.length === 0
                      ? "No unlinked Monday items available."
                      : "No items match this search."}
                  </p>
                ) : (
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {visiblePool.map((item) => (
                      <button
                        key={item.id}
                        disabled={assigning}
                        onClick={() => assignTo(item)}
                        className="w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-muted/50 transition-colors disabled:opacity-50"
                      >
                        <span className="truncate">{item.name}</span>
                        <span className="text-[9px] text-muted-foreground shrink-0 capitalize">
                          {item.boardType}
                        </span>
                      </button>
                    ))}
                    {moreCount > 0 && (
                      <p className="text-[10px] text-muted-foreground italic px-2 pt-1">
                        + {moreCount} more — refine your search to narrow down.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {assigning && (
            <p className="text-[10px] text-muted-foreground">Assigning…</p>
          )}
          {error && (
            <p className="text-[10px] text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
