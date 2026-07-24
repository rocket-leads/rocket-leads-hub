"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO, subDays, differenceInCalendarDays } from "date-fns"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { useDateRange } from "../_hooks/use-date-range"
import { useDeliveryData } from "../_hooks/use-delivery-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { DateRangePicker } from "./date-range-picker"
import { KpiCard } from "./kpi-card"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
import type { UnassignedCustomer, UnlinkedMondayItem, AccountManagerRevenue } from "@/types/targets"

/** Same-length window immediately preceding the selected range. Mirrors `fetchDelivery`. */
function previousPeriodRange(startDate: string, endDate: string): { start: Date; end: Date } {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  const days = differenceInCalendarDays(end, start) + 1
  return { start: subDays(start, days), end: subDays(start, 1) }
}

const SHORT_DATE = "MMM d"

export function DeliveryTab() {
  const locale = useLocale()
  const { range, setRange, presets, applyPreset } = useDateRange()
  const maxPickerDate = useMemo(() => subDays(new Date(), 1), [])
  const startDate = format(range.startDate, "yyyy-MM-dd")
  const endDate = format(range.endDate, "yyyy-MM-dd")
  const { data, loading } = useDeliveryData(startDate, endDate)
  const { data: targets } = useTargetsConfig()
  // Renamed from `t` to `tgt` so we can use the imported i18n `t()` helper.
  const tgt = targets ?? null
  const [showUnassigned, setShowUnassigned] = useState(false)
  const prevRange = previousPeriodRange(startDate, endDate)

  const customerCount = (n: number): string =>
    t(n === 1 ? "targets.delivery.customers_one" : "targets.delivery.customers_many", locale, { n: String(n) })

  return (
    <div className="space-y-6">
      {/* Date picker - same component as Marketing/Sales for consistency */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePicker
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
          maxDate={maxPickerDate}
        />
        <div className="flex gap-1.5 flex-wrap">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => applyPreset(preset)}
              className="chip h-9"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Revenue */}
      <div className="space-y-3">
        <div className="section-title">{t("targets.delivery.section.revenue", locale)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiCard
            label="MRR"
            value={data?.mrr ?? null}
            formatted={formatCurrency(data?.mrr ?? 0)}
            target={tgt?.mrr || undefined}
            targetFormatted={tgt?.mrr ? t("targets.kpi.target_of", locale, { value: formatCurrency(data?.mrr ?? 0), target: formatCurrency(tgt.mrr) }) : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard
            label="New Business"
            value={data?.newBusiness ?? null}
            formatted={formatCurrency(data?.newBusiness ?? 0)}
            target={tgt?.newBusiness || undefined}
            targetFormatted={tgt?.newBusiness ? t("targets.kpi.target_of", locale, { value: formatCurrency(data?.newBusiness ?? 0), target: formatCurrency(tgt.newBusiness) }) : undefined}
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
            label="Service Fee / Customer"
            value={data?.serviceFeePerCustomer ?? null}
            formatted={formatCurrency(data?.serviceFeePerCustomer ?? 0)}
            target={tgt?.serviceFeePerCustomer || undefined}
            targetFormatted={tgt?.serviceFeePerCustomer ? t("targets.kpi.target_of", locale, { value: formatCurrency(data?.serviceFeePerCustomer ?? 0), target: formatCurrency(tgt.serviceFeePerCustomer) }) : undefined}
            variant="volume"
            isLoading={loading}
          />
        </div>
      </div>

      {/* Retention - ordered to read like the math: prev → +new → −churned → net → current → rate */}
      <div className="space-y-3">
        <div className="section-title">{t("targets.delivery.section.retention", locale)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <RetentionCard
            label={t("targets.delivery.retention.previous", locale)}
            sublabel={`${format(prevRange.start, SHORT_DATE)} – ${format(prevRange.end, SHORT_DATE)}`}
            display={customerCount(data?.previousPeriodCustomers ?? 0)}
            tone="neutral"
            isLoading={loading}
          />
          <RetentionCard
            label={t("targets.delivery.retention.new", locale)}
            display={`+${data?.newClients ?? 0}`}
            tone="positive"
            isLoading={loading}
          />
          <RetentionCard
            label={t("targets.delivery.retention.churned", locale)}
            display={`−${data?.churned ?? 0}`}
            tone="negative"
            isLoading={loading}
          />
          <RetentionCard
            label={t("targets.delivery.retention.net", locale)}
            display={netChangeFormatted(data?.newClients ?? 0, data?.churned ?? 0)}
            tone={netChangeTone(data?.newClients ?? 0, data?.churned ?? 0)}
            isLoading={loading}
          />
          <RetentionCard
            label={t("targets.delivery.retention.current", locale)}
            sublabel={`${format(parseISO(startDate), SHORT_DATE)} – ${format(parseISO(endDate), SHORT_DATE)}`}
            display={customerCount(data?.currentPeriodCustomers ?? 0)}
            tone="neutral"
            isLoading={loading}
          />
          <KpiCard
            label="Churn Rate"
            value={data?.churnRate ?? null}
            formatted={formatPercent(data?.churnRate ?? 0)}
            target={tgt?.maxChurnRate || undefined}
            targetFormatted={tgt?.maxChurnRate ? t("targets.kpi.target_of", locale, { value: formatPercent(data?.churnRate ?? 0), target: formatPercent(tgt.maxChurnRate) }) : undefined}
            variant="cost"
            isLoading={loading}
          />
        </div>
      </div>

      {/* Revenue by Team - ranked by service fee (excl. ad budget); 1st place leftmost */}
      {data?.byTeam && data.byTeam.length > 0 && (
        <div className="space-y-3">
          <div className="section-title">{t("targets.delivery.section.revenue_by_team", locale)}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[...data.byTeam]
              .sort((a, b) => b.serviceFee - a.serviceFee)
              .map((team, i) => (
                <TeamCard key={team.name} row={team} rank={i + 1} locale={locale} />
              ))}
          </div>
        </div>
      )}

      {/* Unassigned Revenue - collapsible, only the Unassigned bucket with per-customer fix actions */}
      {data?.byAccountManager?.find((am) => am.name === "Unassigned") && (data.unassignedCustomers?.length ?? 0) > 0 && (
        <div className="space-y-3">
          <div className="section-title">{t("targets.delivery.section.unassigned", locale)}</div>
          {(() => {
            const unassigned = data.byAccountManager.find((am) => am.name === "Unassigned")!
            return (
              <div className="section-card !p-0 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowUnassigned((v) => !v)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-xs hover:bg-muted/30 transition-colors text-left"
                >
                  <span className={`text-muted-foreground transition-transform ${showUnassigned ? "rotate-90" : ""}`}>›</span>
                  <span className="font-medium flex-1">{t("targets.delivery.unassigned.label", locale)}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{customerCount(unassigned.customers)}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">MRR {formatCurrency(unassigned.mrr)}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">NB {formatCurrency(unassigned.newBusiness)}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">Ad {formatCurrency(unassigned.adBudget)}</span>
                  <span className="font-mono font-medium tabular-nums">{formatCurrency(unassigned.revenue)}</span>
                </button>
                {showUnassigned && (
                  <div className="bg-muted/20 px-4 py-3 border-t border-border/20 space-y-2">
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t(
                        data.unassignedCustomers!.length === 1 ? "targets.delivery.needs_fix_one" : "targets.delivery.needs_fix_many",
                        locale,
                        { n: String(data.unassignedCustomers!.length) },
                      )}
                    </p>
                    <div className="space-y-1">
                      {data.unassignedCustomers!.map((u) => (
                        <UnassignedRow
                          key={u.customerId}
                          customer={u}
                          unlinkedItems={data.unlinkedMondayItems ?? []}
                          locale={locale}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ─── Per-team rollup card ───────────────────────────────────────────────────

function TeamCard({ row, rank, locale }: { row: AccountManagerRevenue; rank: number; locale: Locale }) {
  // Subtle ranking through opacity of the brand purple - no medals. Position 1
  // also gets a thin top accent line so the leader is visible at a glance, but
  // the cards stay visually equal otherwise (we don't want to demotivate #2).
  const rankOpacity = rank === 1 ? "text-primary" : rank === 2 ? "text-primary/55" : "text-primary/30"
  const rankNumber = String(rank).padStart(2, "0")

  return (
    <div className="section-card space-y-4 relative overflow-hidden">
      {rank === 1 && (
        <div
          aria-hidden
          className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-primary via-primary/60 to-transparent"
        />
      )}

      <div className="flex items-baseline gap-3">
        <span className={cn("text-[11px] font-mono tracking-wider tabular-nums shrink-0", rankOpacity)}>
          {rankNumber}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate">{row.name}</h3>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
            {t(row.customers === 1 ? "targets.delivery.customers_one" : "targets.delivery.customers_many", locale, { n: String(row.customers) })}
          </p>
        </div>
      </div>

      {/* Service Fee - hero metric, ranking is based on this */}
      <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3">
        <p className="text-[10px] uppercase tracking-wider text-primary/80 font-medium">
          Service Fee Revenue
        </p>
        <p className="text-2xl font-bold font-mono leading-tight tabular-nums mt-0.5">
          {formatCurrency(row.serviceFee)}
        </p>
      </div>

      {/* Sub-metrics */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Metric label="MRR" value={row.mrr} />
        <Metric label="New Business" value={row.newBusiness} />
        <Metric label="Ad Budget" value={row.adBudget} />
        <Metric label="Service Fee / Cust" value={row.serviceFeePerCustomer} />
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <span className="text-xs font-mono tabular-nums">
        {formatCurrency(value)}
      </span>
    </div>
  )
}

// ─── Retention helpers ──────────────────────────────────────────────────────

function netChangeFormatted(newClients: number, churned: number): string {
  const delta = newClients - churned
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `−${Math.abs(delta)}`
  return "0"
}

function netChangeTone(newClients: number, churned: number): "positive" | "negative" | "neutral" {
  const delta = newClients - churned
  if (delta > 0) return "positive"
  if (delta < 0) return "negative"
  return "neutral"
}

function RetentionCard({
  label,
  sublabel,
  display,
  tone,
  isLoading,
}: {
  label: string
  sublabel?: string
  display: string
  tone: "neutral" | "positive" | "negative"
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl border border-border/60 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] px-5 py-4 flex flex-col gap-3 h-full">
        <div className="h-3 w-20 bg-muted rounded animate-pulse" />
        <div className="h-7 w-28 bg-muted rounded animate-pulse" />
      </div>
    )
  }

  // Match the 187N KpiCard chrome so retention tiles line up with the KpiCards in
  // the same grid. Tone maps to the design-system status tokens.
  const valueColor =
    tone === "positive" ? "text-[var(--st-live)]" :
    tone === "negative" ? "text-[var(--st-error)]" :
    "text-foreground"

  return (
    <div className="bg-card rounded-2xl border border-border/60 shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)] px-5 py-4 flex flex-col h-full">
      <span className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground/70 font-medium">{label}</span>
      {sublabel && (
        <span className="text-[9px] text-muted-foreground/50 mt-0.5">{sublabel}</span>
      )}
      <span className={cn(
        "font-mono text-[22px] font-bold leading-none tracking-tight tabular-nums mt-2",
        valueColor,
      )}>
        {display}
      </span>
    </div>
  )
}

// ─── Unassigned customer row ────────────────────────────────────────────────

function UnassignedRow({
  customer,
  unlinkedItems,
  locale,
}: {
  customer: UnassignedCustomer
  unlinkedItems: UnlinkedMondayItem[]
  locale: Locale
}) {
  const queryClient = useQueryClient()
  const [assigning, setAssigning] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  // Once we've fired an auto-assign for this customer, don't fire again - the
  // row disappears on the next refetch but we may render once more in the meantime.
  const autoAssignFired = useRef(false)

  // Look up existing IDs for the chosen Monday item so the API can skip its read.
  const itemsById = useMemo(() => {
    const m = new Map<string, UnlinkedMondayItem>()
    for (const i of unlinkedItems) m.set(i.id, i)
    return m
  }, [unlinkedItems])

  const assignTo = useCallback(async (item: { id: string; boardType: "onboarding" | "current" }) => {
    if (assigning) return
    setAssigning(true)
    setError(null)
    try {
      const existingStripeIds = itemsById.get(item.id)?.stripeCustomerId ?? ""
      const res = await fetch("/api/targets/delivery/assign-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stripeCustomerId: customer.customerId,
          mondayItemId: item.id,
          boardType: item.boardType,
          existingStripeIds,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed (${res.status})`)
      }
      await queryClient.invalidateQueries({ queryKey: ["targets-delivery"] })
    } catch (e) {
      setError(e instanceof Error ? e.message : t("targets.delivery.assign_failed", locale))
      setAssigning(false)
    }
    // On success the row will disappear via refetch - no need to reset state.
  }, [assigning, customer.customerId, itemsById, queryClient])

  // Auto-assign when the top fuzzy suggestion is ≥80% confident - that's "definitely
  // the same client, just not linked yet" territory. Saves a click per high-confidence
  // match and is reversible via Monday if it ever picks wrong.
  const AUTO_ASSIGN_THRESHOLD = 0.8
  useEffect(() => {
    if (autoAssignFired.current || assigning || error) return
    if (customer.reason !== "no_monday_match") return
    const top = customer.suggestions?.[0]
    if (!top || top.score < AUTO_ASSIGN_THRESHOLD) return
    autoAssignFired.current = true
    void assignTo({ id: top.mondayItemId, boardType: top.boardType })
  }, [customer, assigning, error, assignTo])

  // Manual picker filtering: cap at 30 (was 8 - too low for the ~150 item board).
  const lowerQuery = query.toLowerCase().trim()
  const filtered = lowerQuery
    ? unlinkedItems.filter((i) => i.name.toLowerCase().includes(lowerQuery))
    : unlinkedItems
  const visiblePool = filtered.slice(0, 30)
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
              <>{t("targets.delivery.no_monday_match", locale)}</>
            ) : (
              <>
                {t("targets.delivery.am_empty.before", locale)}
                {customer.mondayItemId && (
                  <a
                    href={`/clients/${customer.mondayItemId}`}
                    className="text-primary hover:underline"
                  >
                    {t("targets.delivery.open_client", locale)}
                  </a>
                )}
              </>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono font-medium">{formatCurrency(customer.revenue)}</div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {t("targets.delivery.fee_ad", locale, { fee: formatCurrency(customer.fee), ad: formatCurrency(customer.adBudget) })}
          </div>
        </div>
      </div>

      {customer.reason === "no_monday_match" && (
        <div className="space-y-1.5">
          {/* Smart suggestions */}
          {customer.suggestions && customer.suggestions.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                {t("targets.delivery.suggested", locale)}
              </span>
              {customer.suggestions.map((s) => (
                <button
                  key={s.mondayItemId}
                  disabled={assigning}
                  onClick={() => assignTo({ id: s.mondayItemId, boardType: s.boardType })}
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
                {customer.suggestions && customer.suggestions.length > 0 ? t("targets.delivery.pick_another", locale) : t("targets.delivery.pick_monday", locale)}
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("targets.delivery.search_placeholder", locale)}
                    className="flex-1 h-7 rounded-md border border-border bg-card px-2 text-[11px]"
                    disabled={assigning}
                  />
                  <button
                    onClick={() => { setPickerOpen(false); setQuery("") }}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                    disabled={assigning}
                  >
                    {t("targets.delivery.cancel", locale)}
                  </button>
                </div>
                {visiblePool.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground italic">
                    {unlinkedItems.length === 0
                      ? t("targets.delivery.no_unlinked", locale)
                      : t("targets.delivery.no_match", locale)}
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
                        {t("targets.delivery.more_results", locale, { n: String(moreCount) })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {assigning && (
            <p className="text-[10px] text-muted-foreground">{t("targets.delivery.assigning", locale)}</p>
          )}
          {error && (
            <p className="text-[10px] text-destructive">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
