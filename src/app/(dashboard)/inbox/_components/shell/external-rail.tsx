"use client"

import { AtSign, Inbox, MessageCircle, Mail, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

/** One selectable channel in the external rail (a single Trengo WhatsApp line
 *  or email account the user is subscribed to). `unread` = tickets awaiting a
 *  reply on that channel. */
export type ChannelEntry = { id: number; name: string; unread: number }

export type ExternalGroup = "whatsapp" | "email"

type Props = {
  whatsapp: ChannelEntry[]
  email: ChannelEntry[]
  /** The single channel currently in focus (Trengo-style: one channel at a
   *  time). Null when the All / Mentioned view is active. */
  activeChannelId: number | null
  /** "All channels" view - every line merged into one feed. */
  allActive: boolean
  allCount: number
  mentionedOnly: boolean
  mentionedCount: number
  expanded: Record<ExternalGroup, boolean>
  onSelectAll: () => void
  onSelectChannel: (id: number) => void
  onToggleExpand: (group: ExternalGroup) => void
  onSelectMentioned: () => void
  loading?: boolean
}

const GROUP_META: Record<ExternalGroup, { label: string; icon: typeof Mail; accent: string }> = {
  whatsapp: { label: "WhatsApp", icon: MessageCircle, accent: "text-emerald-600 dark:text-emerald-400" },
  email: { label: "Email", icon: Mail, accent: "text-violet-600 dark:text-violet-400" },
}

/** Small, fixed-width count pill so the channel name gets the room (Roy: badges
 *  narrower, name field wider). */
function CountPill({ n, active }: { n: number; active?: boolean }) {
  if (n <= 0) return null
  return (
    <span
      className={cn(
        "ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums",
        active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  )
}

export function ExternalRail({
  whatsapp,
  email,
  activeChannelId,
  allActive,
  allCount,
  mentionedOnly,
  mentionedCount,
  expanded,
  onSelectAll,
  onSelectChannel,
  onToggleExpand,
  onSelectMentioned,
  loading,
}: Props) {
  const groups: Array<{ key: ExternalGroup; channels: ChannelEntry[] }> = [
    { key: "whatsapp", channels: whatsapp },
    { key: "email", channels: email },
  ]

  return (
    <div className="flex flex-col gap-1" role="navigation" aria-label="External channels">
      {/* Mentioned view - all tickets you're @-mentioned in, across channels. */}
      <button
        type="button"
        onClick={onSelectMentioned}
        aria-current={mentionedOnly}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          mentionedOnly
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <AtSign className="h-4 w-4 shrink-0" />
        <span>Mentioned</span>
        <CountPill n={mentionedCount} active={mentionedOnly} />
      </button>

      {/* All channels - every line merged into one feed. The only way to see
          everything at once (Roy 2026-07-15); channels below narrow to one. */}
      <button
        type="button"
        onClick={onSelectAll}
        aria-current={allActive}
        className={cn(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          allActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <Inbox className="h-4 w-4 shrink-0" />
        <span>All channels</span>
        <CountPill n={allCount} active={allActive} />
      </button>

      {loading && whatsapp.length === 0 && email.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground/60">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading channels…
        </div>
      ) : whatsapp.length === 0 && email.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground/60">
          No channels connected. Add them in Account settings.
        </p>
      ) : (
        groups.map(({ key, channels }) => {
          if (channels.length === 0) return null
          const meta = GROUP_META[key]
          const Icon = meta.icon
          const isOpen = expanded[key]
          return (
            <div key={key} className="mt-1">
              {/* Group header: a non-filter label. Clicking only expands /
                  collapses the channel list - it does NOT select anything. */}
              <button
                type="button"
                onClick={() => onToggleExpand(key)}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70 hover:text-foreground"
              >
                <Icon className={cn("h-4 w-4 shrink-0", meta.accent)} />
                <span>{meta.label}</span>
                {isOpen ? (
                  <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground/50" />
                ) : (
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/50" />
                )}
              </button>

              {/* Individual channels - single-select, one at a time. */}
              {isOpen && (
                <div className="flex flex-col gap-0.5">
                  {channels.map((c) => {
                    const active = !mentionedOnly && activeChannelId === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSelectChannel(c.id)}
                        aria-current={active}
                        title={c.name}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-md py-2 pl-9 pr-3 text-sm transition-colors",
                          active
                            ? "bg-primary/10 font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{c.name}</span>
                        <CountPill n={c.unread} active={active} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
