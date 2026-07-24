"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Users, Eye, Target, Settings, Inbox, CreditCard, Home, ClipboardCheck, Calendar, TrendingUp, BarChart3, Truck, Coins } from "lucide-react"

// lucide's `Receipt` ships a $ glyph - off-brand for a €-Hub, so Billing uses
// `CreditCard`. Home uses the literal house glyph (Roy 2026-05-21). BarChart3
// / Truck / Coins are the three Growth dashboards (Marketing & Sales /
// Delivery / Finance).
const ICONS = { Users, Eye, Target, Settings, Inbox, CreditCard, Home, ClipboardCheck, Calendar, TrendingUp, BarChart3, Truck, Coins }

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

type BadgeCounts = { unreadUpdates: number; openTasks: number; unreadChats: number }

function InboxBadge() {
  const { data } = useQuery<BadgeCounts>({
    queryKey: ["inbox-badge"],
    queryFn: () => fetch("/api/inbox/badge").then((r) => r.json()),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const total =
    (data?.unreadUpdates ?? 0) + (data?.openTasks ?? 0) + (data?.unreadChats ?? 0)
  if (!total) return null

  return <span className="nav-badge">{total > 99 ? "99+" : total}</span>
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
}: {
  item: NavItem
  pathname: string
  healthSummary: HealthDotSummary | null
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
        {isInbox && <InboxBadge />}
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

export function SidebarNavLinks({ sections, healthSummary = null }: Props) {
  const pathname = usePathname()

  return (
    <>
      {sections.map((section) => (
        <div key={section.label} className="nav-section">
          <div className="nav-label">{section.label}</div>
          {section.items.map((item) => (
            <NavRow key={item.href} item={item} pathname={pathname} healthSummary={healthSummary} />
          ))}
        </div>
      ))}
    </>
  )
}
