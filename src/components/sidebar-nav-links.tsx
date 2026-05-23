"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Users, Eye, Target, Settings, Inbox, Video, CreditCard, Megaphone, Home, Layers, Rocket, Wrench, ChevronRight } from "lucide-react"

// Note: lucide's `Receipt` ships with a $ glyph baked into the SVG. Roy
// flagged it as off-brand for a Hub that talks Euros — we use `CreditCard`
// here so the nav-level Billing icon stays currency-agnostic and visually
// quiet, matching the abstract style of the rest of the sidebar items
// (Users, Inbox, Megaphone, Target, etc.). Home uses lucide's `Home`
// (literal house glyph) per Roy's 2026-05-21 ask.
const ICONS = { Users, Eye, Target, Settings, Inbox, Video, CreditCard, Megaphone, Home, Layers, Rocket, Wrench }

type IconKey = keyof typeof ICONS

export type NavItem = {
  href: string
  label: string
  icon: IconKey
  /** Optional nested items rendered indented under the parent. When a child
   *  route is active, the parent gets a subtle "section active" treatment
   *  and the matching child gets the strong active highlight. Children
   *  show whenever the parent route is active or after the user has
   *  clicked the parent at least once (state persisted to localStorage).
   *  Roy 2026-05-23: no chevron, no toggle — single click area, always
   *  expand. */
  children?: NavItem[]
  /** Numeric badge rendered on the right side of the row. Used by Pedro
   *  (unmatched meetings) and Billing (invoices due today). 0 hides. */
  badge?: number
  /** Tooltip for the badge so the user knows what it counts without
   *  having to click through. */
  badgeTitle?: string
}

/** Marker entry that renders a horizontal rule + extra spacing between
 *  two nav sections. Lets the sidebar visually group the "tools" stack
 *  (Home / Watch list / All campaigns / Pedro) above the "admin
 *  stack" (Billing / Targets / Settings) without needing two separate
 *  <nav> elements. */
export type NavDivider = { kind: "divider" }

export type NavEntry = NavItem | NavDivider

function isDivider(e: NavEntry): e is NavDivider {
  return (e as NavDivider).kind === "divider"
}

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
  /** Number of incomplete setup-checklist items (missing API tokens,
   *  board config, user mappings). Distinct from the runtime probe
   *  numbers so the tooltip can call them out separately. */
  incompleteCount: number
}

type Props = {
  items: NavEntry[]
  /** Admin-only health probe. Lights up the Settings dot when crons errored
   *  or integration tokens went invalid. Null = non-admin (no dot rendered). */
  healthSummary?: HealthDotSummary | null
}

function buildHealthDotTitle(summary: HealthDotSummary | null): string {
  if (!summary) return ""
  const parts: string[] = []
  if (summary.incompleteCount > 0) {
    parts.push(
      `${summary.incompleteCount} setup item${summary.incompleteCount === 1 ? "" : "s"} to complete`,
    )
  }
  if (summary.recentErrors > 0) {
    parts.push(`${summary.recentErrors} cron error${summary.recentErrors === 1 ? "" : "s"} in last 24h`)
  }
  if (summary.invalidIntegrations > 0) {
    parts.push(
      `${summary.invalidIntegrations} integration${summary.invalidIntegrations === 1 ? "" : "s"} invalid`,
    )
  }
  return parts.length > 0
    ? `${parts.join(" · ")} — open Settings`
    : "Settings"
}

type RowProps = {
  item: NavItem
  pathname: string
  healthSummary: HealthDotSummary | null
  /** Nested children get a left-indent + smaller leading dot in lieu of an
   *  icon. Parents render their lucide icon. */
  indent?: boolean
  /** Parent active = a child route is the current path. We want the parent
   *  to read as "section selected" but not steal the strong highlight from
   *  the active child. */
  isParentSection?: boolean
  /** Side-effect to run when this row is clicked, in addition to the
   *  Link's navigation. Used by parent rows to toggle their children
   *  open/closed on the same click that navigates. */
  onClick?: () => void
  /** Renders a chevron on the right of the row that rotates to indicate
   *  open/closed state. Visual only — the whole row is the click target.
   *  Roy 2026-05-23: chevron-down when expanded, chevron-right when
   *  collapsed (matches herMon's sidebar pattern). */
  chevron?: { open: boolean }
}

function NavRow({ item, pathname, healthSummary, indent, isParentSection, onClick, chevron }: RowProps) {
  const Icon = ICONS[item.icon]
  const isInbox = item.href === "/inbox"
  const isSettings = item.href === "/settings"

  const active = pathname === item.href || pathname.startsWith(item.href + "/")

  const showHealthDot = isSettings && healthSummary?.needsAttention === true
  const healthDotTitle = showHealthDot ? buildHealthDotTitle(healthSummary) : undefined
  const badgeCount = item.badge ?? 0

  const baseClasses =
    "group flex items-center gap-3 rounded-lg text-[15px] transition-colors duration-150"
  const sizing = indent ? "pl-9 pr-3 py-1.5 text-[14px]" : "px-3 py-2"
  const stateClasses = active
    ? "bg-primary/10 text-primary font-medium"
    : isParentSection
      ? "text-foreground hover:bg-muted/60"
      : "text-foreground/75 hover:text-foreground hover:bg-muted/60"

  return (
    <Link href={item.href} onClick={onClick} className={`${baseClasses} ${sizing} ${stateClasses}`}>
      {indent ? (
        <span
          className={`h-1.5 w-1.5 rounded-full transition-colors ${
            active ? "bg-primary" : "bg-foreground/25 group-hover:bg-foreground/50"
          }`}
        />
      ) : (
        <Icon
          className={`h-[18px] w-[18px] transition-colors ${
            active || isParentSection
              ? "text-primary"
              : "text-foreground/60 group-hover:text-foreground"
          }`}
        />
      )}
      <span className="truncate">{item.label}</span>
      {/* Spacer pushes any trailing chips/dot/chevron to the right edge.
          Using a single ml-auto spacer (instead of putting ml-auto on the
          first trailing element) so badge + chevron can sit side-by-side
          on parent rows like Pedro without stealing each other's space. */}
      <span className="ml-auto inline-flex items-center gap-1.5">
        {isInbox && <InboxBadge />}
        {badgeCount > 0 && (
          <span
            className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary"
            title={item.badgeTitle}
            aria-label={item.badgeTitle ?? `${badgeCount}`}
          >
            {badgeCount > 99 ? "99+" : badgeCount}
          </span>
        )}
        {showHealthDot && (
          <span
            className="h-2 w-2 rounded-full bg-red-500 animate-pulse"
            title={healthDotTitle}
            aria-label={healthDotTitle}
          />
        )}
        {chevron && (
          <ChevronRight
            className={`h-3.5 w-3.5 text-foreground/40 transition-transform duration-150 ${chevron.open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        )}
      </span>
    </Link>
  )
}

const EXPAND_STORAGE_KEY = "sidebar.expandedGroups"

export function SidebarNavLinks({ items, healthSummary = null }: Props) {
  const pathname = usePathname()

  // Per-parent expanded state. Persisted to localStorage so the user's
  // preference survives reloads. Default for any group not yet in
  // storage: expanded when on a route inside it, collapsed otherwise.
  // Clicking the parent always sets this to true (Roy 2026-05-23:
  // single click area, always expand — no separate chevron toggle).
  // SSR-safe: initialise empty, hydrate from localStorage in effect.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPAND_STORAGE_KEY)
      if (raw) setExpanded(JSON.parse(raw))
    } catch {
      // Ignore parse failures — fall back to defaults.
    }
    setHydrated(true)
  }, [])

  function isExpanded(item: NavItem): boolean {
    // Before hydration, render the SSR-stable default (expanded if the
    // current route is inside the group). After hydration, prefer the
    // explicit user choice if they've ever clicked this group.
    if (!hydrated || !(item.href in expanded)) {
      return pathname === item.href || pathname.startsWith(item.href + "/")
    }
    return expanded[item.href]
  }

  function toggleExpand(item: NavItem) {
    setExpanded((prev) => {
      const currentOpen =
        item.href in prev
          ? prev[item.href]
          : pathname === item.href || pathname.startsWith(item.href + "/")
      const next = { ...prev, [item.href]: !currentOpen }
      try {
        window.localStorage.setItem(EXPAND_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Ignore quota / disabled storage — toggle still works in-session.
      }
      return next
    })
  }

  return (
    <nav className="flex-1 px-3 space-y-0.5">
      {items.map((entry, idx) => {
        if (isDivider(entry)) {
          return (
            <div key={`divider-${idx}`} className="my-3 mx-3 h-px bg-border/60" />
          )
        }
        const item = entry
        const hasChildren = !!item.children?.length
        const isParentSection =
          hasChildren &&
          (pathname === item.href || pathname.startsWith(item.href + "/"))
        const open = hasChildren ? isExpanded(item) : false

        return (
          <div key={item.href}>
            <NavRow
              item={item}
              pathname={pathname}
              healthSummary={healthSummary}
              isParentSection={hasChildren ? isParentSection : false}
              onClick={hasChildren ? () => toggleExpand(item) : undefined}
              chevron={hasChildren ? { open } : undefined}
            />
            {hasChildren && open && (
              <div className="mt-0.5 mb-1 space-y-0.5">
                {item.children!.map((child) => (
                  <NavRow
                    key={child.href}
                    item={child}
                    pathname={pathname}
                    healthSummary={healthSummary}
                    indent
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}
