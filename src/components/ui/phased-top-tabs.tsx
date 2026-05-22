"use client"

import { Fragment } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// Mirrors the TopTab / TabAccent shape from ./top-tabs but kept inline
// so this component compiles independently — top-tabs.tsx has a WIP
// accent system that isn't on HEAD yet.
export type TabAccent = "primary" | "violet" | "sky" | "emerald" | "red" | "amber"
export type PhasedTopTab<T extends string = string> = {
  id: T
  label: string
  icon?: LucideIcon
  count?: number
  dot?: "red" | "amber"
  accent?: TabAccent
}

/**
 * Grouped variant of `TopTabs` — same per-tab visuals (icon, count, dot,
 * underline) but the tabs are organised into named phases with a small
 * uppercase phase label above each group and a thin vertical divider
 * between groups.
 *
 * Use this when a tab strip mixes conceptually-different sections that
 * shouldn't read as siblings — e.g. Pedro's "Voorbereiding" (Brief,
 * Research, Angles) leading into "Deliverables" (Scripts, Creatives,
 * LP, Ad copy) and "Tools" (Refresh) hanging off the side.
 *
 * Active-state styling is identical to TopTabs so consumers can swap
 * between flat and phased without re-learning the accent system.
 */

const ACCENT_CLASSES: Record<TabAccent, { icon: string; count: string; bar: string }> = {
  primary: { icon: "text-primary", count: "text-primary", bar: "bg-primary" },
  violet: {
    icon: "text-violet-500 dark:text-violet-400",
    count: "text-violet-600 dark:text-violet-300",
    bar: "bg-violet-500",
  },
  sky: {
    icon: "text-sky-500 dark:text-sky-400",
    count: "text-sky-600 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  emerald: {
    icon: "text-emerald-500 dark:text-emerald-400",
    count: "text-emerald-600 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  red: {
    icon: "text-red-500 dark:text-red-400",
    count: "text-red-600 dark:text-red-300",
    bar: "bg-red-500",
  },
  amber: {
    icon: "text-amber-500 dark:text-amber-400",
    count: "text-amber-600 dark:text-amber-300",
    bar: "bg-amber-500",
  },
}

export type TabPhase<T extends string = string> = {
  /** Stable phase id — used as React key only. */
  id: string
  /** Uppercase phase label rendered above the tab group. */
  label: string
  tabs: PhasedTopTab<T>[]
}

type Props<T extends string> = {
  phases: TabPhase<T>[]
  value: T
  onChange: (id: T) => void
  /** Optional content rendered on the right (refresh button, etc.). */
  rightContent?: React.ReactNode
  className?: string
}

export function PhasedTopTabs<T extends string>({
  phases,
  value,
  onChange,
  rightContent,
  className,
}: Props<T>) {
  return (
    <div className={cn("border-b border-border/40", className)}>
      <div className="flex items-end justify-between">
        <div className="flex items-end">
          {phases.map((phase, phaseIdx) => (
            <Fragment key={phase.id}>
              {phaseIdx > 0 && (
                <span className="self-stretch w-px bg-border/60 mx-2 mb-[14px]" aria-hidden />
              )}
              <div className="flex flex-col">
                <span className="px-5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground/55 font-semibold mb-0.5">
                  {phase.label}
                </span>
                <div className="flex items-center">
                  {phase.tabs.map(({ id, label, icon: Icon, count, dot, accent }) => (
                    <TabButton
                      key={id}
                      id={id}
                      label={label}
                      Icon={Icon}
                      count={count}
                      dot={dot}
                      accent={accent}
                      active={value === id}
                      onClick={() => onChange(id)}
                    />
                  ))}
                </div>
              </div>
            </Fragment>
          ))}
        </div>
        {rightContent && <div className="flex items-center gap-3 mb-1">{rightContent}</div>}
      </div>
    </div>
  )
}

function TabButton<T extends string>({
  id,
  label,
  Icon,
  count,
  dot,
  accent,
  active,
  onClick,
}: {
  id: T
  label: string
  Icon?: LucideIcon
  count?: number
  dot?: "red" | "amber"
  accent?: TabAccent
  active: boolean
  onClick: () => void
}) {
  const palette = ACCENT_CLASSES[accent ?? "primary"]
  return (
    <button
      key={id}
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-150",
        active ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground",
      )}
    >
      {Icon && (
        <span className="relative">
          <Icon
            className={cn(
              "h-4 w-4 transition-colors",
              active ? palette.icon : "",
            )}
          />
          {dot && !active && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-background",
                dot === "red" ? "bg-red-500" : "bg-amber-500",
              )}
            />
          )}
        </span>
      )}
      {label}
      {typeof count === "number" && (
        <span
          className={cn(
            "ml-1 text-xs tabular-nums font-medium",
            active ? palette.count : "text-muted-foreground/70",
          )}
        >
          {count}
        </span>
      )}
      {active && (
        <span className={cn("absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full", palette.bar)} />
      )}
    </button>
  )
}
