"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"

export function BackButton() {
  const [target, setTarget] = useState<{ href: string; label: string }>({
    href: "/clients",
    label: "Back to Clients",
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const ref = document.referrer
      if (ref) {
        const url = new URL(ref)
        if (url.origin === window.location.origin) {
          if (url.pathname.startsWith("/watchlist")) {
            setTarget({ href: "/watchlist", label: "Back to Watch List" })
            return
          }
          if (url.pathname.startsWith("/targets")) {
            setTarget({ href: "/targets", label: "Back to Targets" })
            return
          }
        }
      }
    } catch {
      // ignore
    }
  }, [])

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
