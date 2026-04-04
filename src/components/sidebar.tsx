import { auth, signOut } from "@/lib/auth"
import Link from "next/link"
import Image from "next/image"
import { LogOut } from "lucide-react"
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
    <aside className="fixed inset-y-0 left-0 z-30 w-[240px] border-r border-border/20 bg-card flex flex-col">
      {/* Logo */}
      <div className="px-6 py-6 mb-2">
        <Link href="/clients" className="block">
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
      <div className="mt-auto border-t border-border/20 p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-xs font-bold text-primary ring-1 ring-primary/10">
            {session?.user.name?.[0]?.toUpperCase() ?? session?.user.email?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session?.user.name ?? "User"}</p>
            <p className="text-[11px] text-muted-foreground/60 truncate">{session?.user.email}</p>
          </div>
        </div>
        <form
          action={async () => {
            "use server"
            await signOut({ redirectTo: "/auth/signin" })
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
