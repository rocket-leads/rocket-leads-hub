"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"

const SOURCES: Record<string, { href: string; label: string }> = {
  watchlist: { href: "/watchlist", label: "Back to Watch List" },
  targets: { href: "/targets", label: "Back to Targets" },
  clients: { href: "/clients", label: "Back to Clients" },
}

export function BackButton() {
  const searchParams = useSearchParams()
  const fromParam = searchParams.get("from")

  const [target, setTarget] = useState<{ href: string; label: string }>(
    fromParam && SOURCES[fromParam] ? SOURCES[fromParam] : SOURCES.clients
  )

  useEffect(() => {
    // Query param takes priority (works for client-side navigation)
    if (fromParam && SOURCES[fromParam]) {
      setTarget(SOURCES[fromParam])
      return
    }

    // Fall back to document.referrer (works for hard navigations)
    if (typeof window === "undefined") return
    try {
      const ref = document.referrer
      if (ref) {
        const url = new URL(ref)
        if (url.origin === window.location.origin) {
          if (url.pathname.startsWith("/watchlist")) {
            setTarget(SOURCES.watchlist)
            return
          }
          if (url.pathname.startsWith("/targets")) {
            setTarget(SOURCES.targets)
            return
          }
        }
      }
    } catch {
      // ignore
    }
  }, [fromParam])

  return (
    <Link
      href={target.href}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
    >
      <ArrowLeft className="h-3 w-3" />
      {target.label}
    </Link>
  )
}
