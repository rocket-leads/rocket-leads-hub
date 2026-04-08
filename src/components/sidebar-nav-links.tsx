"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Users, Target, Settings } from "lucide-react"

const ICONS = { Users, Target, Settings }

type NavItem = { href: string; label: string; icon: keyof typeof ICONS }

export function SidebarNavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 space-y-1">
      <p className="text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-[0.15em] px-3 mb-3">
        Menu
      </p>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon]
        const active = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
              active
                ? "bg-primary/10 text-foreground font-medium shadow-sm shadow-primary/5"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
            }`}
          >
            <Icon className={`h-[18px] w-[18px] transition-colors ${active ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"}`} />
            {label}
            {active && (
              <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-sm shadow-primary/30" />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
