import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { LogOut } from "lucide-react"
import { SidebarNavLinks } from "./sidebar-nav-links"
import { ThemeToggle } from "./theme-toggle"
import { listUserPlatformConnections, type Platform } from "@/lib/inbox/user-platform-tokens"

const REQUIRED_PLATFORMS: Platform[] = ["slack", "trengo", "monday"]

// Default nav for members, admins and finance users alike. Watch List is
// pulled out below for the finance role (they don't action campaigns).
// Billing is in the shared section so everyone — finance, members, admins —
// can see invoice scheduling.
const WATCH_LIST = { href: "/watchlist", label: "Watch List", icon: "Eye" as const }
const SHARED_NAV = [
  { href: "/clients", label: "Clients", icon: "Users" as const },
  { href: "/inbox", label: "Inbox", icon: "Inbox" as const },
  { href: "/meetings", label: "Meetings", icon: "Video" as const },
  { href: "/targets", label: "Targets", icon: "Target" as const },
  { href: "/billing", label: "Billing", icon: "Receipt" as const },
] as const

export async function Sidebar() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"
  const isFinance = !!session?.user.isFinance

  const allItems = [
    // Finance gets a tailored stack without the Watch List; everyone else
    // keeps the full list.
    ...(isFinance ? [] : [WATCH_LIST]),
    ...SHARED_NAV,
    ...(isAdmin
      ? [{ href: "/settings", label: "Settings", icon: "Settings" as const }]
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
  const accountTitle = missingPlatforms > 0
    ? `My Account — ${missingPlatforms} platform${missingPlatforms === 1 ? "" : "s"} not connected (Slack, Trengo, Monday)`
    : "My Account — connect Slack, Trengo, Monday"

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-[240px] border-r border-sidebar-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <Link href={isFinance ? "/billing" : "/watchlist"} className="block">
          <Image
            src="/logos/logo-white-purple.svg"
            alt="Rocket Leads"
            width={140}
            height={36}
            className="h-7 w-auto hidden dark:block"
            priority
          />
          <Image
            src="/logos/logo-full-black.svg"
            alt="Rocket Leads"
            width={140}
            height={36}
            className="h-7 w-auto block dark:hidden"
            priority
          />
        </Link>
      </div>

      {/* Navigation */}
      <SidebarNavLinks items={allItems} />

      {/* User section */}
      <div className="mt-auto border-t border-sidebar-border p-3">
        <div className="mb-1">
          <ThemeToggle />
        </div>
        <Link
          href="/account"
          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors group"
          title={accountTitle}
        >
          <div className="relative">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/25 to-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary ring-1 ring-primary/15">
              {session?.user.name?.[0]?.toUpperCase() ?? session?.user.email?.[0]?.toUpperCase() ?? "?"}
            </div>
            {missingPlatforms > 0 && (
              <span
                aria-label={`${missingPlatforms} platform${missingPlatforms === 1 ? "" : "s"} not connected`}
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-sidebar"
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium leading-tight truncate group-hover:text-foreground transition-colors">{session?.user.name ?? "User"}</p>
            <p className="text-[11px] text-muted-foreground/70 truncate">{session?.user.email}</p>
          </div>
        </Link>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/auth/signin" })
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
