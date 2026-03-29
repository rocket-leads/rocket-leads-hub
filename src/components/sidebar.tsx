import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Users, Target, Settings, LogOut } from "lucide-react"
import { SidebarNavLinks } from "./sidebar-nav-links"

const NAV_ITEMS = [
  { href: "/clients", label: "Clients", icon: "Users" as const },
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
    <aside className="fixed inset-y-0 left-0 z-30 w-[240px] border-r border-border/30 bg-card flex flex-col">
      {/* Logo */}
      <div className="px-6 py-7">
        <Link href="/clients">
          <Image
            src="/logos/logo-white-purple.svg"
            alt="Rocket Leads"
            width={140}
            height={36}
            className="h-6 w-auto hidden dark:block"
            priority
          />
          <Image
            src="/logos/logo-full-black.svg"
            alt="Rocket Leads"
            width={140}
            height={36}
            className="h-6 w-auto block dark:hidden"
            priority
          />
        </Link>
      </div>

      {/* Navigation — client component for active state */}
      <SidebarNavLinks items={allItems} />

      {/* User section */}
      <div className="border-t border-border/30 px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
            {session?.user.name?.[0]?.toUpperCase() ?? session?.user.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session?.user.name ?? "User"}</p>
            <p className="text-[11px] text-muted-foreground truncate">{session?.user.email}</p>
          </div>
        </div>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/auth/signin" })
          }}
        >
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground h-8 text-xs">
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </form>
      </div>
    </aside>
  )
}
