"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Users, Target, Settings } from "lucide-react"

const ICONS = { Users, Target, Settings }

type NavItem = { href: string; label: string; icon: keyof typeof ICONS }

export function SidebarNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 space-y-0.5">
      <p className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-widest px-3 mb-2">Menu</p>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
              active
                ? "bg-primary/10 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-primary" : ""}`} />
            {label}
            {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />}
          </Link>
        )
      })}
    </nav>
  )
}
