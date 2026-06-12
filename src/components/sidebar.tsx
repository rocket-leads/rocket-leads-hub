import { auth } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { SidebarNavLinks, type NavItem } from "./sidebar-nav-links"
import { UserMenu } from "./user-menu"
import { listUserPlatformConnections, type Platform } from "@/lib/inbox/user-platform-tokens"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"
import { mondayStatusToHub } from "@/lib/clients/status"
import { fetchHealthSummary, HEALTHY_SUMMARY, type HealthSummary } from "@/lib/observability/health-summary"
import { fetchSetupChecklist, type SetupChecklist, EMPTY_CHECKLIST } from "@/lib/observability/setup-checklist"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import { createAdminClient } from "@/lib/supabase/server"
import { MONDAY_ROLE_LABELS, type MondayRole } from "@/app/(dashboard)/settings/types"
import { SidebarCollapseToggle } from "@/components/sidebar-collapse-toggle"

const REQUIRED_PLATFORMS: Platform[] = ["slack", "trengo", "monday"]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function Sidebar() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  const locale = await getUserLocale(session?.user?.id)

  // ── Per-user Monday role (drives the AM-only meeting badge) ──
  // Resolve once early so we can branch on AM for the unmatched-meetings
  // count below without a second round-trip.
  let mondayRole: MondayRole | null = null
  let isPureCampaignManager = false
  if (session?.user?.id && !isAdmin && !isFinance) {
    try {
      const supabase = await createAdminClient()
      const { data } = await supabase
        .from("user_column_mappings")
        .select("monday_column_role")
        .eq("user_id", session.user.id)
      const rows = (data ?? []) as { monday_column_role: MondayRole }[]
      // Pick the primary role for label/badge logic. If the user holds
      // both AM and CM, prefer AM since AM is the broader-access role.
      mondayRole =
        rows.find((r) => r.monday_column_role === "account_manager")?.monday_column_role
          ?? rows[0]?.monday_column_role
          ?? null
      isPureCampaignManager =
        rows.some((r) => r.monday_column_role === "campaign_manager") &&
        !rows.some((r) => r.monday_column_role === "account_manager")
    } catch {
      // Silent - never block the sidebar render.
    }
  }
  // Note: the unmatched-meetings badge used to live here as a child of the
  // Meetings sidebar entry. Meetings became a "Recordings" tab inside
  // Calendar (Roy 2026-06-12), so the badge moves to that tab — handled in
  // the calendar-tabs component, not at the sidebar level.

  // ── Billing "due today" badge ──
  // Replaces the previous "due this week" finance-only badge. Roy wants a
  // narrower signal: an invoice that needs to go out TODAY. Visible to
  // anyone who has the Billing nav (admin + finance + member today, per
  // current access policy). Reads the same monday_boards cache as before
  // so zero extra DB queries.
  let invoicesDueTodayCount = 0
  if (isAdmin || isFinance) {
    try {
      const boards = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
      )
      if (boards) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayMs = today.getTime()
        const all = [...boards.onboarding, ...boards.current]
        const seenCustomers = new Set<string>()
        let count = 0
        for (const c of all) {
          if (!DATE_RE.test(c.nextInvoiceDate)) continue
          const status = mondayStatusToHub(c.campaignStatus, c.boardType)
          if (status !== "live" && status !== "onboarding") continue
          const d = new Date(c.nextInvoiceDate)
          d.setHours(0, 0, 0, 0)
          // Strict today match - overdue invoices show on the Billing page
          // itself; the sidebar badge only fires the day a fresh invoice
          // is due so it functions as a daily nudge, not a backlog count.
          if (d.getTime() !== todayMs) continue
          if (c.stripeCustomerId) {
            if (seenCustomers.has(c.stripeCustomerId)) continue
            seenCustomers.add(c.stripeCustomerId)
          }
          count++
        }
        invoicesDueTodayCount = count
      }
    } catch {
      // Silent - a missing cache shouldn't break the sidebar.
    }
  }

  // ── Top group: navigational tools ──
  // Roy 2026-06-11: Pedro Onboard is verhuisd naar de Onboarding wizard;
  // Pedro Optimize wordt een eigen top-level "Optimaliseer" item.
  // Insights eruit. Meetings wordt z'n eigen top-level item.
  const HOME: NavItem = { href: "/home", label: t("nav.home", locale), icon: "Home" }
  const WATCH_LIST: NavItem = { href: "/watchlist", label: t("nav.watch_list", locale), icon: "Eye" }
  const OPTIMIZE: NavItem = {
    href: "/optimize",
    label: t("nav.optimize", locale),
    icon: "Wrench",
  }
  // Calendar shows the signed-in user's Google Calendar events + their
  // open Hub tasks color-coded in one week view, with a "Recordings"
  // tab linking to the Fathom meetings archive at /meetings.
  const CALENDAR: NavItem = {
    href: "/calendar",
    label: t("nav.calendar", locale),
    icon: "Calendar",
  }

  const TOP_GROUP: NavItem[] = [
    HOME,
    ...(isFinance ? [] : [WATCH_LIST]),
    { href: "/inbox", label: t("nav.inbox", locale), icon: "Inbox" },
    { href: "/clients", label: t("nav.clients", locale), icon: "Users" },
    // Finance doesn't run onboarding - hide for them, same rule as Watch List.
    // Uses ClipboardCheck (not Rocket) to avoid colliding with Pedro → On-board.
    ...(isFinance
      ? []
      : [{ href: "/onboarding", label: t("nav.onboarding", locale), icon: "ClipboardCheck" as const }]),
    // MEETINGS verhuisde naar een tab onder Calendar ("Recordings"),
    // dus hier alleen nog Calendar als top-level entry.
    ...(isFinance ? [] : [OPTIMIZE, CALENDAR]),
  ]

  // ── Bottom group: ops / admin stack ──
  // Targets stays visible to everyone (the page itself gates its finance
  // tab to admin+finance - Roy 2026-05-23). Billing visible to admin +
  // finance + member today per current policy. Settings is visible to
  // everyone - non-admins land on the Me tab (personal account: platform
  // connections, notifications, Trengo channel subscriptions); the page
  // itself hides admin-only tabs.
  const BILLING: NavItem = {
    href: "/billing",
    label: t("nav.billing", locale),
    icon: "CreditCard",
    ...(invoicesDueTodayCount > 0
      ? {
          badge: invoicesDueTodayCount,
          badgeTitle: `${invoicesDueTodayCount} invoice${invoicesDueTodayCount === 1 ? "" : "s"} to send today`,
        }
      : {}),
  }
  const TARGETS: NavItem = { href: "/targets", label: t("nav.targets", locale), icon: "Target" }
  const SETTINGS: NavItem = { href: "/settings", label: t("nav.settings", locale), icon: "Settings" }

  // Billing is for AM / Finance / Admin only - hide it for pure campaign
  // managers. Roy 2026-06-11.
  const bottomGroup: NavItem[] = isPureCampaignManager
    ? [TARGETS, SETTINGS]
    : [BILLING, TARGETS, SETTINGS]

  const allItems: NavItem[] = [...TOP_GROUP, ...bottomGroup]

  // Count missing platform connections so we can flag the avatar with a dot.
  // Replies-as-self require Slack/Trengo/Monday tokens per user - if any are
  // missing, the user's reply path is broken until they connect.
  let missingPlatforms = 0
  if (session?.user?.id) {
    try {
      const connections = await listUserPlatformConnections(session.user.id)
      const connected = new Set(connections.map((c) => c.platform))
      missingPlatforms = REQUIRED_PLATFORMS.filter((p) => !connected.has(p)).length
    } catch {
      // Don't block the sidebar render if the lookup fails.
    }
  }

  const accountTitle = missingPlatforms > 0
    ? `My Account - ${missingPlatforms} platform${missingPlatforms === 1 ? "" : "s"} not connected (Slack, Trengo, Monday)`
    : "My Account - connect Slack, Trengo, Monday"

  // Job-function label shown in the sidebar user trigger. Resolution order:
  //   admin   → "Owner" (one per workspace, top of hierarchy)
  //   finance → "Finance" (org-level, no Monday person column)
  //   else    → MONDAY_ROLE_LABELS[monday_role] from user_column_mappings
  //   else    → "Member"
  let userFunction = "Member"
  if (session?.user?.id) {
    if (isAdmin) {
      userFunction = "Owner"
    } else if (isFinance) {
      userFunction = "Finance"
    } else if (mondayRole && MONDAY_ROLE_LABELS[mondayRole]) {
      userFunction = MONDAY_ROLE_LABELS[mondayRole]
    }
  }

  // Admin-only Settings dot. Drives off the union of (a) infra health
  // probe (cron errors / invalid tokens) and (b) the setup checklist
  // (missing API tokens / board config / column mappings). Either of
  // those needing attention lights the dot so the admin notices.
  let healthSummary: HealthSummary = HEALTHY_SUMMARY
  let checklist: SetupChecklist = EMPTY_CHECKLIST
  if (isAdmin) {
    ;[healthSummary, checklist] = await Promise.all([
      fetchHealthSummary(),
      fetchSetupChecklist(),
    ])
  }
  const combinedNeedsAttention =
    healthSummary.needsAttention || checklist.incompleteCount > 0
  const combinedDot = isAdmin
    ? {
        needsAttention: combinedNeedsAttention,
        recentErrors: healthSummary.recentErrors,
        invalidIntegrations: healthSummary.invalidIntegrations,
        incompleteCount: checklist.incompleteCount,
      }
    : null

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-[var(--sidebar-w)] border-r border-sidebar-border bg-sidebar flex flex-col transition-[width] duration-150 overflow-hidden">
      {/* Logo - sized to herMon's brand-mark scale per Roy's 2026-05-21 ask:
          read as a brand block, not a footnote. Wrapped in .sidebar-label
          so the full lockup hides in collapsed mode. */}
      <div className="px-5 pt-7 pb-6 sidebar-label">
        <Link href={isFinance ? "/billing" : "/watchlist"} className="block">
          <Image
            src="/logos/logo-white-purple.svg"
            alt="Rocket Leads"
            width={200}
            height={52}
            className="h-10 w-auto hidden dark:block"
            priority
          />
          <Image
            src="/logos/logo-full-black.svg"
            alt="Rocket Leads"
            width={200}
            height={52}
            className="h-10 w-auto block dark:hidden"
            priority
          />
        </Link>
      </div>

      {/* Navigation */}
      <SidebarNavLinks
        items={allItems}
        healthSummary={combinedDot}
      />

      {/* User section - collapsed to just the avatar + name. Locale, theme,
          Settings + Sign out live behind a popover that opens on click. */}
      <div className="mt-auto border-t border-sidebar-border p-3 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <UserMenu
            initialLocale={locale}
            userName={session?.user.name ?? t("account.user_fallback", locale)}
            userFunction={userFunction}
            userInitial={
              session?.user.name?.[0]?.toUpperCase() ??
              session?.user.email?.[0]?.toUpperCase() ??
              "?"
            }
            missingPlatforms={missingPlatforms}
            accountTitle={accountTitle}
          />
        </div>
        {/* Collapse toggle — always visible regardless of state so the
            user can always re-expand. Sits next to UserMenu so the row
            stays balanced. */}
        <SidebarCollapseToggle />
      </div>
    </aside>
  )
}
