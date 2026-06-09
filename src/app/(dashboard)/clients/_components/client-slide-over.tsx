"use client"

import { startTransition, useEffect, useMemo, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowLeft, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ClientHeader } from "@/app/(dashboard)/clients/[id]/_components/client-header"
import { ClientTabs } from "@/app/(dashboard)/clients/[id]/_components/client-tabs"
import { ClientQuickAdd } from "@/app/(dashboard)/clients/_components/client-quick-add"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { DictionaryKey } from "@/lib/i18n/dictionary"
import type { MondayClient } from "@/lib/integrations/monday"
import type { ClientAccess } from "@/lib/clients/access"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"
import { mondayStatusToHub } from "@/lib/clients/status"
import { cn } from "@/lib/utils"

/**
 * Derive the contextual "Back to..." label key from the underlying pathname.
 * The slide-over renders on top of /clients, /watchlist (and elsewhere); the
 * label needs to match where the user came from so closing reads as natural
 * navigation rather than a generic "Close".
 */
function backLabelKeyForPath(pathname: string | null): DictionaryKey {
  if (pathname?.startsWith("/watchlist")) return "client.back.to_watchlist"
  if (pathname?.startsWith("/clients")) return "client.back.to_clients"
  return "client.back.generic"
}

type ClientDetailResponse = {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
  /** Hub-only billing fields — no Monday column behind them. Optional
   *  because cached placeholder responses (from the boards list) don't
   *  have them; the network refetch fills them in. */
  hubBilling?: {
    nextAdBudgetInvoiceDate: string | null
  }
}

type Props = {
  /** Monday item ID of the client to show. Null/undefined = panel closed. */
  clientId: string | null
  onClose: () => void
  currentUser: CurrentUser
  /** Client object already cached by the parent (clients overview or
   *  Watch List) — pulled from the same boards-list that drives the
   *  row the user just clicked. When provided, the slide-over uses it
   *  as React Query placeholder data so the panel renders instantly
   *  (with permissive access flags + empty supabaseClientId) while the
   *  network call refines those two fields in the background.
   *
   *  Without this prop the panel waits for the Monday fetch (~500-
   *  2000ms) before showing anything — that's the "traag" complaint
   *  Roy filed on 2026-05-18. */
  clientPreview?: MondayClient | null
  /** Full clients list for the in-panel quick-switch search. When provided
   *  together with `onSelectClient`, a search box floats in the dimmed
   *  backdrop strip so the user can jump from client A to client B without
   *  closing the panel + scrolling the table. */
  allClients?: MondayClient[]
  onSelectClient?: (mondayItemId: string) => void
}

// Permissive defaults used while the real access query is still in
// flight. Matches the experience an admin would have — anything more
// restrictive risks hiding tabs the user actually has access to and
// then flashing them in 500ms later. The real values overwrite this
// as soon as the network response lands.
const OPTIMISTIC_ACCESS: ClientAccess = {
  canViewCampaigns: true,
  canViewBilling: true,
  canViewCommunication: true,
}

export function ClientSlideOver({ clientId, onClose, currentUser, clientPreview, allClients, onSelectClient }: Props) {
  const pathname = usePathname()
  const locale = useLocale()
  const backLabel = t(backLabelKeyForPath(pathname), locale)

  // Optimistic + deferred close. `onClose` runs `router.replace` in the
  // parent to clear the `?client=` param; on the watchlist (1.6k LOC,
  // 44 hooks) and clients overview, that re-evaluates `useSearchParams`
  // and triggers a full parent re-render — 100-500ms of main-thread
  // work. That re-render competes with the 120ms close animation, so
  // the slide-over felt frozen and the page underneath felt sluggish
  // even though it was already mounted and didn't need new data.
  //
  // Two parts to the fix:
  //   1. Flip a local `userClosed` flag the instant the user clicks so
  //      the panel starts animating out regardless of what the parent
  //      is doing. Reset whenever `clientId` changes so reopening
  //      (deep link / quick-switch) goes through the open animation
  //      cleanly.
  //   2. Run the parent's URL update inside `startTransition` so React
  //      treats it as low-priority. The close animation gets the main
  //      thread on its own; the URL + parent re-render happens after,
  //      where the user can no longer feel it.
  const [userClosed, setUserClosed] = useState(false)
  useEffect(() => {
    setUserClosed(false)
  }, [clientId])
  const open = !!clientId && !userClosed
  const handleClose = () => {
    setUserClosed(true)
    startTransition(() => onClose())
  }

  const detailQuery = useQuery<ClientDetailResponse>({
    queryKey: ["client-detail", clientId],
    queryFn: () => fetch(`/api/clients/${clientId}`).then((r) => r.json()),
    enabled: !!clientId,
    staleTime: 60 * 1000,
    // Placeholder data renders the panel immediately with whatever the
    // parent already had cached. Once the fetch resolves the data is
    // replaced — `isPlaceholderData` lets the UI tell the two apart if
    // we want to differentiate (currently we don't, it just works).
    placeholderData:
      clientPreview && clientId === clientPreview.mondayItemId
        ? {
            client: clientPreview,
            supabaseClientId: "",
            access: OPTIMISTIC_ACCESS,
          }
        : undefined,
  })

  // Keyboard shortcuts: Esc closes (already handled by base-ui via Dialog,
  // but we listen here too so the URL `?client=` param clears). ArrowLeft
  // also closes — Roy wants "press ← to go back" as a muscle-memory shortcut.
  // We skip ArrowLeft when the user is typing into an input/textarea so it
  // doesn't hijack normal text-cursor navigation inside the switcher search,
  // task composer, etc.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return
      if (e.key === "Escape") {
        handleClose()
        return
      }
      if (e.key === "ArrowLeft") {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        const isEditable =
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target?.isContentEditable === true
        if (isEditable) return
        handleClose()
      }
    }
    if (open) window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) handleClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          onClick={handleClose}
          className={cn(
            "fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm",
            // Click-to-dismiss + a clear cursor + a subtle hover-darken so the
            // dim strip on the left reads as interactive instead of dead space.
            // The hover delta is small on purpose — strong enough to notice on
            // mouse-over but not so loud it competes with the panel content.
            "cursor-pointer transition-colors hover:bg-black/55",
            // Backdrop fades faster than the panel slides — feels snappier and the
            // panel reads as the leading element of the transition.
            "duration-100 ease-out",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        {/* Floating nav header — sits in the dimmed backdrop strip on the
            left of the panel. Always shows a prominent Back button (Roy
            asked for a "big, clearly clickable" affordance); the search
            below it appears whenever the parent passes the client list +
            selection handler so the user can hop to another client without
            closing the panel. */}
        <SlideOverNavHeader
          backLabel={backLabel}
          onBack={handleClose}
          clients={allClients}
          currentId={clientId}
          onSelectClient={onSelectClient}
        />
        <DialogPrimitive.Popup
          className={cn(
            "fixed inset-y-0 right-0 z-50 w-full lg:w-[70%] max-w-[1500px]",
            "bg-background shadow-2xl ring-1 ring-foreground/10 outline-none",
            "flex flex-col",
            // 120ms with ease-out matches Linear/Discord feel — fast enough to
            // feel instant on click but long enough that the slide motion still
            // reads as deliberate.
            "duration-[120ms] ease-out",
            "data-open:animate-in data-open:slide-in-from-right",
            "data-closed:animate-out data-closed:slide-out-to-right",
          )}
        >
          {/* Close button — canonical: Button ghost size=icon-sm + lucide X. */}
          <DialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 z-10 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              />
            }
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>

          {/* Hidden title for accessibility — base-ui requires one */}
          <DialogPrimitive.Title className="sr-only">
            Client details
          </DialogPrimitive.Title>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailQuery.isLoading && <SlideOverLoading />}
            {detailQuery.isError && (
              <div className="text-sm text-destructive">
                Failed to load client. {detailQuery.error instanceof Error ? detailQuery.error.message : ""}
              </div>
            )}
            {detailQuery.data && (
              <SlideOverContent
                client={detailQuery.data.client}
                supabaseClientId={detailQuery.data.supabaseClientId}
                access={detailQuery.data.access}
                hubBilling={detailQuery.data.hubBilling ?? null}
                currentUser={currentUser}
              />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SlideOverLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-10 w-80" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  )
}

function SlideOverContent({
  client,
  supabaseClientId,
  access,
  hubBilling,
  currentUser,
}: {
  client: MondayClient
  supabaseClientId: string
  access: ClientAccess
  hubBilling: NonNullable<ClientDetailResponse["hubBilling"]> | null
  currentUser: CurrentUser
}) {
  return (
    <>
      <ClientHeader client={client} canViewBilling={access.canViewBilling} />
      <div className="mt-4">
        {/* Quick-add bar — Monday-parity compose, sits above the tabs so
            it's reachable from every view. Roy 2026-06-09. */}
        <ClientQuickAdd
          mondayItemId={client.mondayItemId}
          clientName={client.companyName || client.name}
          currentUser={{ id: currentUser.id, name: currentUser.name }}
        />
        <div className="mt-4">
          <ClientTabs
            client={client}
            supabaseClientId={supabaseClientId}
            access={access}
            hubBilling={hubBilling}
            currentUser={currentUser}
          />
        </div>
      </div>
    </>
  )
}

/**
 * Floating navigation header for the slide-over. Renders a prominent "Back
 * to [origin]" button on top + (optionally) a quick-switch client search
 * underneath. Sits in the dimmed backdrop strip to the left of the panel so
 * it's always reachable without overlapping the client content.
 *
 * The Back button is the primary affordance — Roy explicitly wanted a "big,
 * clearly clickable" return path. The search is secondary: a power-user
 * shortcut to swap clients without leaving the slide-over.
 */
function SlideOverNavHeader({
  backLabel,
  onBack,
  clients,
  currentId,
  onSelectClient,
}: {
  backLabel: string
  onBack: () => void
  clients: MondayClient[] | undefined
  currentId: string | null
  onSelectClient: ((id: string) => void) | undefined
}) {
  const hasSwitcher = clients && onSelectClient && clients.length > 1

  return (
    // Floating container — `pointer-events-none` lets the backdrop receive
    // clicks (click-to-close still works) while the inner panel re-enables
    // its own events. `stopPropagation` on every interactive child prevents
    // bubble-up to the backdrop.
    <div
      className="pointer-events-none fixed inset-y-0 left-0 right-[max(70%,calc(100vw-1500px))] z-[60] flex items-center justify-center px-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-auto w-full max-w-[420px] flex flex-col gap-2.5">
        {/* Back button — full-width within the floating panel, centered text,
            ArrowLeft icon so the affordance reads visually before the label. */}
        <button
          type="button"
          onClick={onBack}
          className={cn(
            "group/back inline-flex items-center justify-center gap-2 h-11 rounded-xl",
            "border border-emerald-400/40 bg-emerald-500/95 backdrop-blur-md text-white",
            "shadow-2xl ring-1 ring-emerald-900/30",
            "transition-all hover:bg-emerald-500 hover:border-emerald-300/60 active:translate-y-px",
            "outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60",
          )}
          aria-label={backLabel}
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover/back:-translate-x-0.5" />
          <span className="text-sm font-medium">{backLabel}</span>
        </button>

        {/* Switcher — only rendered when the parent supplies a client list
            + selection callback (clients overview + watchlist do; raw
            deep-link contexts may not). */}
        {hasSwitcher && (
          <ClientSwitcher
            clients={clients!}
            currentId={currentId}
            onSelect={(id) => {
              if (id !== currentId) onSelectClient!(id)
            }}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Quick-switch search bar that floats in the dimmed backdrop strip on the
 * left of the slide-over panel. Lets the user jump from client A to client B
 * without closing the panel, scrolling the table, and reopening — the URL is
 * just rewritten in place and the panel content swaps. Cmd+K (Ctrl+K on
 * non-Mac) focuses the input from anywhere while the panel is open.
 *
 * Filtering is case-insensitive across `name`, `companyName`, `accountManager`,
 * and `campaignManager` so the AM can find a client by their own name too.
 * Results are capped at 8 to keep the dropdown calm.
 */
function ClientSwitcher({
  clients,
  currentId,
  onSelect,
}: {
  clients: MondayClient[]
  currentId: string | null
  onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Cmd/Ctrl+K focuses the search from anywhere while the panel is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Default preview (empty query) is live-only — onboarding/on-hold/churned
  // clients aren't ones a CM/AM wants to *passively* switch to. But once the
  // user actively types a query, search spans the full list so they can still
  // jump to that one on-hold client by name without leaving the panel.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      return clients
        .filter((c) => c.mondayItemId !== currentId && mondayStatusToHub(c.campaignStatus, "current") === "live")
        .slice(0, 8)
    }
    const hits: MondayClient[] = []
    for (const c of clients) {
      if (c.mondayItemId === currentId) continue
      const hay = `${c.name} ${c.companyName ?? ""} ${c.accountManager ?? ""} ${c.campaignManager ?? ""}`.toLowerCase()
      if (hay.includes(q)) {
        hits.push(c)
        if (hits.length >= 8) break
      }
    }
    return hits
  }, [clients, query, currentId])

  // Reset the highlight when the result set changes shape.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  function pick(idx: number) {
    const c = filtered[idx]
    if (!c) return
    onSelect(c.mondayItemId)
    setQuery("")
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      pick(activeIdx)
    }
  }

  const locale = useLocale()

  return (
    // Inner panel only — the outer floating wrapper lives on
    // `SlideOverNavHeader` so the Back button + this switcher share one
    // visual frame.
    <div
      className="rounded-xl border border-white/10 bg-zinc-900/80 backdrop-blur-md shadow-2xl ring-1 ring-black/20"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <Search className="h-4 w-4 text-zinc-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("client.switch.placeholder", locale)}
          className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          aria-label={t("client.switch.placeholder", locale)}
        />
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          ⌘K
        </kbd>
      </div>
      {filtered.length > 0 && (
        <ul className="max-h-[360px] overflow-y-auto py-1">
          {filtered.map((c, idx) => {
            const isActive = idx === activeIdx
            return (
              <li key={c.mondayItemId}>
                <button
                  type="button"
                  onClick={() => pick(idx)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={cn(
                    "w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors",
                    isActive ? "bg-white/10 text-white" : "text-zinc-200 hover:bg-white/5",
                  )}
                >
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.accountManager && (
                    <span className="shrink-0 text-[11px] text-zinc-500 truncate max-w-[40%]">
                      {c.accountManager}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {query.trim() && filtered.length === 0 && (
        <p className="px-3 py-3 text-xs text-zinc-500">{t("client.switch.empty", locale)}</p>
      )}
    </div>
  )
}
