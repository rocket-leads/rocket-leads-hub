"use client"

import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

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
  channels,
  label = "Comms",
}: {
  newCount: number
  assignedCount: number
  /** Closed/archived total — accepted for API compatibility but no longer
   *  shown (not actionable). Roy 2026-07-30. */
  closedCount?: number
  channels: InboxHeroChannel[]
  /** Leading strip label — "Comms" (external) / "Workspace" (internal). */
  label?: string
}) {
  const locale = useLocale()
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 font-mono text-[11px] text-muted-foreground/60">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--st-live)] shadow-[0_0_8px_var(--st-live-glow)]" />
        <span className="uppercase tracking-[0.14em] text-muted-foreground/55">{label} · Live</span>
      </span>
      {/* Zero counts render no number at all — a stat only shows when it has
          something to act on. Roy 2026-07-30. */}
      {newCount > 0 && <Stat label={t("inbox.hero.new", locale)} value={newCount} strong />}
      {assignedCount > 0 && <Stat label={t("inbox.hero.picked_up", locale)} value={assignedCount} />}
      {/* "Gesloten" total dropped — the closed archive count isn't actionable
          and just added noise. Channel strip shows unread only (the number that
          actually needs a reply), not the full thread total. Roy 2026-07-30. */}
      <span className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1">
        {channels
          .filter((c) => c.unread > 0)
          .map((c) => (
            <span key={c.label} className="tabular-nums text-muted-foreground/60">
              <span className="uppercase tracking-wide text-muted-foreground/40">{c.label}</span>{" "}
              {c.unread} {t("inbox.hero.unread", locale)}
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
