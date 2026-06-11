"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ClientSlideOver } from "@/app/(dashboard)/clients/_components/client-slide-over"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"

/**
 * Global mount for the client slide-over so opening a client from the
 * top-bar search no longer drags the user to `/clients`. Roy 2026-06-10:
 * "ik wil dat, als ik een klant open, deze me opent op het huidige tabblad" -
 * if you're on /pedro and search → open client X, the panel lays over Pedro
 * and closing returns to Pedro, not /clients.
 *
 * Renders the slide-over whenever `?client=<id>` is present in the URL.
 * `onClose` strips the param while keeping the pathname intact so the
 * underlying page stays put.
 *
 * Pages that mount their OWN slide-over (today: /clients and /watchlist -
 * they pass `allClients` so the in-panel quick-switch search works) are
 * skipped here to avoid a double-mount. Listed via prefix so nested
 * routes like /clients/[id]/something inherit the skip if those ever
 * surface a panel themselves.
 */
const PATHS_WITH_LOCAL_SLIDE_OVER = ["/clients", "/watchlist"]

type Props = {
  /** The signed-in user. Null when there's no session - we just don't
   *  render in that case; the search trigger is gated by auth upstream
   *  so realistically this is non-null whenever the slide-over could
   *  actually be opened. */
  currentUser: CurrentUser | null
}

export function GlobalClientSlideOver({ currentUser }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedClientId = searchParams.get("client")

  const handleClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("client")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname ?? "/", { scroll: false })
  }, [router, pathname, searchParams])

  const hasLocalMount = PATHS_WITH_LOCAL_SLIDE_OVER.some((p) =>
    pathname?.startsWith(p),
  )
  if (hasLocalMount) return null
  if (!currentUser) return null

  return (
    <ClientSlideOver
      clientId={selectedClientId}
      onClose={handleClose}
      currentUser={currentUser}
    />
  )
}
