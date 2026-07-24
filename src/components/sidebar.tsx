import { auth } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { SidebarNavLinks, type NavItem, type NavSection } from "./sidebar-nav-links"
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

const REQUIRED_PLATFORMS: Platform[] = ["slack", "trengo", "monday"]
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function Sidebar() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance
  const locale = await getUserLocale(session?.user?.id)

  // ── Per-user Monday role (drives the user-function label) ──
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

  // ── Billing "due today" badge ──
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

  // ── Nav items ──
  const HOME: NavItem = { href: "/home", label: t("nav.home", locale), icon: "Home" }
  const WATCH_LIST: NavItem = { href: "/watchlist", label: t("nav.watch_list", locale), icon: "Eye" }
  const INBOX: NavItem = { href: "/inbox", label: t("nav.inbox", locale), icon: "Inbox" }
  const CLIENTS: NavItem = { href: "/clients", label: t("nav.clients", locale), icon: "Users" }
  const ONBOARDING: NavItem = { href: "/onboarding", label: t("nav.onboarding", locale), icon: "ClipboardCheck" }
  const OPTIMIZE: NavItem = { href: "/optimize", label: t("nav.optimize", locale), icon: "TrendingUp" }
  const CALENDAR: NavItem = { href: "/calendar", label: t("nav.calendar", locale), icon: "Calendar" }
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

  // Grouped into 187N nav-sections. Finance hides Watch List / Onboarding /
  // Optimize / Calendar (same rule as before); pure campaign managers hide
  // Billing. Empty sections are dropped so a filtered-out group leaves no
  // orphan mono label.
  const rawSections: NavSection[] = [
    { label: "Overview", items: [HOME, ...(isFinance ? [] : [WATCH_LIST])] },
    {
      label: "Workspace",
      items: [INBOX, CLIENTS, ...(isFinance ? [] : [ONBOARDING, CALENDAR])],
    },
    { label: "Growth", items: [...(isFinance ? [] : [OPTIMIZE]), TARGETS] },
    { label: "Account", items: [...(isPureCampaignManager ? [] : [BILLING]), SETTINGS] },
  ]
  const sections = rawSections.filter((s) => s.items.length > 0)

  // Count missing platform connections so we can flag the avatar with a dot.
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

  // Job-function label shown in the sidebar user trigger.
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

  // Admin-only Settings dot: infra health probe ∪ setup checklist.
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

  const homeHref = isFinance ? "/billing" : "/watchlist"

  return (
    <aside className="sidebar">
      {/* Brand lockup: circular Rocket Leads mark + wordmark + live pill. */}
      <div className="brand">
        <Link href={homeHref} aria-label="Rocket Leads" className="brand-mark">
          <Image
            src="/logos/logo-mark-circular.svg"
            alt="Rocket Leads"
            width={64}
            height={64}
            className="mark-img"
            priority
          />
        </Link>
        <div className="brand-stack">
          <span className="brand-name">Rocket Leads</span>
          <span className="brand-sub">GROWTH HUB</span>
          <span className="online-pill">
            <span className="pdot" />
            <span className="label">Online</span>
          </span>
        </div>
      </div>

      {/* Navigation - grouped sections with active left-bar + tint. */}
      <SidebarNavLinks sections={sections} healthSummary={combinedDot} />

      {/* Footer: user block. Locale, Settings + Sign out live behind the
          popover the UserMenu opens on click. */}
      <div className="sidebar-footer">
        <UserMenu
          initialLocale={locale}
          userName={session?.user.name ?? t("account.user_fallback", locale)}
          userFunction={userFunction}
          userInitial={
            session?.user.name?.[0]?.toUpperCase() ??
            session?.user.email?.[0]?.toUpperCase() ??
            "?"
          }
          avatarUrl={session?.user.image}
          missingPlatforms={missingPlatforms}
          accountTitle={accountTitle}
        />
      </div>
    </aside>
  )
}
