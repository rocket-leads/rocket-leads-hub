"use client"

import { ListTodo, MessageSquare, MessageCircle, Mail, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FeedChannel } from "./types"
import { ALL_CHANNELS } from "./types"

/** Static per-channel presentation. Icon + label + the accent used for the
 *  active state and the count badge. Kept here so the rail, the feed rows and
 *  the badges all pull from one source of truth. */
const CHANNEL_META: Record<
  FeedChannel,
  { label: string; icon: typeof ListTodo; accent: string }
> = {
  tasks: { label: "Tasks", icon: ListTodo, accent: "text-amber-600 dark:text-amber-400" },
  updates: { label: "Updates", icon: MessageSquare, accent: "text-sky-600 dark:text-sky-400" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, accent: "text-emerald-600 dark:text-emerald-400" },
  email: { label: "Email", icon: Mail, accent: "text-violet-600 dark:text-violet-400" },
}

type Props = {
  selected: ReadonlySet<FeedChannel>
  counts: Record<FeedChannel, number>
  onToggle: (channel: FeedChannel) => void
  onSelectAll: () => void
  /** Channels to omit entirely (e.g. WhatsApp/Email when the user can't view
   *  a client's communication). Their rows are also filtered upstream. */
  hidden?: readonly FeedChannel[]
  /** Vertical rail (xl+) or a horizontal chip strip (below xl / locked view). */
  orientation?: "vertical" | "horizontal"
}

export function ChannelRail({
  selected,
  counts,
  onToggle,
  onSelectAll,
  hidden = [],
  orientation = "vertical",
}: Props) {
  const channels = ALL_CHANNELS.filter((c) => !hidden.includes(c))
  const allOn = channels.every((c) => selected.has(c))
  const vertical = orientation === "vertical"

  return (
    <div
      className={cn(
        vertical
          ? "flex flex-col gap-1"
          : "flex flex-row flex-wrap items-center gap-2",
      )}
      role="group"
      aria-label="Channels"
    >
      {/* Select-all: toggles between all-on and (re)all-on. When everything is
          already on it's a no-op affordance that still reads as the "reset"
          anchor of the rail. */}
      <button
        type="button"
        onClick={onSelectAll}
        aria-pressed={allOn}
        className={cn(
          "inline-flex items-center gap-2 rounded-md text-sm font-medium transition-colors",
          vertical ? "px-3 py-2 w-full" : "px-2.5 py-1.5 h-9",
          allOn
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-[4px] border",
            allOn ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40",
          )}
        >
          {allOn && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        All channels
      </button>

      {channels.map((channel) => {
        const meta = CHANNEL_META[channel]
        const Icon = meta.icon
        const on = selected.has(channel)
        const count = counts[channel] ?? 0
        return (
          <button
            key={channel}
            type="button"
            onClick={() => onToggle(channel)}
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-2 rounded-md text-sm transition-colors",
              vertical ? "px-3 py-2 w-full" : "px-2.5 py-1.5 h-9",
              on
                ? "bg-muted/70 text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-[4px] border shrink-0",
                on
                  ? "bg-foreground/90 border-foreground/90 text-background"
                  : "border-muted-foreground/40",
              )}
            >
              {on && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <Icon className={cn("h-4 w-4 shrink-0", on ? meta.accent : "opacity-70")} />
            <span className="truncate">{meta.label}</span>
            {count > 0 && (
              <span
                className={cn(
                  "ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
                  on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
