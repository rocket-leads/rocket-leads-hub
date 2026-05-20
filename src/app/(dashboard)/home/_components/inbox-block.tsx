import Link from "next/link"
import { Inbox, ArrowRight, MessageSquare, ListChecks, Bell, Sparkles } from "lucide-react"
import { BlockShell } from "./block-shell"
import type { InboxItem } from "@/types/inbox"
import { pickInboxZeroMessage } from "@/lib/inbox/inbox-zero-messages"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return "now"
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  return `${d}d`
}

function kindIcon(kind: InboxItem["kind"]) {
  if (kind === "task") return <ListChecks className="h-3 w-3 text-violet-400" />
  if (kind === "update") return <Bell className="h-3 w-3 text-amber-400" />
  return <MessageSquare className="h-3 w-3 text-muted-foreground/60" />
}

/**
 * Where to send the user when they click an inbox row on the home page.
 * Tasks + updates land on the matching tab with the row pre-selected via
 * `?id=`. Chat threads (kind === "chat") link to the Client Inbox tab —
 * inbox-view doesn't yet resolve a `?id=` to a chat thread, so we land
 * the user on the right tab and let them pick the conversation from the
 * already-loaded list. Better than dumping them into the wrong tab.
 */
function itemHref(item: InboxItem): string {
  if (item.kind === "chat") return "/inbox?tab=client-inbox"
  return `/inbox?id=${item.id}`
}

/**
 * Inbox Zero celebration state. Picks a rotating motivational line — same
 * for everyone for the whole UTC day, changes at midnight UTC. The point is
 * to make Inbox Zero feel like a tiny win you want to keep, not a dead empty
 * state. Server-rendered (deterministic), so no client JS / no flicker.
 */
function InboxZeroState() {
  const message = pickInboxZeroMessage()
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 gap-3 text-center">
      <div className="relative">
        <div className="h-10 w-10 rounded-full bg-violet-500/10 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-violet-400" strokeWidth={2} />
        </div>
        <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-green-500 animate-pulse" />
      </div>
      <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold">
        Inbox zero
      </p>
      <p className="text-sm text-foreground/80 leading-snug max-w-[280px]">
        {message}
      </p>
    </div>
  )
}

export function InboxBlock({
  items,
  totalCount,
  locale,
}: {
  items: InboxItem[]
  /** Includes unread chat messages too — drives the empty-state check so we
   *  never flip to "Inbox Zero" while messages are still unread, even if the
   *  preview list (tasks + updates only) happens to be empty. */
  totalCount: number
  locale: Locale
}) {
  return (
    <BlockShell
      title={t("home.block.inbox.title", locale)}
      icon={<Inbox className="h-4 w-4 text-violet-400" />}
      count={totalCount}
      footerHref="/inbox"
      footerLabel={t("home.block.inbox.cta", locale)}
      empty={totalCount === 0}
      emptyContent={<InboxZeroState />}
    >
      <ul className="divide-y divide-border/30">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={itemHref(item)}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors group"
            >
              <span className="mt-1 shrink-0">{kindIcon(item.kind)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                  {[item.clientName, item.authorName, timeAgo(item.createdAt)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {item.body && (
                  <p className="text-[11px] text-muted-foreground/50 mt-1 line-clamp-1">{item.body}</p>
                )}
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors mt-1" />
            </Link>
          </li>
        ))}
      </ul>
    </BlockShell>
  )
}
