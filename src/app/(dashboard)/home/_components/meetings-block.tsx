import Link from "next/link"
import { Video, ArrowRight } from "lucide-react"
import { BlockShell } from "./block-shell"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"

export type TodayMeeting = {
  id: string
  /** Title of the meeting (eg. "Strategy call — Acme"). */
  title: string
  /** ISO timestamp for `scheduled_at`. We rely on the caller to have already
   *  filtered to today's date in the local timezone. */
  scheduledAt: string
  /** Linked client name when the meeting is mapped to a Monday client.
   *  Null for prospect / internal meetings. */
  clientName: string | null
  /** Linked client Monday item ID so the row can open the slide-over. */
  mondayItemId: string | null
  /** Direct Fathom share link for click-through. */
  shareUrl: string | null
}

/**
 * Today's meetings — surfaces calls happening today so the user can see
 * what's coming up + jump straight to notes from earlier in the day.
 * Fed by Fathom data (the meetings table), filtered server-side to
 * `scheduled_at` between 00:00 and 23:59 of the user's local day.
 *
 * Rows are time-stamped relative to now: "in 30 min", "Now", or
 * "Earlier today" so the user reads them as a timeline rather than a
 * static list.
 */
export function MeetingsBlock({
  items,
  totalCount,
  nowMs,
  locale,
}: {
  items: TodayMeeting[]
  totalCount: number
  /** Reference timestamp for the "in N min / now / passed" labelling.
   *  Passed in from the server so SSR + first-paint don't disagree about
   *  what "now" is. */
  nowMs: number
  locale: Locale
}) {
  return (
    <BlockShell
      title={t("home.block.meetings.title", locale)}
      icon={<Video className="h-4 w-4 text-primary" />}
      count={totalCount}
      footerHref="/pedro/meetings"
      footerLabel={t("home.block.meetings.cta", locale)}
      empty={items.length === 0}
      emptyMessage={t("home.block.meetings.empty", locale)}
    >
      <ul className="divide-y divide-border/30">
        {items.map((m) => {
          const startMs = new Date(m.scheduledAt).getTime()
          const diffMin = Math.round((startMs - nowMs) / 60_000)
          const status =
            diffMin > 30
              ? { label: formatStartTime(m.scheduledAt, locale), tone: "text-muted-foreground/60" }
              : diffMin > 0
                ? { label: t("home.block.meetings.in", locale, { mins: String(diffMin) }), tone: "text-primary font-medium" }
                : diffMin > -90
                  ? { label: t("home.block.meetings.now", locale), tone: "text-emerald-500 font-medium" }
                  : { label: t("home.block.meetings.passed", locale), tone: "text-muted-foreground/40" }

          // Click-through priority: client slide-over (preferred when the
          // meeting is linked) > Fathom share URL > /meetings page.
          const href = m.mondayItemId
            ? `/clients?client=${encodeURIComponent(m.mondayItemId)}`
            : m.shareUrl ?? "/pedro/meetings"
          const isExternal = !m.mondayItemId && !!m.shareUrl

          return (
            <li key={m.id}>
              <Link
                href={href}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.title}</p>
                  {m.clientName && (
                    <p className="text-xs text-muted-foreground/60 truncate">{m.clientName}</p>
                  )}
                </div>
                <span className={`text-xs tabular-nums shrink-0 ${status.tone}`}>
                  {status.label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
              </Link>
            </li>
          )
        })}
      </ul>
    </BlockShell>
  )
}

function formatStartTime(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleTimeString(locale === "nl" ? "nl-NL" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })
}
