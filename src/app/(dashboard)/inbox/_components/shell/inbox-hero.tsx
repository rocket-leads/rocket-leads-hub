"use client"

/**
 * Thin, calm COMMS status line for the external inbox — the honest, compact
 * cousin of the 187N Chats hero (no fabricated median-reply / sparkline metrics
 * the Hub doesn't have). A single subtle mono line: live dot + label, the
 * New / Opgepakt / Gesloten counts, and a per-channel threads·unread breakdown.
 * Kept deliberately light so it reads as a status strip, not a competing card.
 * Roy 2026-07-24.
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 font-mono text-[11px] text-muted-foreground/60">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--st-live)] shadow-[0_0_8px_var(--st-live-glow)]" />
        <span className="uppercase tracking-[0.14em] text-muted-foreground/55">Comms · Live</span>
      </span>
      <Stat label="New" value={newCount} strong />
      <Stat label="Opgepakt" value={assignedCount} />
      <Stat label="Gesloten" value={closedCount} />
      <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
        {channels
          .filter((c) => c.threads > 0)
          .map((c) => (
            <span key={c.label} className="tabular-nums text-muted-foreground/60">
              <span className="uppercase tracking-wide text-muted-foreground/40">{c.label}</span>{" "}
              {c.threads} · {c.unread} unread
            </span>
          ))}
      </span>
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 tabular-nums">
      <span className="uppercase tracking-wide text-muted-foreground/40">{label}</span>
      <span className={strong ? "font-semibold text-foreground/90" : "text-muted-foreground/80"}>{value}</span>
    </span>
  )
}
