"use client"

import { useEffect, useRef, useState } from "react"
import { AtSign, ChevronDown, Inbox, Mail, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChannelEntry } from "./external-rail"

/**
 * Compact channel selector that folds the old external rail into the thread-list
 * header — the 2-column 187N Chats layout (list + thread), no separate rail
 * column. A single dropdown switches between Mentioned / All channels / a
 * specific WhatsApp or Email line. Roy 2026-07-24.
 */
type Props = {
  whatsapp: ChannelEntry[]
  email: ChannelEntry[]
  activeChannelId: number | null
  allActive: boolean
  mentionedOnly: boolean
  allCount: number
  mentionedCount: number
  onSelectAll: () => void
  onSelectChannel: (id: number) => void
  onSelectMentioned: () => void
}

export function ChannelPicker({
  whatsapp,
  email,
  activeChannelId,
  allActive,
  mentionedOnly,
  allCount,
  mentionedCount,
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

  const activeChannel = [...whatsapp, ...email].find((c) => c.id === activeChannelId)
  const CurrentIcon = mentionedOnly
    ? AtSign
    : allActive
      ? Inbox
      : whatsapp.some((c) => c.id === activeChannelId)
        ? MessageCircle
        : email.some((c) => c.id === activeChannelId)
          ? Mail
          : Inbox
  const currentLabel = mentionedOnly
    ? "Mentioned"
    : allActive
      ? "All channels"
      : activeChannel?.name ?? "All channels"
  const currentCount = mentionedOnly ? mentionedCount : allActive ? allCount : activeChannel?.unread ?? 0

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:border-foreground/20"
      >
        <CurrentIcon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate text-left font-medium">{currentLabel}</span>
        {currentCount > 0 && <span className="nav-badge">{currentCount > 99 ? "99+" : currentCount}</span>}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
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
          {whatsapp.length > 0 && <GroupLabel icon={MessageCircle} label="WhatsApp" />}
          {whatsapp.map((c) => (
            <Item
              key={c.id}
              label={c.name}
              count={c.unread}
              active={!mentionedOnly && !allActive && activeChannelId === c.id}
              indent
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
  onClick,
}: {
  icon?: typeof Mail
  label: string
  count: number
  active: boolean
  indent?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm transition-colors",
        indent ? "pl-8" : "pl-2.5",
        active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count > 0 && <span className="nav-badge">{count > 99 ? "99+" : count}</span>}
    </button>
  )
}
