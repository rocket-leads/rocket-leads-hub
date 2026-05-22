import { auth } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { SidebarNavLinks } from "./sidebar-nav-links"
import { UserMenu } from "./user-menu"
import { listUserPlatformConnections, type Platform } from "@/lib/inbox/user-platform-tokens"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"
import { mondayStatusToHub } from "@/lib/clients/status"
import { fetchHealthSummary, HEALTHY_SUMMARY, type HealthSummary } from "@/lib/observability/health-summary"
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

  // Nav labels resolved through the dictionary so the language switch
  // flips them. Watch List is pulled out below for finance (they don't
  // action campaigns); Billing stays in the shared section so finance,
  // members and admins all see invoice scheduling.
  //
  // Order matches Roy's preferred flow (2026-05-21): Home → Watch List →
  // Inbox → Alle Clients → Pedro → Meetings → Targets → Billing → Settings.
  const HOME = { href: "/home", label: t("nav.home", locale), icon: "Home" as const }
  const WATCH_LIST = { href: "/watchlist", label: t("nav.watch_list", locale), icon: "Eye" as const }
  const SHARED_NAV = [
    { href: "/inbox", label: t("nav.inbox", locale), icon: "Inbox" as const },
    { href: "/clients", label: t("nav.clients", locale), icon: "Users" as const },
    { href: "/pedro", label: t("nav.pedro", locale), icon: "Megaphone" as const },
    { href: "/insights", label: t("nav.insights", locale), icon: "Layers" as const },
    { href: "/meetings", label: t("nav.meetings", locale), icon: "Video" as const },
    { href: "/targets", label: t("nav.targets", locale), icon: "Target" as const },
    { href: "/billing", label: t("nav.billing", locale), icon: "CreditCard" as const },
  ] as const

  const allItems = [
    HOME,
    ...(isFinance ? [] : [WATCH_LIST]),
    ...SHARED_NAV,
    ...(isAdmin
      ? [{ href: "/settings", label: t("nav.settings", locale), icon: "Settings" as const }]
      : []),
  ]

  // Count missing platform connections so we can flag the avatar with a dot.
  // Replies-as-self require Slack/Trengo/Monday tokens per user — if any are
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

  // For finance users, surface a numeric badge on the Billing nav showing how
  // many invoices need to go out this week (overdue + today + through Sunday)
  // — same "Due this week" window the Billing page uses. Reads the existing
  // `monday_boards` cache the cron writes — zero extra DB queries during
  // sidebar render. Lag is at most one cron tick.
  let invoicesToSendCount = 0
  if (isFinance) {
    try {
      const boards = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
      )
      if (boards) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayMs = today.getTime()
        const dayMs = 24 * 60 * 60 * 1000
        const dayOfWeek = today.getDay() // 0 = Sun
        const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek
        const endOfThisWeekMs = todayMs + daysUntilSunday * dayMs
        const all = [...boards.onboarding, ...boards.current]

        // Walk the eligible rows once, deduping by Stripe customer so
        // multi-campaign clients (B2B + B2C sharing one customer) count as
        // a single invoice — matching the Billing-page tab badge logic.
        // Rows without a Stripe customer count individually (we'll still
        // need to handle them, even if grouping isn't possible).
        const seenCustomers = new Set<string>()
        let count = 0
        for (const c of all) {
          if (!DATE_RE.test(c.nextInvoiceDate)) continue
          const status = mondayStatusToHub(c.campaignStatus, c.boardType)
          if (status !== "live" && status !== "onboarding") continue
          const d = new Date(c.nextInvoiceDate)
          d.setHours(0, 0, 0, 0)
          if (d.getTime() > endOfThisWeekMs) continue
          if (c.stripeCustomerId) {
            if (seenCustomers.has(c.stripeCustomerId)) continue
            seenCustomers.add(c.stripeCustomerId)
          }
          count++
        }
        invoicesToSendCount = count
      }
    } catch {
      // Silent — a missing cache shouldn't break the sidebar.
    }
  }
  const accountTitle = missingPlatforms > 0
    ? `My Account — ${missingPlatforms} platform${missingPlatforms === 1 ? "" : "s"} not connected (Slack, Trengo, Monday)`
    : "My Account — connect Slack, Trengo, Monday"

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
    } else {
      try {
        const supabase = await createAdminClient()
        const { data } = await supabase
          .from("user_column_mappings")
          .select("monday_column_role")
          .eq("user_id", session.user.id)
          .maybeSingle()
        const role = data?.monday_column_role as MondayRole | undefined
        if (role && MONDAY_ROLE_LABELS[role]) {
          userFunction = MONDAY_ROLE_LABELS[role]
        }
      } catch {
        // Fall back to "Member" silently — never block the sidebar render.
      }
    }
  }

  // Admin-only health dot on the Settings nav. Lit when any cron has errored
  // in the last 24h or any integration token is invalid. Cheap two-query
  // probe — best-effort, never blocks the sidebar render.
  let healthSummary: HealthSummary = HEALTHY_SUMMARY
  if (isAdmin) {
    healthSummary = await fetchHealthSummary()
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-[240px] border-r border-sidebar-border bg-sidebar flex flex-col">
      {/* Logo — sized to herMon's brand-mark scale per Roy's 2026-05-21 ask:
          read as a brand block, not a footnote. */}
      <div className="px-5 pt-7 pb-6">
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
        invoicesToSendCount={invoicesToSendCount}
        healthSummary={isAdmin ? healthSummary : null}
      />

      {/* User section — collapsed to just the avatar + name. Locale, theme,
          Settings + Sign out live behind a popover that opens on click. */}
      <div className="mt-auto border-t border-sidebar-border p-3">
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
    </aside>
  )
}
