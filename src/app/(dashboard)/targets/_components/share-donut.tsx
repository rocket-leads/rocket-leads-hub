"use client"

import { useState } from "react"
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/targets/formatters"

export interface DonutSegment {
  name: string
  value: number
  color: string
}

/**
 * Interactive share donut. Hovering a slice OR its legend row highlights the
 * pair (the slice stays full while the others dim, the legend row goes bold, and
 * the centre swaps to that segment's name / value / %). Solves "I have to match
 * colours to the legend by hand" - point at anything and it's obvious what it is.
 */
export function ShareDonut({ segments, centerLabel }: { segments: DonutSegment[]; centerLabel: string }) {
  const [active, setActive] = useState<number | null>(null)
  const total = segments.reduce((s, d) => s + Math.max(0, d.value), 0) || 1
  const activeSeg = active !== null ? segments[active] : null

  return (
    <div className="min-w-0">
      <div className="relative mx-auto h-[168px] w-[168px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="66%"
              outerRadius="100%"
              paddingAngle={1.5}
              strokeWidth={0}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
              onMouseEnter={(_, i) => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              {segments.map((d, i) => (
                <Cell
                  key={d.name}
                  fill={d.color}
                  fillOpacity={active === null || active === i ? 1 : 0.28}
                  style={{ transition: "fill-opacity 150ms", cursor: "pointer", outline: "none" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          {activeSeg ? (
            <>
              <span className="font-mono text-[18px] font-bold leading-none tabular-nums" style={{ color: activeSeg.color }}>
                {formatCurrency(activeSeg.value)}
              </span>
              <span className="mt-1 max-w-full truncate text-[11px] font-medium text-foreground/80">{activeSeg.name}</span>
              <span className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/60">
                {((Math.max(0, activeSeg.value) / total) * 100).toFixed(0)}%
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[20px] font-bold leading-none tabular-nums text-foreground">{formatCurrency(total)}</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">{centerLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Legend - bidirectional highlight with the slices */}
      <div className="mt-4 space-y-0.5">
        {segments.map((d, i) => {
          const isActive = active === i
          const dim = active !== null && !isActive
          return (
            <div
              key={d.name}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              className={cn(
                "-mx-1 flex cursor-default items-center gap-2 rounded px-1 py-0.5 text-[12px] transition-colors",
                isActive && "bg-muted/60",
                dim && "opacity-40",
              )}
            >
              <span
                className={cn("h-2.5 w-2.5 shrink-0 rounded-sm transition-transform", isActive && "scale-125")}
                style={{ backgroundColor: d.color }}
              />
              <span className={cn("min-w-0 flex-1 truncate", isActive ? "font-semibold text-foreground" : "text-foreground/80")}>{d.name}</span>
              <span className="font-mono tabular-nums text-muted-foreground/60">{formatCurrency(d.value)}</span>
              <span className={cn("w-9 text-right font-mono tabular-nums", isActive ? "font-bold text-foreground" : "font-semibold")}>
                {((Math.max(0, d.value) / total) * 100).toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
