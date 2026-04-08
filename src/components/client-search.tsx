"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Search } from "lucide-react"
import { cn } from "@/lib/utils"

type ClientResult = {
  monday_item_id: string
  name: string
  monday_board_type: "onboarding" | "current"
}

export function ClientSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [clients, setClients] = useState<ClientResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch client list once on first open
  const fetchClients = useCallback(async () => {
    if (clients.length > 0) return
    setLoading(true)
    try {
      const res = await fetch("/api/clients/search")
      if (res.ok) {
        const data = await res.json()
        setClients(data)
      }
    } finally {
      setLoading(false)
    }
  }, [clients.length])

  // Cmd+K shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => {
          if (!prev) fetchClients()
          return !prev
        })
      }
      if (e.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [fetchClients])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery("")
      setSelectedIndex(0)
    }
  }, [open])

  // Close on click outside
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

  const filtered = query.trim()
    ? clients.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : clients

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  function navigate(client: ClientResult) {
    setOpen(false)
    router.push(`/clients/${client.monday_item_id}`)
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
      {/* Trigger button */}
      <button
        onClick={() => {
          setOpen(true)
          fetchClients()
        }}
        className="flex items-center gap-2 h-8 w-64 rounded-lg border border-border/40 bg-muted/30 px-3 text-sm text-muted-foreground hover:bg-muted/50 hover:border-border/60 transition-colors"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search clients...</span>
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/50 bg-muted/50 px-1.5 text-[10px] font-medium text-muted-foreground/70">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 rounded-xl border border-border/40 bg-popover shadow-xl z-50 overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-border/30 px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Type a client name..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          {/* Results */}
          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">Loading clients...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">No clients found</div>
            ) : (
              filtered.map((client, i) => (
                <button
                  key={client.monday_item_id}
                  onClick={() => navigate(client)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    "flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors",
                    i === selectedIndex ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"
                  )}
                >
                  <span className="truncate">{client.name}</span>
                  <span className="text-[10px] text-muted-foreground/60 shrink-0 ml-2">
                    {client.monday_board_type === "onboarding" ? "Onboarding" : "Active"}
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
