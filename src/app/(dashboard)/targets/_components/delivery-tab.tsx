"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO, subDays, differenceInCalendarDays, startOfMonth, getDaysInMonth, max as dateMax } from "date-fns"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDateRange } from "../_hooks/use-date-range"
import { useDeliveryData } from "../_hooks/use-delivery-data"
import { useTargetsConfig } from "../_hooks/use-targets-config"
import { DateRangePicker } from "./date-range-picker"
import { DeliveryHero } from "./delivery-hero"
import { KpiCard } from "./kpi-card"
import { formatCurrency, formatPercent } from "@/lib/targets/formatters"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { MondayUser } from "@/lib/integrations/monday"
import type { Locale } from "@/lib/i18n/types"
import type { UnassignedCustomer, UnlinkedMondayItem, AccountManagerRevenue, ExcludedCustomer } from "@/types/targets"

type BoardType = "onboarding" | "current"
/** Local, session-only record of a Stripe↔Monday link made this session, so a
 *  `no_monday_match` row can flip to the AM-assign step in place without waiting
 *  on the (slow, read-after-write-racy) live Monday refetch to catch up. */
type LinkOverride = { mondayItemId: string; boardType: BoardType; itemName: string }

/** Same-length window immediately preceding the selected range. Mirrors `fetchDelivery`. */
function previousPeriodRange(startDate: string, endDate: string): { start: Date; end: Date } {
  const start = parseISO(startDate)
  const end = parseISO(endDate)
  const days = differenceInCalendarDays(end, start) + 1
  return { start: subDays(start, days), end: subDays(start, 1) }
}

const SHORT_DATE = "MMM d"

/** Pro-rata a monthly target to where we should be in the current range.
 *  Mirrors Marketing/Sales so MRR and New Business track "on pace" rather
 *  than always reading against the full-month goal. */
function proRata(monthlyTarget: number, range: { startDate: Date; endDate: Date }): number {
  if (monthlyTarget <= 0) return 0
  const refMonthStart = startOfMonth(range.endDate)
  const effectiveStart = dateMax([range.startDate, refMonthStart])
  const days = differenceInCalendarDays(range.endDate, effectiveStart) + 1
  const daysInMonth = getDaysInMonth(range.endDate)
  return (monthlyTarget * days) / daysInMonth
}

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
  const prevRange = previousPeriodRange(startDate, endDate)
  // MRR & New Business are cumulative monthly goals - pro-rata them to the
  // selected range so the bar reads "where we should be by now", not the
  // full-month endpoint. Ratio targets (service fee/customer, churn) stay
  // absolute. Rounded to whole euros.
  const prMrr = tgt?.mrr ? Math.round(proRata(tgt.mrr, range)) : undefined
  const prNewBusiness = tgt?.newBusiness ? Math.round(proRata(tgt.newBusiness, range)) : undefined
  // Optimism (resolved/linked rows) is scoped to the child and keyed by the
  // range, so switching periods remounts it clean - see <UnassignedSection>.
  const rangeKey = `${startDate}|${endDate}`

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

      {/* Hero - team competition leaderboard */}
      <DeliveryHero
        teams={data?.byTeam ?? []}
        unassigned={data?.byAccountManager?.find((am) => am.name === "Unassigned") ?? null}
        isLoading={loading}
      />

      {/* Revenue */}
      <div className="space-y-3">
        <div className="section-title">{t("targets.delivery.section.revenue", locale)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <KpiCard
            label="MRR"
            value={data?.mrr ?? null}
            formatted={formatCurrency(data?.mrr ?? 0)}
            target={prMrr || undefined}
            targetFormatted={prMrr ? t("targets.kpi.target_of", locale, { value: formatCurrency(data?.mrr ?? 0), target: formatCurrency(prMrr) }) : undefined}
            variant="volume"
            isLoading={loading}
          />
          <KpiCard
            label="New Business"
            value={data?.newBusiness ?? null}
            formatted={formatCurrency(data?.newBusiness ?? 0)}
            target={prNewBusiness || undefined}
            targetFormatted={prNewBusiness ? t("targets.kpi.target_of", locale, { value: formatCurrency(data?.newBusiness ?? 0), target: formatCurrency(prNewBusiness) }) : undefined}
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

      {/* Unassigned + Excluded revenue. Keyed by range so per-period optimistic
          state (resolved / linked rows) resets cleanly when the range changes. */}
      <UnassignedSection
        key={rangeKey}
        unassignedCustomers={data?.unassignedCustomers ?? []}
        unlinkedItems={data?.unlinkedMondayItems ?? []}
        excludedCustomers={data?.excludedCustomers ?? []}
        locale={locale}
        customerCount={customerCount}
      />
    </div>
  )
}

// ─── Unassigned + Excluded revenue section ──────────────────────────────────
// Owns the per-period optimistic state. Mounted with a `key` on the date range
// so switching periods resets resolved/linked rows without effects or refs.

function UnassignedSection({
  unassignedCustomers,
  unlinkedItems,
  excludedCustomers,
  locale,
  customerCount,
}: {
  unassignedCustomers: UnassignedCustomer[]
  unlinkedItems: UnlinkedMondayItem[]
  excludedCustomers: ExcludedCustomer[]
  locale: Locale
  customerCount: (n: number) => string
}) {
  const queryClient = useQueryClient()
  const [showUnassigned, setShowUnassigned] = useState(false)
  const [showExcluded, setShowExcluded] = useState(false)
  // Session-local optimism so a fixed/excluded row leaves the list instantly
  // instead of waiting on the slow, read-after-write-racy live Monday refetch.
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set())
  const [linkOverrides, setLinkOverrides] = useState<Map<string, LinkOverride>>(() => new Map())

  // Background reconcile - never awaited by a click handler, so a spinner never
  // hangs on the multi-second delivery recompute.
  const bgRefetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["targets-delivery"] })
  }, [queryClient])
  const resolveCustomer = useCallback((customerId: string) => {
    setResolvedIds((prev) => { const n = new Set(prev); n.add(customerId); return n })
    bgRefetch()
  }, [bgRefetch])
  const applyLink = useCallback((customerId: string, o: LinkOverride) => {
    setLinkOverrides((prev) => { const n = new Map(prev); n.set(customerId, o); return n })
    bgRefetch()
  }, [bgRefetch])

  // Unassigned rows still needing a fix: hide session-resolved ones, and flip any
  // just-linked `no_monday_match` row to the empty_am (assign-AM) step in place.
  const visibleUnassigned: UnassignedCustomer[] = unassignedCustomers
    .filter((c) => !resolvedIds.has(c.customerId))
    .map((c) => {
      const ov = linkOverrides.get(c.customerId)
      return ov ? { ...c, reason: "empty_am", mondayItemId: ov.mondayItemId } : c
    })
  const unassignedAgg = visibleUnassigned.reduce(
    (a, c) => { a.customers++; a.fee += c.fee; a.adBudget += c.adBudget; a.revenue += c.revenue; return a },
    { customers: 0, fee: 0, adBudget: 0, revenue: 0 },
  )
  const visibleExcluded = excludedCustomers.filter((c) => !resolvedIds.has(c.customerId))

  if (visibleUnassigned.length === 0 && visibleExcluded.length === 0) return null

  return (
    <>
      {visibleUnassigned.length > 0 && (
        <div className="space-y-3">
          <div className="section-title">{t("targets.delivery.section.unassigned", locale)}</div>
          <div className="section-card !p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowUnassigned((v) => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 text-xs hover:bg-muted/30 transition-colors text-left"
            >
              <span className={`text-muted-foreground transition-transform ${showUnassigned ? "rotate-90" : ""}`}>›</span>
              <span className="font-medium flex-1">{t("targets.delivery.unassigned.label", locale)}</span>
              <span className="font-mono text-muted-foreground tabular-nums">{customerCount(unassignedAgg.customers)}</span>
              <span className="font-mono text-muted-foreground tabular-nums">Fee {formatCurrency(unassignedAgg.fee)}</span>
              <span className="font-mono text-muted-foreground tabular-nums">Ad {formatCurrency(unassignedAgg.adBudget)}</span>
              <span className="font-mono font-medium tabular-nums">{formatCurrency(unassignedAgg.revenue)}</span>
            </button>
            {showUnassigned && (
              <div className="bg-muted/20 px-4 py-3 border-t border-border/20 space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {t(
                    visibleUnassigned.length === 1 ? "targets.delivery.needs_fix_one" : "targets.delivery.needs_fix_many",
                    locale,
                    { n: String(visibleUnassigned.length) },
                  )}
                </p>
                <div className="space-y-1">
                  {visibleUnassigned.map((u) => (
                    <UnassignedRow
                      key={u.customerId}
                      customer={u}
                      unlinkedItems={unlinkedItems}
                      locale={locale}
                      onLinked={applyLink}
                      onResolved={resolveCustomer}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {visibleExcluded.length > 0 && (
        <div className="space-y-3">
          <div className="section-card !p-0 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowExcluded((v) => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 text-xs hover:bg-muted/30 transition-colors text-left"
            >
              <span className={`text-muted-foreground transition-transform ${showExcluded ? "rotate-90" : ""}`}>›</span>
              <span className="font-medium flex-1 text-muted-foreground">Excluded from revenue</span>
              <span className="font-mono text-muted-foreground tabular-nums">{customerCount(visibleExcluded.length)}</span>
            </button>
            {showExcluded && (
              <div className="bg-muted/20 px-4 py-3 border-t border-border/20 space-y-1">
                <p className="text-[11px] text-muted-foreground mb-1">
                  These Stripe customers are hidden from all revenue totals. Restore to count them again.
                </p>
                {visibleExcluded.map((c) => (
                  <ExcludedRow key={c.customerId} customer={c} onRestored={bgRefetch} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
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
      <div className="bg-card rounded-lg border border-border/60 shadow-[var(--shadow-sm)] px-5 py-4 flex flex-col gap-3 h-full">
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
    <div className="bg-card rounded-lg border border-border/60 shadow-[var(--shadow-sm)] px-5 py-4 flex flex-col h-full">
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
  onLinked,
  onResolved,
}: {
  customer: UnassignedCustomer
  unlinkedItems: UnlinkedMondayItem[]
  locale: Locale
  /** Called after a Stripe↔Monday link succeeds - flips the row to the assign-AM step. */
  onLinked: (customerId: string, link: LinkOverride) => void
  /** Called once the customer is attributed or excluded - hides the row. */
  onResolved: (customerId: string) => void
}) {
  const [assigning, setAssigning] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  // Once we've fired an auto-assign for this customer, don't fire again.
  const autoAssignFired = useRef(false)

  // Look up existing IDs for the chosen Monday item so the API can skip its read.
  const itemsById = useMemo(() => {
    const m = new Map<string, UnlinkedMondayItem>()
    for (const i of unlinkedItems) m.set(i.id, i)
    return m
  }, [unlinkedItems])

  const assignTo = useCallback(async (item: { id: string; boardType: BoardType; name: string }) => {
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
      // Don't await the slow, race-prone live refetch. Flip the row to the
      // assign-AM step immediately; the parent kicks a background reconcile.
      setAssigning(false)
      setPickerOpen(false)
      onLinked(customer.customerId, { mondayItemId: item.id, boardType: item.boardType, itemName: item.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : t("targets.delivery.assign_failed", locale))
      setAssigning(false)
    }
  }, [assigning, customer.customerId, itemsById, locale, onLinked])

  // Auto-link only near-certain name matches (>90%) - Roy's call: fewer silent
  // wrong links. 80-90% still surfaces as a one-click suggestion below.
  const AUTO_ASSIGN_THRESHOLD = 0.9
  useEffect(() => {
    if (autoAssignFired.current || assigning || error) return
    if (customer.reason !== "no_monday_match") return
    const top = customer.suggestions?.[0]
    if (!top || top.score <= AUTO_ASSIGN_THRESHOLD) return
    autoAssignFired.current = true
    void assignTo({ id: top.mondayItemId, boardType: top.boardType, name: top.itemName })
  }, [customer, assigning, error, assignTo])

  const excludeCustomer = useCallback(async () => {
    if (excluding) return
    setExcluding(true)
    setError(null)
    try {
      const res = await fetch("/api/targets/delivery/exclude-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeCustomerId: customer.customerId, customerName: customer.customerName }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed (${res.status})`)
      }
      onResolved(customer.customerId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not exclude customer")
      setExcluding(false)
    }
  }, [excluding, customer.customerId, customer.customerName, onResolved])

  // Manual picker filtering: cap at 30 (the board holds ~150 items).
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
            <button
              type="button"
              disabled={excluding || assigning}
              onClick={excludeCustomer}
              className="text-[10px] text-muted-foreground/70 hover:text-destructive underline-offset-2 hover:underline disabled:opacity-50"
              title="This isn't Rocket Leads revenue - hide it from all totals"
            >
              {excluding ? "Excluding…" : "Not RL revenue"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {customer.reason === "no_monday_match"
              ? t("targets.delivery.no_monday_match", locale)
              : "Linked to Monday - pick the account manager (and campaign manager) below."}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-mono font-medium">{formatCurrency(customer.revenue)}</div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {t("targets.delivery.fee_ad", locale, { fee: formatCurrency(customer.fee), ad: formatCurrency(customer.adBudget) })}
          </div>
        </div>
      </div>

      {/* empty_am: linked to a Monday item, needs AM (+ optional CM) */}
      {customer.reason === "empty_am" && customer.mondayItemId && (
        <ManagerAssignPanel
          mondayItemId={customer.mondayItemId}
          onResolved={() => onResolved(customer.customerId)}
        />
      )}

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
                  onClick={() => assignTo({ id: s.mondayItemId, boardType: s.boardType, name: s.itemName })}
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
                        onClick={() => assignTo({ id: item.id, boardType: item.boardType, name: item.name })}
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
        </div>
      )}

      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  )
}

// ─── AM / CM assign panel (writes through to the Monday item) ────────────────

function ManagerAssignPanel({
  mondayItemId,
  onResolved,
}: {
  mondayItemId: string
  onResolved: () => void
}) {
  const [am, setAm] = useState<{ id: number; name: string } | null>(null)
  const [cm, setCm] = useState<{ id: number; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const usersQuery = useQuery<{ users: MondayUser[] }>({
    queryKey: ["monday-users"],
    queryFn: () => fetch("/api/monday/users").then((r) => r.json()),
    staleTime: 15 * 60 * 1000,
  })
  const users = usersQuery.data?.users ?? []

  const save = useCallback(async () => {
    if (!am || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/targets/delivery/assign-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mondayItemId,
          accountManager: { ids: [am.id], names: [am.name] },
          ...(cm ? { campaignManager: { ids: [cm.id], names: [cm.name] } } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Failed (${res.status})`)
      }
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save assignment")
      setSaving(false)
    }
  }, [am, cm, saving, mondayItemId, onResolved])

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <UserSelect label="Account manager" users={users} loading={usersQuery.isLoading} selected={am} onSelect={setAm} disabled={saving} />
      <UserSelect label="Campaign manager" users={users} loading={usersQuery.isLoading} selected={cm} onSelect={setCm} disabled={saving} />
      <button
        type="button"
        disabled={!am || saving}
        onClick={save}
        className="inline-flex items-center gap-1.5 h-8 rounded-md bg-primary text-primary-foreground px-3 text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {saving ? "Saving…" : <><Check className="h-3 w-3" /> Assign</>}
      </button>
      {error && <span className="text-[10px] text-destructive w-full">{error}</span>}
    </div>
  )
}

function UserSelect({
  label,
  users,
  loading,
  selected,
  onSelect,
  disabled,
}: {
  label: string
  users: MondayUser[]
  loading: boolean
  selected: { id: number; name: string } | null
  onSelect: (u: { id: number; name: string } | null) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const lower = query.toLowerCase().trim()
  const filtered = lower ? users.filter((u) => u.name.toLowerCase().includes(lower)) : users

  return (
    <div className="relative">
      <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">{label}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-8 min-w-[140px] rounded-md border px-2 text-left text-[11px] transition-colors disabled:opacity-50",
          selected ? "border-primary/40 bg-primary/5" : "border-border bg-card hover:bg-muted/40",
        )}
      >
        {selected ? selected.name : <span className="text-muted-foreground">Select…</span>}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-56 rounded-md border border-border bg-popover shadow-lg p-1.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full h-7 rounded border border-border bg-card px-2 text-[11px] mb-1"
          />
          {selected && (
            <button
              type="button"
              onClick={() => { onSelect(null); setOpen(false); setQuery("") }}
              className="w-full text-left rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              Clear
            </button>
          )}
          <div className="max-h-48 overflow-y-auto">
            {loading && <p className="px-2 py-1 text-[10px] text-muted-foreground">Loading…</p>}
            {!loading && filtered.length === 0 && <p className="px-2 py-1 text-[10px] text-muted-foreground italic">No match</p>}
            {filtered.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => { onSelect({ id: u.id, name: u.name }); setOpen(false); setQuery("") }}
                className="w-full flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
              >
                <span className="truncate">{u.name}</span>
                {selected?.id === u.id && <Check className="h-3 w-3 text-foreground/70 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Excluded customer row (restore) ────────────────────────────────────────

function ExcludedRow({
  customer,
  onRestored,
}: {
  customer: ExcludedCustomer
  onRestored: () => void
}) {
  const [restoring, setRestoring] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const restore = useCallback(async () => {
    if (restoring) return
    setRestoring(true)
    setError(null)
    try {
      const res = await fetch("/api/targets/delivery/exclude-customer", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stripeCustomerId: customer.customerId }),
      })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      setHidden(true)
      onRestored()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore")
      setRestoring(false)
    }
  }, [restoring, customer.customerId, onRestored])

  if (hidden) return null

  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-card border border-border/40 px-3 py-1.5">
      <span className="text-[12px] truncate">{customer.customerName}</span>
      <div className="flex items-center gap-2 shrink-0">
        {error && <span className="text-[10px] text-destructive">{error}</span>}
        <button
          type="button"
          disabled={restoring}
          onClick={restore}
          className="text-[11px] text-primary hover:underline disabled:opacity-50"
        >
          {restoring ? "Restoring…" : "Restore"}
        </button>
      </div>
    </div>
  )
}
