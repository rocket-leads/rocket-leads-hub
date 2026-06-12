"use client"

import { useEffect, useState } from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "sidebar-collapsed"

/**
 * Toggles the sidebar between expanded (240px) and collapsed (64px).
 * Persists the choice in localStorage so the next page load opens the
 * sidebar in the same state.
 *
 * Mechanism: writes `data-sidebar-collapsed="1"` to <html> when
 * collapsed. globals.css picks that up to flip the `--sidebar-w` CSS
 * variable that <aside> and <main> bind their widths to, plus to
 * hide every `.sidebar-label` so labels don't overflow in 64px.
 *
 * No SSR flash: on first mount the effect reads localStorage and
 * applies the attribute before the first paint of any animation-
 * sensitive content. Initial render uses the "expanded" default so
 * SSR + the first client paint agree; we only animate the rare
 * "user prefers collapsed" case once their preference loads.
 */
export function SidebarCollapseToggle() {
  const [collapsed, setCollapsed] = useState(false)

  // First-mount: pull persisted choice + apply to <html>.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored === "1") {
        setCollapsed(true)
        document.documentElement.dataset.sidebarCollapsed = "1"
      }
    } catch {
      // Silent — localStorage unavailable (privacy mode) just means we
      // always start expanded.
    }
  }, [])

  // Sync attribute + persistence whenever the state flips.
  useEffect(() => {
    if (collapsed) {
      document.documentElement.dataset.sidebarCollapsed = "1"
    } else {
      delete document.documentElement.dataset.sidebarCollapsed
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0")
    } catch {
      // Silent.
    }
  }, [collapsed])

  return (
    <button
      type="button"
      onClick={() => setCollapsed((v) => !v)}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 bg-card",
        "text-muted-foreground hover:text-foreground hover:bg-muted/60",
        "transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]",
      )}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  )
}
