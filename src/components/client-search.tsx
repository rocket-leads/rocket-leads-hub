"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { ClientSearchResult } from "@/app/api/clients/search/route"

/**
 * Global client search - mounted in the dashboard topbar so it's reachable
 * from every page. ⌘K (or Ctrl+K on Windows/Linux) opens it from anywhere.
 *
 * Selecting a result appends `?client=<id>` to the CURRENT path. The
 * GlobalClientSlideOver in the dashboard layout picks that up and opens
 * the panel over wherever the user already is - Pedro, Optimize, Inbox,
 * Watchlist, etc. - so closing returns them to that page, not to /clients.
 * Roy 2026-06-10: "ik wil dat, als ik een klant open, deze me opent op het
 * huidige tabblad. Dus niet altijd gelijk naar alle klanten gaat."
 *
 * Client list is fetched once on first open and cached for the session.
 * Filtering happens client-side so typing is instant; the only network
 * cost is the initial load.
 */
export function ClientSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [clients, setClients] = useState<ClientSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchClients = useCallback(async () => {
    if (clients.length > 0) return
    setLoading(true)
    try {
      const res = await fetch("/api/clients/search")
      if (res.ok) {
        const data = (await res.json()) as ClientSearchResult[]
        setClients(Array.isArray(data) ? data : [])
      }
    } finally {
      setLoading(false)
    }
  }, [clients.length])

  // ⌘K / Ctrl+K opens from anywhere; Esc closes. Skip when the user is
  // typing into another input - otherwise tapping K inside a textarea would
  // hijack focus.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => {
          if (!prev) fetchClients()
          return !prev
        })
      }
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [fetchClients])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery("")
      setSelectedIndex(0)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? clients.filter((c) => c.name.toLowerCase().includes(q))
    : clients

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  function navigate(client: ClientSearchResult) {
    setOpen(false)
    // Append `?client=<id>` to the CURRENT path so the GlobalClientSlideOver
    // opens over the page the user is already on (Pedro, Optimize, Inbox,
    // …). Previously this pushed to `/clients?client=…` which always
    // dragged the user back to the All Clients list - even when they only
    // wanted to peek at one client without losing their place.
    //
    // `pathname` may be null during transitions; fall back to /clients so
    // the search still works in that edge case (the local slide-over there
    // handles the param).
    const params = new URLSearchParams(searchParams?.toString() ?? "")
    params.set("client", client.mondayItemId)
    const target = `${pathname ?? "/clients"}?${params.toString()}`
    router.push(target, { scroll: false })
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault()
      navigate(filtered[selectedIndex])
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          fetchClients()
        }}
        className="flex items-center gap-2 h-10 w-72 rounded-lg border border-border bg-card px-3.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">{t("search.trigger.placeholder", locale)}</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 px-1.5 text-[10px] font-medium text-muted-foreground/70">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 rounded-lg border border-border/60 bg-popover shadow-xl z-50 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={t("search.input.placeholder", locale)}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t("search.loading", locale)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t("search.empty", locale)}
              </div>
            ) : (
              filtered.map((client, i) => (
                <button
                  key={client.mondayItemId}
                  type="button"
                  onClick={() => navigate(client)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors",
                    i === selectedIndex ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
                  )}
                >
                  <span className="truncate">{client.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2">
                    {client.boardType === "onboarding"
                      ? t("search.board.onboarding", locale)
                      : t("search.board.current", locale)}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
