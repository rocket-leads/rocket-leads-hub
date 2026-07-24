"use client"

import { usePathname } from "next/navigation"

// 187N topbar breadcrumb: mono uppercase "ROCKET LEADS / <here>". The current
// section is derived from the first path segment so it stays in sync with the
// sidebar without threading props through every page.
const LABELS: Record<string, string> = {
  home: "Home",
  watchlist: "Watch List",
  inbox: "Inbox",
  clients: "Clients",
  onboarding: "Onboarding",
  optimize: "Optimize",
  calendar: "Calendar",
  billing: "Billing",
  targets: "Targets",
  settings: "Settings",
}

export function TopbarBreadcrumb() {
  const pathname = usePathname()
  const seg = pathname.split("/").filter(Boolean)[0] ?? "home"
  const here = LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1)
  return (
    <div className="breadcrumb">
      <span>Rocket Leads</span>
      <span className="sep">/</span>
      <span className="here">{here}</span>
    </div>
  )
}
