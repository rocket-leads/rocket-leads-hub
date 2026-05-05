"use client"

import { useEffect, useState } from "react"
import { Moon, Sun } from "lucide-react"

type Theme = "light" | "dark"

function readTheme(): Theme {
  if (typeof document === "undefined") return "light"
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

/**
 * Stores the choice as a cookie so RootLayout can read it server-side and
 * paint the `dark` class into the initial HTML — no flash, no client script.
 * 1-year expiry so the preference survives normal sessions.
 */
function writeThemeCookie(theme: Theme) {
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `theme=${theme}; path=/; max-age=${oneYear}; samesite=lax`
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setTheme(readTheme())
    setMounted(true)
  }, [])

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    document.documentElement.classList.toggle("dark", next === "dark")
    writeThemeCookie(next)
  }

  const isDark = theme === "dark"
  const Icon = isDark ? Sun : Moon
  const label = isDark ? "Light mode" : "Dark mode"

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      suppressHydrationWarning
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-all"
    >
      <Icon className="h-3.5 w-3.5" />
      {mounted ? label : "Theme"}
    </button>
  )
}
