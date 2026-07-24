"use client"

import { usePathname } from "next/navigation"

// 187N topbar breadcrumb: mono uppercase "ROCKET LEADS / <here>". The current
// section is derived from the path so it stays in sync with the sidebar
// without threading props through every page.
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

// Targets split into three dashboards + a settings editor - show the specific
// one rather than the generic "Targets".
const TARGETS_SUB: Record<string, string> = {
  marketing: "Marketing / Sales",
  delivery: "Delivery",
  finance: "Finance",
  settings: "Target Settings",
}

export function TopbarBreadcrumb() {
  const pathname = usePathname()
  const parts = pathname.split("/").filter(Boolean)
  const seg = parts[0] ?? "home"
  let here = LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1)
  if (seg === "targets" && parts[1] && TARGETS_SUB[parts[1]]) {
    here = TARGETS_SUB[parts[1]]
  }
  return (
    <div className="breadcrumb">
      <span>Rocket Leads</span>
      <span className="sep">/</span>
      <span className="here">{here}</span>
    </div>
  )
}
