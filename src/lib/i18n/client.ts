"use client"

import { useEffect, useState } from "react"
import { DEFAULT_LOCALE, isLocale, type Locale } from "./types"

/**
 * Client-side locale resolution. Reads the `locale` cookie set by the
 * sidebar toggle. Returns DEFAULT_LOCALE during SSR/first-paint to avoid
 * hydration mismatches — the real locale arrives on the next render
 * tick once `useEffect` has run.
 *
 * Server components should use `getUserLocale` from `./server` instead;
 * this hook exists for client-only surfaces (slide-overs, modals,
 * inbox composer) where prop-drilling locale through the tree is more
 * trouble than it's worth.
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    if (typeof document === "undefined") return
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/)
    if (!match) return
    const value = decodeURIComponent(match[1])
    if (isLocale(value) && value !== locale) setLocale(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return locale
}
