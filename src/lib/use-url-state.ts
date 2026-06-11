"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

/**
 * Bookmarkable component state synced to a single URL query param. Use
 * this anywhere the user can "send me this exact view" - Watch List
 * filters, Targets date range, Inbox search, slide-over tabs.
 *
 * Drop-in replacement for `useState` where the state matters past a
 * page reload. Updates push history (so the back button works) and
 * are batched into a shallow router replace so React Query caches
 * don't re-fetch unnecessarily.
 *
 * Usage:
 *   const [tab, setTab] = useUrlState("tab", "overview")
 *   const [search, setSearch] = useUrlState("q", "")
 *
 * Notes:
 *   - Only string values. For numbers/booleans, encode on write and
 *     decode on read at the call site (keeps the hook tiny).
 *   - Setting the value to the default clears the param from the URL
 *     so links stay clean (`?tab=overview` becomes `/settings`).
 *   - Multiple call sites on the same page can update different params
 *     without clobbering each other - every set reads the current
 *     URLSearchParams snapshot before mutating.
 */
export function useUrlState(
  key: string,
  defaultValue: string,
): [string, (next: string) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (next === defaultValue || next === "") {
        params.delete(key)
      } else {
        params.set(key, next)
      }
      const qs = params.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [key, defaultValue, pathname, router, searchParams],
  )

  return useMemo(() => [value, setValue], [value, setValue])
}
