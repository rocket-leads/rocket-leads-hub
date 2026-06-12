import Image from "next/image"
import Link from "next/link"
import { ArrowRight, Hash, Inbox, Mail, MessageSquare } from "lucide-react"
import { BlockShell } from "./block-shell"
import type { InboxItem } from "@/types/inbox"
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

/** Channel icon mirrors the SourceIcon used in the /inbox Channels list so
 *  the home preview matches what the user sees after clicking through:
 *  WhatsApp = brand-green SVG, email = blue Mail, Slack = purple Hash,
 *  unknown Trengo = cyan MessageSquare. */
function channelIcon(item: InboxItem) {
  if (item.source === "slack") {
    return <Hash className="h-3.5 w-3.5 text-purple-500 shrink-0" />
  }
  if (item.channelKind === "whatsapp") {
    return (
      <Image
        src="/logos/brands/whatsapp.svg"
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-3.5 shrink-0 object-contain"
        unoptimized
      />
    )
  }
  if (item.channelKind === "email") {
    return <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
  }
  return <MessageSquare className="h-3.5 w-3.5 text-cyan-500 shrink-0" />
}

function chatHref(item: InboxItem): string {
  // sourceRef.scope tells us whether the thread is internal team chat (Slack
  // DMs) or external (Trengo with clients). Land on the matching inbox
  // scope - the `?scope=` param flips the global Intern/Channels switcher.
  const scope = (item.sourceRef?.scope as string | undefined) ?? "external"
  return scope === "internal" ? "/inbox?scope=intern" : "/inbox?scope=klanten"
}

/**
 * Unread client + team conversations. Carved out of InboxBlock so the home
 * page mirrors the global /inbox split: Tasks + Updates on the left card,
 * Channels (Trengo + Slack chats) on its own card. Roy 2026-06-12: "chat
 * gesprekken horen niet onder Updates".
 */
export function ChannelsBlock({
  items,
  totalCount,
  locale,
}: {
  items: InboxItem[]
  totalCount: number
  locale: Locale
}) {
  return (
    <BlockShell
      title={t("home.block.channels.title", locale)}
      icon={<Inbox className="h-4 w-4 text-cyan-400" />}
      count={totalCount}
      footerHref="/inbox?scope=klanten"
      footerLabel={t("home.block.channels.cta", locale)}
      empty={items.length === 0}
      emptyMessage={t("home.block.channels.empty", locale)}
    >
      <ul className="divide-y divide-border/30">
        {items.map((item) => {
          const sender = item.authorName || item.clientName || "Onbekend"
          const preview = item.body?.trim() || ""
          return (
            <li key={item.id}>
              <Link
                href={chatHref(item)}
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
              >
                <span className="mt-1 shrink-0">{channelIcon(item)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm font-medium truncate">{sender}</p>
                    {item.clientName && item.clientName !== sender && (
                      <span className="text-[11px] text-muted-foreground/60 truncate">
                        · {item.clientName}
                      </span>
                    )}
                  </div>
                  {preview && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">
                      {preview}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 mt-1">
                  {item.commentCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-cyan-500/15 text-cyan-500 text-[10px] font-semibold tabular-nums">
                      {item.commentCount}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground/50 tabular-nums">
                    {timeAgo(item.createdAt)}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/40 transition-colors" />
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </BlockShell>
  )
}
