"use client"

import { cn } from "@/lib/utils"

/**
 * Compact 187N "COMMS · LIVE" instrument strip for the external inbox — the
 * honest, data-backed cousin of the 187N Chats hero (no fabricated
 * median-reply / sparkline metrics the Hub doesn't have). One card row: a live
 * dot + label, the New / Opgepakt / Gesloten counts, and a per-channel
 * threads·unread breakdown. Roy 2026-07-24.
 */
export type InboxHeroChannel = { label: string; threads: number; unread: number }

export function InboxHero({
  newCount,
  assignedCount,
  closedCount,
  channels,
}: {
  newCount: number
  assignedCount: number
  closedCount: number
  channels: InboxHeroChannel[]
}) {
  return (
    <div className="section-card flex flex-wrap items-center gap-x-8 gap-y-3 !px-5 !py-3.5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--st-live)] shadow-[0_0_8px_var(--st-live-glow)]" />
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/55">
          Comms · Live
        </span>
      </div>

      <div className="flex items-center gap-6">
        <Stat label="New" value={newCount} strong />
        <Stat label="Opgepakt" value={assignedCount} />
        <Stat label="Gesloten" value={closedCount} />
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1">
        {channels
          .filter((c) => c.threads > 0)
          .map((c) => (
            <span key={c.label} className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
              <span className="uppercase tracking-wide text-muted-foreground/45">{c.label}</span>{" "}
              {c.threads} threads · {c.unread} unread
            </span>
          ))}
      </div>
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="flex flex-col leading-none">
      <span className="mb-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/50">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-xl font-semibold tabular-nums",
          strong ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}
