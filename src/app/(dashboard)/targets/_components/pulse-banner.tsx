"use client"

import { memo } from "react"
import { AlertOctagon, CheckCircle2, Info } from "lucide-react"
import type { LucideIcon } from "lucide-react"
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

type Variant = "on-track" | "off-track"

const VARIANT_STYLE: Record<Variant, {
  label: string
  icon: LucideIcon
  iconColor: string
  borderColor: string
  bgTint: string
  iconBg: string
  bulletColor: string
}> = {
  "on-track": {
    label: "ON TRACK",
    icon: CheckCircle2,
    iconColor: "text-green-500",
    borderColor: "border-l-green-500",
    bgTint: "bg-green-500/[0.04]",
    iconBg: "bg-green-500/10",
    bulletColor: "text-green-500",
  },
  "off-track": {
    label: "OFF TRACK",
    icon: AlertOctagon,
    iconColor: "text-red-500",
    borderColor: "border-l-red-500",
    bgTint: "bg-red-500/[0.04]",
    iconBg: "bg-red-500/10",
    bulletColor: "text-red-500",
  },
}

interface StatusCardProps {
  variant: Variant
  pillars: PillarStatus[]
  totalCount: number
}

function StatusCard({ variant, pillars, totalCount }: StatusCardProps) {
  const style = VARIANT_STYLE[variant]
  const Icon = style.icon
  return (
    <div className={cn(
      "bg-card rounded-lg border border-border/40 border-l-4 p-5 h-full",
      style.borderColor,
      style.bgTint,
    )}>
      <div className="flex items-start gap-4">
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-lg shrink-0", style.iconBg)}>
          <Icon className={cn("h-6 w-6", style.iconColor)} strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h2 className="text-xl font-bold tracking-tight text-foreground">{style.label}</h2>
            <span className="text-sm text-muted-foreground">
              {pillars.length} of {totalCount} {totalCount === 1 ? "pillar" : "pillars"}
            </span>
          </div>
          <ul className="mt-5 space-y-2">
            {pillars.map((p) => (
              <li key={p.name} className="flex items-baseline gap-2 text-sm">
                <span className={cn("text-base leading-none", style.bulletColor)}>•</span>
                <span className="font-medium text-foreground">{p.name}</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="text-muted-foreground">{p.hint}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function NeutralBanner() {
  return (
    <div className="bg-card rounded-lg border border-border/40 border-l-4 border-l-muted-foreground/20 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg shrink-0 bg-muted-foreground/10">
          <Info className="h-6 w-6 text-muted-foreground" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-foreground">PILLAR HEALTH</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Set CBC + funnel volume targets in Settings to enable pillar checks.
          </p>
        </div>
      </div>
    </div>
  )
}

export const PulseBanner = memo(function PulseBanner({ monday, meta, targets, range, isLoading }: Props) {
  if (isLoading || !monday || !meta || !targets) {
    return (
      <div className="bg-card rounded-lg border border-border/40 border-l-4 border-l-muted-foreground/20 p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    )
  }

  const pulse = calculatePulse(monday, meta, targets, range)
  if (!pulse) return null

  const evaluated = pulse.evaluatedCount
  const onCount = pulse.onTrackPillars.length
  const offCount = pulse.offTrackPillars.length

  if (evaluated === 0) return <NeutralBanner />

  // All on track - full-width green banner
  if (offCount === 0) {
    return <StatusCard variant="on-track" pillars={pulse.onTrackPillars} totalCount={evaluated} />
  }

  // All off track - full-width red banner
  if (onCount === 0) {
    return <StatusCard variant="off-track" pillars={pulse.offTrackPillars} totalCount={evaluated} />
  }

  // Mixed - split 50/50; both cards visually identical
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <StatusCard variant="on-track" pillars={pulse.onTrackPillars} totalCount={evaluated} />
      <StatusCard variant="off-track" pillars={pulse.offTrackPillars} totalCount={evaluated} />
    </div>
  )
})
