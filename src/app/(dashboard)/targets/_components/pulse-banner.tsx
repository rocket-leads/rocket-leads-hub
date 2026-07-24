"use client"

import { memo } from "react"
import { AlertTriangle } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { calculatePulse, type PillarStatus } from "@/lib/targets/pulse"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  range: DateRange
  isLoading: boolean
}

/** One off-track pillar. When the pillar carries a root-cause `driver` (Cost per
 *  Booked Call decomposed into Cost per Opt-in ÷ Booking Rate) we lead with the
 *  driver - the actual lever - and frame the pillar as the symptom it moves. */
function PillarAttention({ pillar, accent }: { pillar: PillarStatus; accent: string }) {
  const d = pillar.driver
  return (
    <div className="flex items-start gap-2.5">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: accent }} strokeWidth={2.25} />
      <div className="min-w-0">
        {d ? (
          <>
            <p className="text-sm leading-snug">
              <span className="font-semibold text-foreground">{d.name}</span>
              <span className="text-muted-foreground"> drives </span>
              <span className="font-medium text-foreground">{pillar.name}</span>
              <span className="text-muted-foreground"> {pillar.metric} (target {pillar.target})</span>
            </p>
            <p className="text-[12.5px] text-muted-foreground leading-snug mt-0.5">{d.detail}</p>
          </>
        ) : (
          <p className="text-sm leading-snug">
            <span className="font-semibold text-foreground">{pillar.name}</span>
            <span className="text-muted-foreground"> {pillar.metric} (target {pillar.target}) — {pillar.hint}</span>
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Pillar-health strip. All-on-track = slim green confirmation. Any off-track =
 * a prominent amber/red card that names what needs attention AND traces the
 * root cause one funnel step deeper (a high Cost per Booked Call is really a
 * Cost-per-Opt-in or Booking-Rate problem - the banner points at the lever).
 */
export const PulseBanner = memo(function PulseBanner({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading || !monday || !meta || !targets) {
    return (
      <div className="section-card !py-3.5">
        <Skeleton className="h-4 w-64" />
      </div>
    )
  }

  const pulse = calculatePulse(monday, meta, targets, range)
  if (!pulse) return null

  const evaluated = pulse.evaluatedCount
  const onCount = pulse.onTrackPillars.length
  const offCount = pulse.offTrackPillars.length

  if (evaluated === 0) {
    return (
      <div className="section-card !py-3.5">
        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          <span className="section-title">Pillar Health</span>
          <span className="st-label idle"><span className="sd" />No targets set</span>
          <span className="text-muted-foreground/70">Set CBC + funnel volume targets in Settings to enable pillar checks.</span>
        </div>
      </div>
    )
  }

  // All on track - slim green confirmation.
  if (offCount === 0) {
    return (
      <div className="section-card !py-3.5 border-l-4 border-l-[var(--st-live)]">
        <div className="flex items-center gap-3 flex-wrap text-[13px]">
          <span className="section-title">Pillar Health</span>
          <span className="st-label live"><span className="sd" />{onCount}/{evaluated} on track</span>
          <span className="text-muted-foreground">All funnel pillars healthy.</span>
        </div>
      </div>
    )
  }

  // Something needs attention - prominent, colour-forward card.
  const tone = onCount === 0 ? "error" : "warn"
  const accent = tone === "error" ? "var(--st-error)" : "var(--st-warn)"
  return (
    <div
      className="section-card border-l-4"
      style={{
        borderLeftColor: accent,
        background: `color-mix(in srgb, ${accent} 7%, var(--surface))`,
      }}
    >
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <span className="section-title">Pillar Health</span>
        <span className={cn("st-label", tone)}><span className="sd" />{onCount}/{evaluated} on track</span>
      </div>
      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: accent }}>
        Needs attention
      </p>
      <div className="space-y-3">
        {pulse.offTrackPillars.map((p) => (
          <PillarAttention key={p.name} pillar={p} accent={accent} />
        ))}
      </div>
    </div>
  )
})
