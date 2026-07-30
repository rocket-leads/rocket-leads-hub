"use client"

import { useEffect, useRef, useState } from "react"
import { AtSign, ChevronDown, Inbox, Mail, MessageCircle, Star } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChannelEntry } from "./external-rail"

/**
 * Channel switcher for the external inbox. A quick-switch TAB STRIP of the AM's
 * favourite channels (+ always-present All / Mentioned) with the active tab
 * clearly highlighted, plus a "More" dropdown that lists every channel and lets
 * the AM star/unstar them. Replaces the old single dropdown so switching is one
 * click and it's obvious which channel you're on. Roy 2026-07-29.
 */
type Props = {
  whatsapp: ChannelEntry[]
  email: ChannelEntry[]
  activeChannelId: number | null
  allActive: boolean
  mentionedOnly: boolean
  allCount: number
  mentionedCount: number
  /** Channel ids the AM has favourited → rendered as tabs. */
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
  onSelectAll: () => void
  onSelectChannel: (id: number) => void
  onSelectMentioned: () => void
}

function iconForChannel(
  id: number,
  whatsapp: ChannelEntry[],
): typeof Mail {
  return whatsapp.some((c) => c.id === id) ? MessageCircle : Mail
}

export function ChannelPicker({
  whatsapp,
  email,
  activeChannelId,
  allActive,
  mentionedOnly,
  allCount,
  mentionedCount,
  favoriteIds,
  onToggleFavorite,
  onSelectAll,
  onSelectChannel,
  onSelectMentioned,
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const allChannels = [...whatsapp, ...email]
  // Favourite channels that still exist, in the WA-then-email order they appear
  // in the source lists (stable, not the click order).
  const favoriteChannels = allChannels.filter((c) => favoriteIds.includes(c.id))
  const favoriteSet = new Set(favoriteIds)

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Quick-switch tab strip: All / Mentioned / favourites / More. */}
      <div className="flex flex-wrap items-center gap-1.5" role="group">
        <Tab
          icon={Inbox}
          label="All"
          count={allCount}
          active={allActive && !mentionedOnly}
          onClick={onSelectAll}
          dot={false}
          strong
        />
        <Tab
          icon={AtSign}
          label="Mentioned"
          count={mentionedCount}
          active={mentionedOnly}
          onClick={onSelectMentioned}
        />
        {favoriteChannels.map((c) => (
          <Tab
            key={c.id}
            icon={iconForChannel(c.id, whatsapp)}
            label={c.name}
            count={c.unread}
            active={!mentionedOnly && !allActive && activeChannelId === c.id}
            onClick={() => onSelectChannel(c.id)}
          />
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn("chip h-8", open && "active")}
          title="More channels"
        >
          <Star className="h-3.5 w-3.5" />
          More
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          <Item
            icon={Inbox}
            label="All channels"
            count={allCount}
            active={allActive && !mentionedOnly}
            onClick={() => {
              onSelectAll()
              setOpen(false)
            }}
          />
          <Item
            icon={AtSign}
            label="Mentioned"
            count={mentionedCount}
            active={mentionedOnly}
            onClick={() => {
              onSelectMentioned()
              setOpen(false)
            }}
          />
          {whatsapp.length > 0 && <GroupLabel icon={MessageCircle} label="WhatsApp" />}
          {whatsapp.map((c) => (
            <Item
              key={c.id}
              label={c.name}
              count={c.unread}
              active={!mentionedOnly && !allActive && activeChannelId === c.id}
              indent
              favorited={favoriteSet.has(c.id)}
              onToggleFavorite={() => onToggleFavorite(c.id)}
              onClick={() => {
                onSelectChannel(c.id)
                setOpen(false)
              }}
            />
          ))}
          {email.length > 0 && <GroupLabel icon={Mail} label="Email" />}
          {email.map((c) => (
            <Item
              key={c.id}
              label={c.name}
              count={c.unread}
              active={!mentionedOnly && !allActive && activeChannelId === c.id}
              indent
              favorited={favoriteSet.has(c.id)}
              onToggleFavorite={() => onToggleFavorite(c.id)}
              onClick={() => {
                onSelectChannel(c.id)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** A quick-switch chip tab (187N `.chip` chrome, matching the state tabs). A
 *  traffic-light status dot encodes the open-ticket load so channels aren't all
 *  visually identical: green = clear, orange = 1-9 open, red = 10+ open.
 *  Roy 2026-07-29. */
function Tab({
  icon: Icon,
  label,
  count,
  active,
  onClick,
  dot = true,
  strong = false,
}: {
  icon: typeof Mail
  label: string
  count: number
  active: boolean
  onClick: () => void
  /** Show the traffic-light status dot. Off for "All" — it aggregates
   *  everything so it'd always read red and carries no signal. */
  dot?: boolean
  /** Darker fill (surface-3 + stronger ink) so "All" reads distinct from the
   *  lighter single-channel chips. Roy 2026-07-29. */
  strong?: boolean
}) {
  // Whole-pill traffic-light tint. "All" (dot off) is neutral grey; channels go
  // green / amber / red by open-ticket load. The SELECTED tab keeps its own tone
  // (never purple) but gets a thick dark inset ring + darker border/text so it's
  // obvious which one you're on. Roy 2026-07-30.
  const toneKey = !dot ? "neutral" : count === 0 ? "green" : count < 10 ? "amber" : "red"
  const tone = {
    neutral: {
      base: "bg-muted border-border text-foreground/70",
      selected: "bg-muted border-foreground/60 text-foreground ring-foreground/45",
    },
    green: {
      base: "bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-400",
      selected:
        "bg-emerald-500/20 border-emerald-600 text-emerald-800 dark:text-emerald-200 ring-emerald-500/70",
    },
    amber: {
      base: "bg-amber-500/12 border-amber-500/35 text-amber-700 dark:text-amber-500",
      selected:
        "bg-amber-500/20 border-amber-600 text-amber-800 dark:text-amber-200 ring-amber-500/70",
    },
    red: {
      base: "bg-red-500/12 border-red-500/35 text-red-700 dark:text-red-400",
      selected: "bg-red-500/22 border-red-600 text-red-800 dark:text-red-200 ring-red-500/75",
    },
  }[toneKey]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "chip h-8 max-w-[170px]",
        active ? cn(tone.selected, "font-semibold ring-2 ring-inset") : tone.base,
        strong && "font-semibold",
      )}
      title={dot ? `${label} — ${count} open` : label}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {count > 0 && (
        <span className="font-mono text-[10.5px] tabular-nums opacity-70">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  )
}

function GroupLabel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/50">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  )
}

function Item({
  icon: Icon,
  label,
  count,
  active,
  indent,
  favorited,
  onToggleFavorite,
  onClick,
}: {
  icon?: typeof Mail
  label: string
  count: number
  active: boolean
  indent?: boolean
  favorited?: boolean
  onToggleFavorite?: () => void
  onClick: () => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-md pr-1 transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1 text-left text-sm transition-colors",
          indent ? "pl-8" : "pl-2.5",
          active ? "font-medium text-primary" : "text-muted-foreground",
        )}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
      </button>
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite()
          }}
          aria-pressed={favorited}
          title={favorited ? "Remove from tabs" : "Add to tabs"}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors",
            favorited
              ? "text-amber-500 hover:text-amber-600"
              : "text-muted-foreground/30 hover:text-muted-foreground/70",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", favorited && "fill-current")} />
        </button>
      )}
    </div>
  )
}
