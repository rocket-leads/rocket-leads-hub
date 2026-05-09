"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Users, Eye, Target, Settings, Inbox, Video, Receipt, Megaphone, LayoutDashboard } from "lucide-react"

const ICONS = { Users, Eye, Target, Settings, Inbox, Video, Receipt, Megaphone, LayoutDashboard }

type NavItem = { href: string; label: string; icon: keyof typeof ICONS }

type BadgeCounts = { unreadUpdates: number; openTasks: number; unreadChats: number }

function InboxBadge() {
  // Polled every 60s — cheap (three indexed counts) and good enough for
  // "I have new items". Chat unread + open tasks + unread updates all add up
  // here so the AM sees one combined "stuff waiting on me" number.
  const { data } = useQuery<BadgeCounts>({
    queryKey: ["inbox-badge"],
    queryFn: () => fetch("/api/inbox/badge").then((r) => r.json()),
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })

  const total =
    (data?.unreadUpdates ?? 0) + (data?.openTasks ?? 0) + (data?.unreadChats ?? 0)
  if (!total) return null

  return (
    <span className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
      {total > 99 ? "99+" : total}
    </span>
  )
}

type HealthDotSummary = {
  needsAttention: boolean
  recentErrors: number
  invalidIntegrations: number
}

type Props = {
  items: NavItem[]
  /** Clients with an invoice due this week (overdue + today + through Sunday)
   *  — same "Due this week" window the Billing page uses. Drives the numeric
   *  badge next to Billing. Finance-only; non-finance users always see 0. */
  invoicesToSendCount?: number
  /** Admin-only health probe. Lights up the Settings dot when crons errored
   *  or integration tokens went invalid. Null = non-admin (no dot rendered). */
  healthSummary?: HealthDotSummary | null
}

function buildHealthDotTitle(summary: HealthDotSummary | null): string {
  if (!summary) return ""
  const parts: string[] = []
  if (summary.recentErrors > 0) {
    parts.push(`${summary.recentErrors} cron error${summary.recentErrors === 1 ? "" : "s"} in last 24h`)
  }
  if (summary.invalidIntegrations > 0) {
    parts.push(
      `${summary.invalidIntegrations} integration${summary.invalidIntegrations === 1 ? "" : "s"} invalid`,
    )
  }
  return parts.length > 0
    ? `${parts.join(" · ")} — open Settings → Health`
    : "Settings → Health"
}

export function SidebarNavLinks({ items, invoicesToSendCount = 0, healthSummary = null }: Props) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 space-y-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-[0.15em] px-3 mb-2">
        Platform
      </p>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]
        const active = pathname.startsWith(href)
        const isInbox = href === "/inbox"
        const isBilling = href === "/billing"
        const isSettings = href === "/settings"
        const showHealthDot = isSettings && healthSummary?.needsAttention === true
        const healthDotTitle = showHealthDot
          ? buildHealthDotTitle(healthSummary)
          : undefined
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Icon className={`h-[17px] w-[17px] transition-colors ${active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`} />
            {label}
            {isInbox && <InboxBadge />}
            {isBilling && invoicesToSendCount > 0 && (
              <span
                className="ml-auto rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary"
                title={`${invoicesToSendCount} invoice${invoicesToSendCount === 1 ? "" : "s"} to send this week`}
                aria-label={`${invoicesToSendCount} invoices to send this week`}
              >
                {invoicesToSendCount > 99 ? "99+" : invoicesToSendCount}
              </span>
            )}
            {showHealthDot && (
              <span
                className="ml-auto h-2 w-2 rounded-full bg-red-500 animate-pulse"
                title={healthDotTitle}
                aria-label={healthDotTitle}
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
