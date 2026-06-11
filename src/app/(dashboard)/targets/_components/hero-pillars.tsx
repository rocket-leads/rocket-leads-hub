"use client"

import { memo } from "react"
import { KpiTile, type KpiValueTone } from "@/components/ui/kpi-tile"
import { formatCurrencyDecimal, formatPercent, safeDivide } from "@/lib/targets/formatters"
import { deriveTargets } from "@/lib/targets/calculations"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig } from "@/types/targets"

type Status = "good" | "bad" | "neutral"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  isLoading: boolean
}

export const HeroPillars = memo(function HeroPillars({ monday, meta, targets, isLoading }: Props) {
  const locale = useLocale()
  if (isLoading || !monday || !meta) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiTile key={i} label="" value="" loading />
        ))}
      </div>
    )
  }

  const spend = meta.spend
  const optIns = monday.optIns
  const calls = monday.calls
  const taken = monday.takenCalls
  const deals = monday.deals

  const cbc = safeDivide(spend, calls)
  // 2026-05-27: qualification stage dropped - pillar #2 is now Booking Rate
  // (Booked / Opt-ins) and Show-up Rate denominator switched from qualified
  // calls to booked calls (Taken / Booked).
  const bookingRate = safeDivide(calls, optIns)
  const showUpRate = safeDivide(taken, calls)
  const convRate = safeDivide(deals, taken)

  const derived = deriveTargets(targets ?? null)
  const cbcTarget = targets?.cbc ?? 0
  const bookingRateTarget = derived.bookingRate
  const showUpRateTarget = derived.showUpRate
  const convRateTarget = derived.convRate

  // Tone-only signal across all pillars - same convention as Watchlist's KPI
  // strip (the tone-coloured number IS the visual cue; no separate arrow).

  // ── 1. CBC (Cost per Booked Call) - the lead-volume driver ──
  const cbcStatus: Status = (cbcTarget === 0 || calls < 4) ? "neutral" : cbc <= cbcTarget ? "good" : "bad"
  const cbcSubtitle = cbcTarget > 0
    ? t("targets.pillar.cbc.with_target", locale, { target: formatCurrencyDecimal(cbcTarget), calls: String(calls) })
    : calls > 0
    ? t("targets.pillar.cbc.no_target", locale, { calls: String(calls) })
    : t("targets.pillar.cbc.none_yet", locale)

  // ── 2. Booking Rate - opt-in → booked conversion ──
  const bookingStatus: Status = (bookingRateTarget === 0 || optIns < 4) ? "neutral" : bookingRate >= bookingRateTarget ? "good" : "bad"
  const bookingSubtitle = bookingRateTarget > 0
    ? `${String(calls)} of ${String(optIns)} opt-ins · target ${formatPercent(bookingRateTarget)}`
    : optIns > 0
    ? `${String(calls)} of ${String(optIns)} opt-ins`
    : "-"

  // ── 3. Show-up Rate - booked → taken conversion ──
  const showUpStatus: Status = (showUpRateTarget === 0 || calls < 4) ? "neutral" : showUpRate >= showUpRateTarget ? "good" : "bad"
  const showUpSubtitle = showUpRateTarget > 0
    ? `${String(taken)} of ${String(calls)} booked · target ${formatPercent(showUpRateTarget)}`
    : calls > 0
    ? `${String(taken)} of ${String(calls)} booked`
    : "-"

  // ── 4. Conversion Rate - sales team ──
  const convStatus: Status = (convRateTarget === 0 || taken < 4) ? "neutral" : convRate >= convRateTarget ? "good" : "bad"
  const convSubtitle = convRateTarget > 0
    ? t("targets.pillar.conv.with_target", locale, { target: formatPercent(convRateTarget), deals: String(deals), taken: String(taken) })
    : taken > 0
    ? t("targets.pillar.conv.no_target", locale, { deals: String(deals), taken: String(taken) })
    : "-"

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <KpiTile
        label={t("targets.pillar.cbc", locale)}
        value={calls > 0 ? formatCurrencyDecimal(cbc) : "-"}
        valueTone={cbcStatus as KpiValueTone}
        sub={cbcSubtitle}
      />
      <KpiTile
        label="Booking Rate"
        value={optIns > 0 ? formatPercent(bookingRate) : "-"}
        valueTone={bookingStatus as KpiValueTone}
        sub={bookingSubtitle}
      />
      <KpiTile
        label={t("targets.pillar.showup", locale)}
        value={calls > 0 ? formatPercent(showUpRate) : "-"}
        valueTone={showUpStatus as KpiValueTone}
        sub={showUpSubtitle}
      />
      <KpiTile
        label={t("targets.pillar.conv", locale)}
        value={taken > 0 ? formatPercent(convRate) : "-"}
        valueTone={convStatus as KpiValueTone}
        sub={convSubtitle}
      />
    </div>
  )
})
