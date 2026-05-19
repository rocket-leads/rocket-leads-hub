"use client"

import { useEffect, useState } from "react"
import { DEFAULT_LOCALE, isLocale, type Locale } from "./types"

/** Custom event name fired by `LocaleToggle` whenever the user picks a new
 *  locale. `useLocale()` subscribes to this so already-mounted client
 *  components re-render synchronously when the toggle is pressed — without
 *  this they keep their initial useState value forever (cookie reads only
 *  happened on mount), which is why kolomheaders en filterlabels op de
 *  Clients page bevroor tot een hard refresh.
 *
 *  Exported so the toggle (and any other code that mutates the cookie) can
 *  broadcast the change. */
export const LOCALE_CHANGE_EVENT = "rl-locale-change"

function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/)
  if (!match) return null
  const value = decodeURIComponent(match[1])
  return isLocale(value) ? value : null
}

/**
 * Client-side locale resolution. Reads the `locale` cookie set by the
 * sidebar toggle. Returns DEFAULT_LOCALE during SSR/first-paint to avoid
 * hydration mismatches — the real locale arrives on the next render
 * tick once `useEffect` has run.
 *
 * Reactive: subscribes to the LOCALE_CHANGE_EVENT broadcast by the toggle
 * so any client component using this hook re-renders the moment the user
 * flips the language, without needing a route refresh or remount.
 *
 * Server components should use `getUserLocale` from `./server` instead;
 * this hook exists for client-only surfaces (slide-overs, modals,
 * inbox composer) where prop-drilling locale through the tree is more
 * trouble than it's worth.
 */
export function useLocale(): Locale {
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE)

  useEffect(() => {
    // Initial hydration from cookie — covers SSR mismatch + cross-tab
    // changes that happened before this component mounted.
    const initial = readLocaleCookie()
    if (initial && initial !== locale) setLocale(initial)

    // Same-tab live updates: the toggle fires this when it cycles the
    // locale. `setLocale` here triggers a re-render of every component
    // currently using `useLocale()`.
    function onLocaleChange(e: Event) {
      const detail = (e as CustomEvent<Locale>).detail
      if (isLocale(detail)) setLocale(detail)
      else {
        // Fallback: re-read cookie if the event didn't carry a detail.
        const next = readLocaleCookie()
        if (next) setLocale(next)
      }
    }
    document.addEventListener(LOCALE_CHANGE_EVENT, onLocaleChange)

    // Cross-tab sync via the storage event — when the user toggles in
    // tab A, the cookie is updated but the storage event lets tab B
    // notice. We can't directly observe cookie changes; localStorage is
    // the cheapest proxy. The toggle writes a throwaway marker so this
    // hook can pick up the cookie's new value.
    function onStorage(e: StorageEvent) {
      if (e.key !== "rl-locale-marker") return
      const next = readLocaleCookie()
      if (next) setLocale(next)
    }
    window.addEventListener("storage", onStorage)

    return () => {
      document.removeEventListener(LOCALE_CHANGE_EVENT, onLocaleChange)
      window.removeEventListener("storage", onStorage)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return locale
}
