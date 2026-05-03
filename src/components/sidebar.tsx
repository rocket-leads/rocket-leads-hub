import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { LogOut } from "lucide-react"
import { SidebarNavLinks } from "./sidebar-nav-links"
import { ThemeToggle } from "./theme-toggle"

const NAV_ITEMS = [
  { href: "/watchlist", label: "Watch List", icon: "Eye" as const },
  { href: "/clients", label: "Clients", icon: "Users" as const },
  { href: "/inbox", label: "Inbox", icon: "Inbox" as const },
  { href: "/targets", label: "Targets", icon: "Target" as const },
]

export async function Sidebar() {
  const session = await auth()
  const isAdmin = session?.user.role === "admin"

  const allItems = [
    ...NAV_ITEMS,
    ...(isAdmin ? [{ href: "/settings", label: "Settings", icon: "Settings" as const }] : []),
  ]

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-[240px] border-r border-sidebar-border bg-sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-5">
        <Link href="/watchlist" className="block">
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
          title="My Account — connect Slack, Trengo, Monday"
        >
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/25 to-primary/10 flex items-center justify-center text-[11px] font-semibold text-primary ring-1 ring-primary/15">
            {session?.user.name?.[0]?.toUpperCase() ?? session?.user.email?.[0]?.toUpperCase() ?? "?"}
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
