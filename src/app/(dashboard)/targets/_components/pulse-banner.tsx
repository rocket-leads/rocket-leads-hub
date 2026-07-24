"use client"

import { memo } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { calculatePulse } from "@/lib/targets/pulse"
import type { MondayTargetsData, MetaTargetsData, TargetsConfig, DateRange } from "@/types/targets"

interface Props {
  monday: MondayTargetsData | null
  meta: MetaTargetsData | null
  targets: TargetsConfig | null
  range: DateRange
  isLoading: boolean
}

/**
 * Slim pillar-health strip. The 4 pillar values live in HeroPillars right above;
 * this is the one-line "how many on track + which need attention" summary - a
 * status read, not a wall of prose. 187N: numbers + a status dot, no paragraphs.
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

  const tone = offCount === 0 ? "live" : onCount === 0 ? "error" : "warn"

  return (
    <div className="section-card !py-3.5">
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-[13px]">
        <span className="section-title">Pillar Health</span>
        <span className={`st-label ${tone}`}>
          <span className="sd" />
          {onCount}/{evaluated} on track
        </span>
        {offCount > 0 && (
          <span className="text-muted-foreground">
            <span className="text-muted-foreground/60">Needs attention:</span>{" "}
            {pulse.offTrackPillars.map((p) => p.name).join(", ")}
          </span>
        )}
      </div>
    </div>
  )
})
