"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Users, Eye, Target, Settings, Inbox, CreditCard, Home, ClipboardCheck, Calendar, TrendingUp, BarChart3, Truck, Banknote, Sparkles } from "lucide-react"

// lucide's `Receipt` ships a $ glyph - off-brand for a €-Hub, so Billing uses
// `CreditCard`. Home uses the literal house glyph (Roy 2026-05-21). BarChart3
// / Truck / Banknote are the three Growth dashboards (Marketing & Sales /
// Delivery / Finance).
const ICONS = { Users, Eye, Target, Settings, Inbox, CreditCard, Home, ClipboardCheck, Calendar, TrendingUp, BarChart3, Truck, Banknote, Sparkles }

type IconKey = keyof typeof ICONS

export type NavItem = {
  href: string
  label: string
  icon: IconKey
  /** Numeric badge rendered on the right side of the row. Used by Billing
   *  (invoices due today). 0 hides. */
  badge?: number
  badgeTitle?: string
}

/** A titled group of nav items - renders as 187N's `.nav-section` with a mono
 *  `.nav-label` header. */
export type NavSection = {
  label: string
  items: NavItem[]
}

type BadgeCounts = {
  unreadUpdates: number
  openTasks: number
  unreadChats: number
  unreadByChannel?: Record<string, number>
  mentions?: number
}

const fmtBadge = (n: number) => (n > 99 ? "99+" : String(n))

/** Read the user's favourited inbox channel ids (same localStorage key the
 *  inbox tab writes). Returns [] when unavailable. */
function readFavoriteChannelIds(userId: string | undefined): number[] {
  if (!userId) return []
  try {
    const raw = localStorage.getItem(`inbox:fav-channels:${userId}`)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is number => typeof x === "number") : []
  } catch {
    return []
  }
}

/**
 * Split inbox badge: `internal / external`.
 *   - internal = unread Updates + open Tasks (the Internal inbox)
 *   - external = unread @-mentions + unread on your FAVOURITE channels only
 *     (not all channels — those are noise). Roy 2026-07-29.
 * Favourites live in localStorage (per user), so we sum them client-side from
 * the per-channel breakdown the badge API returns.
 */
function InboxBadge({ userId }: { userId?: string }) {
  const { data } = useQuery<BadgeCounts>({
    queryKey: ["inbox-badge"],
    queryFn: () => fetch("/api/inbox/badge").then((r) => r.json()),
    // Snappier so assigning/closing a ticket reflects fast; the inbox also
    // invalidates ["inbox-badge"] on every ticket action for instant updates.
    // Roy 2026-07-31.
    refetchInterval: 20 * 1000,
    staleTime: 5 * 1000,
  })

  const [favIds, setFavIds] = useState<number[]>([])
  useEffect(() => {
    setFavIds(readFavoriteChannelIds(userId))
    // Re-read when favourites change: cross-tab via `storage`, same-tab via the
    // custom event the inbox dispatches on toggle.
    const reread = () => setFavIds(readFavoriteChannelIds(userId))
    window.addEventListener("storage", reread)
    window.addEventListener("inbox-favorites-changed", reread)
    return () => {
      window.removeEventListener("storage", reread)
      window.removeEventListener("inbox-favorites-changed", reread)
    }
  }, [userId])

  const internal = (data?.unreadUpdates ?? 0) + (data?.openTasks ?? 0)
  const byChannel = data?.unreadByChannel ?? {}
  const favUnread = favIds.reduce((sum, id) => sum + (byChannel[String(id)] ?? 0), 0)
  const external = (data?.mentions ?? 0) + favUnread

  if (internal === 0 && external === 0) return null

  return (
    <span className="nav-badge" title={`Internal ${internal} · External ${external}`}>
      {fmtBadge(internal)}
      <span className="px-0.5 opacity-40">/</span>
      {fmtBadge(external)}
    </span>
  )
}

type HealthDotSummary = {
  needsAttention: boolean
  recentErrors: number
  invalidIntegrations: number
  incompleteCount: number
}

type Props = {
  sections: NavSection[]
  /** Admin-only health probe. Lights the Settings dot when crons errored or
   *  integration tokens went invalid. Null = non-admin (no dot). */
  healthSummary?: HealthDotSummary | null
  /** Current user id — used to read that user's favourited channels for the
   *  split inbox badge. */
  userId?: string
}

function buildHealthDotTitle(summary: HealthDotSummary | null): string {
  if (!summary) return ""
  const parts: string[] = []
  if (summary.incompleteCount > 0) {
    parts.push(`${summary.incompleteCount} setup item${summary.incompleteCount === 1 ? "" : "s"} to complete`)
  }
  if (summary.recentErrors > 0) {
    parts.push(`${summary.recentErrors} cron error${summary.recentErrors === 1 ? "" : "s"} in last 24h`)
  }
  if (summary.invalidIntegrations > 0) {
    parts.push(`${summary.invalidIntegrations} integration${summary.invalidIntegrations === 1 ? "" : "s"} invalid`)
  }
  return parts.length > 0 ? `${parts.join(" · ")} - open Settings` : "Settings"
}

function NavRow({
  item,
  pathname,
  healthSummary,
  userId,
}: {
  item: NavItem
  pathname: string
  healthSummary: HealthDotSummary | null
  userId?: string
}) {
  const Icon = ICONS[item.icon]
  const isInbox = item.href === "/inbox"
  const isSettings = item.href === "/settings"
  const active = pathname === item.href || pathname.startsWith(item.href + "/")

  const showHealthDot = isSettings && healthSummary?.needsAttention === true
  const healthDotTitle = showHealthDot ? buildHealthDotTitle(healthSummary) : undefined
  const badgeCount = item.badge ?? 0

  return (
    <Link href={item.href} className={`nav-item${active ? " active" : ""}`}>
      <Icon />
      <span className="truncate">{item.label}</span>
      <span className="ml-auto inline-flex items-center gap-1.5">
        {isInbox && <InboxBadge userId={userId} />}
        {badgeCount > 0 && (
          <span className="nav-badge" title={item.badgeTitle} aria-label={item.badgeTitle ?? `${badgeCount}`}>
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        {showHealthDot && (
          <span
            className="h-2 w-2 rounded-full bg-[var(--st-error)] animate-pulse"
            title={healthDotTitle}
            aria-label={healthDotTitle}
          />
        )}
      </span>
    </Link>
  )
}

export function SidebarNavLinks({ sections, healthSummary = null, userId }: Props) {
  const pathname = usePathname()

  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="nav-section">
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => (
            <NavRow
              key={item.href}
              item={item}
              pathname={pathname}
              healthSummary={healthSummary}
              userId={userId}
            />
          ))}
        </div>
      ))}
    </>
  )
}
