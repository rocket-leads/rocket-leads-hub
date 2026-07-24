"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  Search,
  Users,
  CheckSquare,
  MessageSquare,
  Home,
  Eye,
  Inbox,
  ClipboardCheck,
  TrendingUp,
  Calendar,
  CreditCard,
  BarChart3,
  Truck,
  Banknote,
  Settings,
  Sparkles,
  Plus,
  type LucideIcon,
} from "lucide-react"
import type { GlobalSearchResults } from "@/app/api/search/route"

// Static nav destinations for the PAGES group - pure client-side, filtered by
// query. Auth is enforced by the proxy on navigation, so listing all is safe.
const PAGES: { href: string; label: string; sub: string; icon: LucideIcon }[] = [
  { href: "/home", label: "Home", sub: "Today overview", icon: Home },
  { href: "/watchlist", label: "Watch List", sub: "Client health triage", icon: Eye },
  { href: "/inbox", label: "Inbox", sub: "Tasks · updates · chats", icon: Inbox },
  { href: "/clients", label: "Clients", sub: "All clients", icon: Users },
  { href: "/onboarding", label: "Onboarding", sub: "New-client wizard", icon: ClipboardCheck },
  { href: "/optimize", label: "Optimize", sub: "Pedro proposals", icon: TrendingUp },
  { href: "/calendar", label: "Calendar", sub: "Schedule · recordings", icon: Calendar },
  { href: "/targets/marketing", label: "Marketing / Sales", sub: "Funnel · closers · targets", icon: BarChart3 },
  { href: "/targets/delivery", label: "Delivery", sub: "Revenue · retention · teams", icon: Truck },
  { href: "/targets/finance", label: "Finance", sub: "Invoiced · collected · ad budget", icon: Banknote },
  { href: "/billing", label: "Billing", sub: "Invoices · outstanding", icon: CreditCard },
  { href: "/settings", label: "Settings", sub: "Account · integrations", icon: Settings },
]

const EMPTY: GlobalSearchResults = { clients: [], tasks: [], messages: [] }

type FlatItem = {
  key: string
  type: "ACTION" | "CLIENT" | "TASK" | "MESSAGE" | "PAGE"
  icon: LucideIcon
  label: string
  sub: string | null
  run: () => void
}

/** Open the AI Co-pilot composer (optionally pre-filled) from anywhere. The
 *  Co-pilot lives on the same command surface now, so its button is gone and
 *  it opens via this event instead. */
function openCopilotComposer(prefill: string) {
  window.dispatchEvent(new CustomEvent("copilot:open", { detail: { prefill } }))
}

/**
 * Global command palette (⌘K) - one search across clients, tasks, messages,
 * and pages, styled to the 187N `.cmdk` trigger + `.cmd-overlay` palette. Data
 * is fetched once per session on first open and filtered client-side so typing
 * is instant. Selecting a client opens its slide-over over the current page;
 * tasks/messages jump to the Inbox; pages navigate directly.
 */
export function GlobalSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [data, setData] = useState<GlobalSearchResults>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const load = useCallback(async () => {
    if (loaded) return
    try {
      const res = await fetch("/api/search")
      if (res.ok) {
        const json = (await res.json()) as GlobalSearchResults
        setData({
          clients: json.clients ?? [],
          tasks: json.tasks ?? [],
          messages: json.messages ?? [],
        })
      }
    } finally {
      setLoaded(true)
    }
  }, [loaded])

  // ⌘K / Ctrl+K toggles from anywhere; Esc closes. Skip when the toggle would
  // fire mid-typing in another field.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => {
          if (!prev) load()
          return !prev
        })
      }
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [load])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery("")
      setSel(0)
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  const openClient = useCallback(
    (id: string) => {
      close()
      const params = new URLSearchParams(searchParams?.toString() ?? "")
      params.set("client", id)
      router.push(`${pathname ?? "/clients"}?${params.toString()}`, { scroll: false })
    },
    [close, pathname, router, searchParams],
  )

  const goto = useCallback(
    (href: string) => {
      close()
      router.push(href)
    },
    [close, router],
  )

  // Build the grouped, filtered result set + a flat list for keyboard nav.
  const { groups, flat } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(q)

    // ── Actions (AI Co-pilot) ──────────────────────────────────────────────
    // Typing a natural-language command surfaces "Ask AI Co-pilot" as the top
    // action - hitting it hands the query straight to the Co-pilot (create a
    // task, log an update, etc.). Plus a static "Create task" entry.
    const actionItems: FlatItem[] = []
    if (query.trim()) {
      actionItems.push({
        key: "act:ask",
        type: "ACTION",
        icon: Sparkles,
        label: "Ask AI Co-pilot",
        sub: `“${query.trim()}”`,
        run: () => {
          close()
          openCopilotComposer(query.trim())
        },
      })
    }
    if (!q || "create task".includes(q) || "task".includes(q)) {
      actionItems.push({
        key: "act:create-task",
        type: "ACTION",
        icon: Plus,
        label: "Create task",
        sub: "AI Co-pilot",
        run: () => {
          close()
          openCopilotComposer("")
        },
      })
    }

    const clientItems: FlatItem[] = (q ? data.clients.filter((c) => has(c.name)) : [])
      .slice(0, 6)
      .map((c) => ({
        key: `client:${c.id}`,
        type: "CLIENT" as const,
        icon: Users,
        label: c.name,
        sub: c.status ? c.status[0].toUpperCase() + c.status.slice(1) : null,
        run: () => openClient(c.id),
      }))

    const taskItems: FlatItem[] = (
      q ? data.tasks.filter((t) => has(t.title) || has(t.clientName)) : []
    )
      .slice(0, 6)
      .map((t) => ({
        key: `task:${t.id}`,
        type: "TASK" as const,
        icon: CheckSquare,
        label: t.title,
        sub: t.clientName,
        run: () => goto("/inbox"),
      }))

    const messageItems: FlatItem[] = (
      q
        ? data.messages.filter((m) => has(m.title) || has(m.clientName) || has(m.preview))
        : []
    )
      .slice(0, 6)
      .map((m) => ({
        key: `msg:${m.id}`,
        type: "MESSAGE" as const,
        icon: MessageSquare,
        label: m.title,
        sub: m.preview ?? m.clientName,
        run: () => goto("/inbox"),
      }))

    const pageItems: FlatItem[] = PAGES.filter(
      (p) => !q || p.label.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q),
    )
      .slice(0, q ? 6 : PAGES.length)
      .map((p) => ({
        key: `page:${p.href}`,
        type: "PAGE" as const,
        icon: p.icon,
        label: p.label,
        sub: p.sub,
        run: () => goto(p.href),
      }))

    const groups = [
      { label: "Actions", items: actionItems },
      { label: "Clients", items: clientItems },
      { label: "Tasks", items: taskItems },
      { label: "Messages", items: messageItems },
      { label: "Pages", items: pageItems },
    ].filter((g) => g.items.length > 0)

    const flat = groups.flatMap((g) => g.items)
    return { groups, flat }
  }, [query, data, openClient, goto, close])

  // Keep the selection in range as the result set changes, and scroll it in.
  useEffect(() => {
    setSel((s) => (s >= flat.length ? 0 : s))
  }, [flat.length])

  useEffect(() => {
    itemRefs.current[sel]?.scrollIntoView({ block: "nearest" })
  }, [sel])

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSel((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSel((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      flat[sel]?.run()
    }
  }

  let flatIdx = -1

  return (
    <>
      <button
        type="button"
        className="cmdk"
        aria-label="Search"
        onClick={() => {
          setOpen(true)
          load()
        }}
      >
        <Search />
        <span className="placeholder">Search clients, tasks, messages…</span>
        <span className="kbd">⌘K</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div className="cmd-overlay open" onMouseDown={close}>
          <div className="cmd-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="cmd-search">
              <Search />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search clients, tasks, messages — or ask the AI Co-pilot…"
              />
              <button type="button" className="esc" onClick={close}>
                ESC
              </button>
            </div>

            <div className="cmd-results">
              {flat.length === 0 ? (
                <div className="cmd-empty">
                  {query.trim() ? "No matches" : "Start typing to search clients, tasks and messages"}
                </div>
              ) : (
                groups.map((g) => (
                  <div key={g.label}>
                    <div className="cmd-group-label">{g.label}</div>
                    {g.items.map((it) => {
                      flatIdx += 1
                      const idx = flatIdx
                      const Icon = it.icon
                      return (
                        <div
                          key={it.key}
                          ref={(el) => {
                            itemRefs.current[idx] = el
                          }}
                          className={`cmd-item${idx === sel ? " sel" : ""}`}
                          onMouseEnter={() => setSel(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            it.run()
                          }}
                        >
                          <span className="ci-ic">
                            <Icon />
                          </span>
                          <div className="ci-main">
                            <div className="ci-label">{it.label}</div>
                            {it.sub && <div className="ci-sub">{it.sub}</div>}
                          </div>
                          <span className="ci-type">{it.type}</span>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="cmd-foot">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> navigate
              </span>
              <span>
                <kbd>↵</kbd> open
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
              <span style={{ marginLeft: "auto" }}>Rocket Leads · Growth Hub</span>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
