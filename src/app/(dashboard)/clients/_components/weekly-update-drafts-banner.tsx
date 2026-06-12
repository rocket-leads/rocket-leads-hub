"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Sparkles,
  Send,
  Loader2,
  Check,
  Mail,
  Search,
  SkipForward,
  RefreshCw,
  CalendarDays,
  X,
} from "lucide-react"
import { DismissButton } from "@/components/ui/dismiss-button"

/** Official WhatsApp brand glyph (speech bubble + phone). Lucide doesn't
 *  ship brand logos, so we inline it. Renders crisply at any size; pass
 *  text color via `currentColor` (parent's text-* class). */
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  )
}
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { WhatsAppPreview, EmailPreview } from "./client-update-button"
import type { EditableParts } from "@/lib/clients/client-update-template"
import { useWeeklyDraftAutosave } from "@/lib/clients/use-weekly-draft-autosave"
import type {
  WeeklyUpdateDraftListResponse,
  WeeklyUpdateDraftListItem,
} from "@/app/api/weekly-update-drafts/route"

/**
 * Monday-morning weekly-update queue surface - banner + split-pane sheet.
 *
 * Banner: compact button showing the pending count. Click to open the sheet.
 * Hidden when count is zero - we don't want persistent UI noise on a
 * Tuesday when the queue is empty.
 *
 * Sheet: full-width dialog with two panes:
 *   - LEFT (sidebar, ~300px): scrollable list of pending drafts. Each row
 *     shows the company name + contact first name + AM. Click swaps the
 *     right pane to that draft. The first draft is auto-selected on open
 *     so the AM lands directly in an editor instead of an extra click.
 *   - RIGHT (editor, flex-1): the existing inline composer (Extra Context
 *     card + WhatsApp/Email preview + footer + action buttons). Edits are
 *     held per-draft in a Map so switching between rows doesn't discard
 *     work in progress.
 *
 * Send / Dismiss live at the bottom of the right pane. On success we
 * remove the draft from the local list (optimistic) AND fire a refetch
 * so the global count stays in sync across tabs.
 */
/**
 * Compact top-bar chip variant of the weekly-update queue. Lives next to
 * the AI Co-pilot / Notification Bell / Search in the sticky dashboard
 * header so the affordance is always reachable - the big homepage banner
 * was removed 2026-06-11 to cut visual clutter. Hides itself when the
 * queue is empty so non-Monday days have zero chrome added.
 */
export function WeeklyUpdatesChip() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [sheetOpen, setSheetOpen] = useState(false)
  // When the Co-pilot's `prepare_client_update` executor finishes, it
  // navigates to `/?focusUpdate=<mondayItemId>` so this surface
  // auto-opens with the just-queued draft pre-selected. We consume the
  // param once + strip it so a back-button or page refresh doesn't
  // re-trigger the open.
  const focusUpdateParam = searchParams?.get("focusUpdate") ?? null
  const [focusMondayItemId, setFocusMondayItemId] = useState<string | null>(null)
  useEffect(() => {
    if (!focusUpdateParam) return
    setFocusMondayItemId(focusUpdateParam)
    setSheetOpen(true)
    // Strip the param so the chip doesn't re-open on every render.
    const next = new URLSearchParams(searchParams ?? undefined)
    next.delete("focusUpdate")
    const q = next.toString()
    router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false })
    // Force a refetch — the draft was just inserted server-side and the
    // 30s staleTime would otherwise leave the sheet rendering an empty
    // list for up to half a minute.
    void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUpdateParam])

  const draftsQuery = useQuery<WeeklyUpdateDraftListResponse>({
    queryKey: ["weekly-update-drafts"],
    queryFn: () => fetch("/api/weekly-update-drafts").then((r) => r.json()),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  const count = draftsQuery.data?.count ?? 0
  // Keep the chip visible while a deep-link is being resolved even when
  // the count is briefly stale at 0 — otherwise the sheet's parent
  // unmounts before the refetch lands and the focus is lost.
  if (count === 0 && !sheetOpen) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        title={`${count} wekelijkse update${count === 1 ? "" : "s"} te verzenden`}
        aria-label={`${count} wekelijkse updates te verzenden`}
        className="inline-flex items-center gap-1.5 h-10 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground hover:bg-muted/40 hover:text-foreground transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
      >
        {/* Calendar icon + neutral chrome (Roy 2026-06-11): Sparkles +
            violet read as "AI thing" alongside the AI Co-pilot bar.
            Calendar + neutral surfaces this as a scheduled deliverable;
            AI Co-pilot carries the brand purple instead.
            strokeWidth=1.5 thins the glyph so it visually matches the
            Bell + Search icons next to it (CalendarDays has more
            interior strokes than Bell, so it reads heavier at the
            default 2.0). */}
        <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="tabular-nums">{count}</span>
      </button>
      {sheetOpen && (
        <WeeklyUpdateQueueSheet
          open={sheetOpen}
          onOpenChange={(next) => {
            setSheetOpen(next)
            if (!next) setFocusMondayItemId(null)
          }}
          drafts={draftsQuery.data?.drafts ?? []}
          isRefreshing={draftsQuery.isFetching}
          focusMondayItemId={focusMondayItemId}
          onRefresh={() => {
            void draftsQuery.refetch()
          }}
          onDraftConsumed={() => {
            void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
            void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
          }}
        />
      )}
    </>
  )
}

export function WeeklyUpdateDraftsBanner() {
  const queryClient = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)

  const draftsQuery = useQuery<WeeklyUpdateDraftListResponse>({
    queryKey: ["weekly-update-drafts"],
    queryFn: () => fetch("/api/weekly-update-drafts").then((r) => r.json()),
    // Tighter freshness window: 30s instead of 5min so the queue picks up
    // the cron's upsert without a hard refresh. Also refetch when the tab
    // regains focus - AMs often Alt-Tab to Trengo to send something and
    // come back, and the queue should reflect what they just did.
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })

  const count = draftsQuery.data?.count ?? 0
  if (count === 0 && !draftsQuery.isPending) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="w-full flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/5 to-violet-500/[0.02] px-4 py-2.5 text-left hover:from-violet-500/10 hover:to-violet-500/5 hover:border-violet-500/50 transition-all"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {count} wekelijkse update{count === 1 ? "" : "s"} te verzenden
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Pre-gegenereerd op maandag - klik om te reviewen en versturen.
          </p>
        </div>
        <span className="text-[11px] text-violet-500 font-medium">Open queue →</span>
      </button>

      {sheetOpen && (
        <WeeklyUpdateQueueSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          drafts={draftsQuery.data?.drafts ?? []}
          isRefreshing={draftsQuery.isFetching}
          onRefresh={() => {
            void draftsQuery.refetch()
          }}
          onDraftConsumed={() => {
            void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
            void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
          }}
        />
      )}
    </>
  )
}

// ─── Split-pane queue sheet ─────────────────────────────────────────────

function WeeklyUpdateQueueSheet({
  open,
  onOpenChange,
  drafts,
  onDraftConsumed,
  onRefresh,
  isRefreshing,
  focusMondayItemId = null,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  drafts: WeeklyUpdateDraftListItem[]
  onDraftConsumed: () => void
  onRefresh: () => void
  isRefreshing: boolean
  /** When set, pre-select the draft whose mondayItemId matches this id
   *  as soon as it shows up in the list. Used by the AI Co-pilot's
   *  prepare_client_update deep-link. */
  focusMondayItemId?: string | null
}) {
  // User-clicked draft id. When null, the active draft is derived as the
  // first visible draft (auto-select on open + auto-advance after a send).
  // Storing the user pick separately keeps the derivation pure and avoids
  // a setState-in-effect cascade.
  const [userPickedId, setUserPickedId] = useState<string | null>(null)
  // Apply the focus deep-link once: when the matching draft lands in the
  // list (the freshly-queued draft may arrive on the next refetch tick),
  // set it as the user pick so the editor lands on it. Only fires once
  // per focus id so a user click after the auto-select still wins.
  const lastAppliedFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusMondayItemId) return
    if (lastAppliedFocusRef.current === focusMondayItemId) return
    const match = drafts.find((d) => d.mondayItemId === focusMondayItemId)
    if (match) {
      setUserPickedId(match.id)
      lastAppliedFocusRef.current = focusMondayItemId
    }
  }, [focusMondayItemId, drafts])
  // Free-text search over clientName / contactFirstName / accountManager.
  // 51-row sidebars are scroll-heavy; the AM almost always knows which
  // company they're looking for so a filter beats scrolling.
  const [search, setSearch] = useState("")
  // Per-draft edited parts so switching between rows keeps work in
  // progress. Initialised lazily from each draft's snapshotted parts
  // (already V2-shape from the cron).
  const [editedByDraft, setEditedByDraft] = useState<Record<string, EditableParts>>({})
  // Toast-style banner: "Verzonden naar <client> ✓" shown briefly after a
  // successful send so the AM can see what just went out even after the
  // editor auto-advanced to the next draft. `at` is the trigger time;
  // a useEffect clears the state ~4s later.
  const [recentlySent, setRecentlySent] = useState<{ name: string; at: number } | null>(null)
  useEffect(() => {
    if (!recentlySent) return
    const t = setTimeout(() => setRecentlySent(null), 4000)
    return () => clearTimeout(t)
  }, [recentlySent])
  // Track which drafts are gone (sent or dismissed) so they disappear
  // from the list immediately, even before the server refetch completes.
  const [consumedIds, setConsumedIds] = useState<Set<string>>(new Set())
  // Bulk selection - checkbox per row. Lets the AM tag multiple drafts
  // for "Overslaan in bulk" (mass dismiss) or "Versturen in bulk"
  // (sequential mass-send with a progress bar). Cleared whenever a
  // selected draft is consumed individually.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Bulk-send progress state. Null when idle. While running, holds the
  // total + done counters so the header strip can render a progress bar.
  const [bulkSend, setBulkSend] = useState<
    | null
    | { total: number; done: number; failed: number; lastError: string | null }
  >(null)
  // Bulk-skip in-flight flag - disables actions during the brief parallel
  // PATCH burst so the AM can't double-click "Overslaan" mid-flight.
  const [bulkSkipping, setBulkSkipping] = useState(false)

  const notConsumed = useMemo(
    () => drafts.filter((d) => !consumedIds.has(d.id)),
    [drafts, consumedIds],
  )

  const visibleDrafts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return notConsumed
    return notConsumed.filter(
      (d) =>
        d.clientName.toLowerCase().includes(q) ||
        d.contactFirstName.toLowerCase().includes(q) ||
        d.accountManager.toLowerCase().includes(q),
    )
  }, [notConsumed, search])

  // Derived active id: user pick if still visible, else first visible draft.
  // This collapses "auto-select first on open" and "auto-advance after send"
  // into one pure derivation - no useEffect race conditions.
  const activeId =
    userPickedId && visibleDrafts.some((d) => d.id === userPickedId)
      ? userPickedId
      : visibleDrafts[0]?.id ?? null

  const activeDraft = activeId ? drafts.find((d) => d.id === activeId) ?? null : null
  const activeParts = useMemo(() => {
    if (!activeDraft) return null
    if (editedByDraft[activeDraft.id]) return editedByDraft[activeDraft.id]
    // Cron now stores already-V2-shaped parts (composeInitialParts emits
    // V2 directly for WhatsApp), so no reshape is needed on the way in.
    return activeDraft.parts
  }, [activeDraft, editedByDraft])

  const setActiveParts = (next: EditableParts) => {
    if (!activeDraft) return
    setEditedByDraft((prev) => ({ ...prev, [activeDraft.id]: next }))
  }

  // Clean up selectedIds whenever drafts disappear (consumed individually
  // OR filtered out by search). Keeps the "X selected" counter honest.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const visibleSet = new Set(visibleDrafts.map((d) => d.id))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (visibleSet.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [visibleDrafts])

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelectedIds(new Set(visibleDrafts.map((d) => d.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  /** Bulk dismiss - fires the existing single-draft PATCH per selected id
   *  in parallel. Status flip is cheap, the risk is low, and parallel
   *  finishes faster than sequential for the typical 5-15 drafts. */
  async function bulkSkip() {
    if (selectedIds.size === 0 || bulkSkipping) return
    const ids = Array.from(selectedIds)
    setBulkSkipping(true)
    try {
      await Promise.all(
        ids.map((id) =>
          fetch(`/api/weekly-update-drafts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "dismissed" }),
          }).catch(() => null),
        ),
      )
      // Drop everything from the local view in one go.
      setConsumedIds((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      setSelectedIds(new Set())
      onDraftConsumed()
    } finally {
      setBulkSkipping(false)
    }
  }

  /** Bulk send - runs the same /send-client-update endpoint per draft in
   *  SEQUENCE (not parallel). Trengo's API rate-limits at ~10 req/s and
   *  we'd rather stagger than collide. Tracks per-draft progress so the
   *  header strip can show "Sending 4 of 12 …". On the first failure we
   *  surface the error inline but keep going - one bad client shouldn't
   *  block the rest. */
  async function bulkSendAll() {
    if (selectedIds.size === 0 || bulkSend !== null) return
    const idsToSend = Array.from(selectedIds)
    if (
      !window.confirm(
        `${idsToSend.length} wekelijkse update${idsToSend.length === 1 ? "" : "s"} versturen naar de klanten?`,
      )
    ) {
      return
    }
    setBulkSend({ total: idsToSend.length, done: 0, failed: 0, lastError: null })

    for (const id of idsToSend) {
      const draft = drafts.find((d) => d.id === id)
      if (!draft) {
        setBulkSend((s) => (s ? { ...s, done: s.done + 1, failed: s.failed + 1 } : s))
        continue
      }
      const parts = editedByDraft[id] ?? draft.parts
      const message = renderForSend(parts)
      try {
        const res = await fetch(
          `/api/clients/${draft.mondayItemId}/send-client-update`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, subject: parts.subject, parts }),
          },
        )
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string
            message?: string
          }
          throw new Error(err.message ?? err.error ?? "send failed")
        }
        const data = (await res.json()) as { outboundMsgId?: string }
        // Mark draft consumed (fire-and-forget like the single-send path).
        try {
          await fetch(`/api/weekly-update-drafts/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "sent",
              sentMessageId: data.outboundMsgId,
            }),
          })
        } catch {
          // intentional swallow
        }
        setConsumedIds((prev) => {
          const next = new Set(prev)
          next.add(id)
          return next
        })
        setBulkSend((s) => (s ? { ...s, done: s.done + 1 } : s))
      } catch (e) {
        setBulkSend((s) =>
          s
            ? {
                ...s,
                done: s.done + 1,
                failed: s.failed + 1,
                lastError: e instanceof Error ? e.message : "send failed",
              }
            : s,
        )
      }
    }

    setSelectedIds(new Set())
    onDraftConsumed()
    // Leave the progress strip visible for a few seconds with the final
    // tallies so the AM can see what happened, then fade out.
    setTimeout(() => setBulkSend(null), 4500)
  }

  const allVisibleSelected =
    visibleDrafts.length > 0 && selectedIds.size === visibleDrafts.length
  const someVisibleSelected = selectedIds.size > 0 && !allVisibleSelected

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-[1400px] explicitly overrides shadcn DialogContent's
          default `sm:max-w-sm` (384px on desktop). Width is wide enough
          for the split-pane without leaving a giant horizontal hole on
          1440-class screens. Height is tighter (80vh) so the editor pane
          doesn't trail off with white space below short message bodies;
          the sidebar scrolls internally when it has more rows than fit. */}
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[1400px] w-[96vw] h-[80vh] p-0 gap-0 overflow-hidden flex flex-col"
      >
        <DialogTitle className="sr-only">
          Client updates ({visibleDrafts.length})
        </DialogTitle>
        {/* Header: single 56px row, action cluster on the right matches the
            ActionIconButton chrome used everywhere else in the Hub. Single
            X-close — the Dialog primitive's built-in X is suppressed via
            showCloseButton={false} above so we don't stack two. */}
        <header className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 dark:bg-zinc-900/40 px-5 h-14 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
              <h2 className="text-[13px] font-semibold tracking-tight truncate">
                Client updates
                <span className="text-muted-foreground/60 font-medium ml-1.5">
                  · {notConsumed.length} open
                </span>
                {search && visibleDrafts.length !== notConsumed.length && (
                  <span className="text-muted-foreground/60 font-normal ml-1">
                    · {visibleDrafts.length} match
                  </span>
                )}
              </h2>
            </div>
            {recentlySent && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2.5 py-0.5 text-[11px] font-medium animate-in fade-in slide-in-from-left-2 duration-300">
                <Check className="h-3 w-3" />
                Verzonden naar {recentlySent.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh queue"
              aria-label="Refresh queue"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              title="Sluit"
              aria-label="Sluit"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar with draft list. Top-bar holds a sticky search input
              (filters by client / contact / AM); list scrolls below it. */}
          <aside className="w-[360px] border-r border-border/60 shrink-0 flex flex-col">
            <div className="p-2.5 border-b border-border/60 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Zoek op klant, contact of AM…"
                  className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border/60 bg-background text-sm outline-none focus:border-violet-500/50 placeholder:text-muted-foreground/40"
                />
                {search && (
                  <DismissButton
                    size="xs"
                    onClick={() => setSearch("")}
                    label="Clear search"
                    stopPropagation={false}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  />
                )}
              </div>
            </div>

            {/* Bulk action bar - appears between the search and the list
                whenever ≥1 drafts are selected. Master-checkbox toggles
                "all visible". */}
            <div className="px-2.5 py-1.5 border-b border-border/60 shrink-0 flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someVisibleSelected
                  }}
                  onChange={(e) =>
                    e.target.checked ? selectAllVisible() : clearSelection()
                  }
                  disabled={visibleDrafts.length === 0 || bulkSkipping || !!bulkSend}
                  className="h-3.5 w-3.5 rounded border-border accent-violet-500"
                />
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : "Select all"}
              </label>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={bulkSkip}
                    disabled={bulkSkipping || !!bulkSend}
                    className="text-[11px] inline-flex items-center gap-1 rounded-md border border-border/80 px-2 py-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
                    title={`Overslaan voor ${selectedIds.size} drafts`}
                  >
                    {bulkSkipping ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <SkipForward className="h-3 w-3" />
                    )}
                    Skip
                  </button>
                  <button
                    type="button"
                    onClick={bulkSendAll}
                    disabled={bulkSkipping || !!bulkSend}
                    className="text-[11px] inline-flex items-center gap-1 rounded-md bg-violet-500 hover:bg-violet-600 px-2 py-1 text-white transition-colors disabled:opacity-50"
                    title={`Verstuur ${selectedIds.size} drafts`}
                  >
                    {bulkSend ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Send
                  </button>
                </div>
              )}
            </div>

            {/* Bulk send progress - visible while sending, plus ~4.5s
                after to show the final tallies. Failures are surfaced
                inline; the bulk continues past errors so one bad client
                doesn't block the rest. */}
            {bulkSend && (
              <div className="px-2.5 py-2 border-b border-border/60 shrink-0 space-y-1">
                <p className="text-[11px] text-foreground/80">
                  {bulkSend.done < bulkSend.total ? (
                    <>Versturen {bulkSend.done + 1} van {bulkSend.total}…</>
                  ) : (
                    <>
                      Klaar - {bulkSend.total - bulkSend.failed} verzonden
                      {bulkSend.failed > 0 && `, ${bulkSend.failed} mislukt`}
                    </>
                  )}
                </p>
                <div className="h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-violet-500 transition-all"
                    style={{
                      width: `${Math.round((bulkSend.done / Math.max(bulkSend.total, 1)) * 100)}%`,
                    }}
                  />
                </div>
                {bulkSend.lastError && (
                  <p className="text-[11px] text-red-500 truncate" title={bulkSend.lastError}>
                    {bulkSend.lastError}
                  </p>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {notConsumed.length === 0 && (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  Alles verzonden ✨
                </p>
              )}
              {notConsumed.length > 0 && visibleDrafts.length === 0 && (
                <p className="text-xs text-muted-foreground/70 p-4 text-center">
                  Geen drafts gevonden voor &ldquo;{search}&rdquo;.
                </p>
              )}
              <ul className="py-2">
                {visibleDrafts.map((d) => (
                  <li key={d.id}>
                    <DraftSidebarRow
                      draft={d}
                      active={d.id === activeId}
                      selected={selectedIds.has(d.id)}
                      onClick={() => setUserPickedId(d.id)}
                      onToggleSelect={() => toggleSelected(d.id)}
                      edited={!!editedByDraft[d.id]}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* Editor pane */}
          <section className="flex-1 flex flex-col min-w-0">
            {activeDraft && activeParts ? (
              // `key={activeDraft.id}` is load-bearing: forces React to
              // unmount + remount the editor when we auto-advance to the
              // next draft after a send. Without it, local state like
              // `sent` / `error` from the previous draft sticks and the
              // Verstuur button stays frozen on "Verzonden ✓".
              <ActiveDraftEditor
                key={activeDraft.id}
                draft={activeDraft}
                parts={activeParts}
                setParts={setActiveParts}
                onResolved={(id, sentClientName) => {
                  setConsumedIds((prev) => {
                    const next = new Set(prev)
                    next.add(id)
                    return next
                  })
                  if (sentClientName) {
                    setRecentlySent({ name: sentClientName, at: Date.now() })
                  }
                  onDraftConsumed()
                  // Auto-close the sheet when the LAST UNRESOLVED draft is
                  // dealt with. Uses notConsumed (not visibleDrafts) so a
                  // narrow search filter doesn't trigger close prematurely.
                  const remaining = notConsumed.filter((d) => d.id !== id)
                  if (remaining.length === 0) {
                    setTimeout(() => onOpenChange(false), 1200)
                  }
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Geen draft geselecteerd.
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DraftSidebarRow({
  draft,
  active,
  selected,
  onClick,
  onToggleSelect,
  edited,
}: {
  draft: WeeklyUpdateDraftListItem
  active: boolean
  selected: boolean
  onClick: () => void
  onToggleSelect: () => void
  edited: boolean
}) {
  // Unknown channel = Monday's contact_channel column is empty or has an
  // unrecognised label. ~95% of clients are WhatsApp, so we default the
  // visual to WhatsApp instead of flagging it; the title attr surfaces
  // the fact that Monday is missing data for follow-up if needed.
  const isEmail = draft.channel === "email"
  const titleSuffix =
    draft.channel === "unknown" ? " (Monday contact_channel leeg - verifieer)" : ""
  return (
    <div
      className={cn(
        "w-full text-left px-3 py-2.5 border-l-2 transition-colors flex items-center gap-2.5",
        active
          ? "border-violet-500 bg-violet-500/8"
          : "border-transparent hover:bg-muted/40",
      )}
    >
      {/* Checkbox lives outside the row's main click target so toggling
          select doesn't also switch the editor pane. stopPropagation on
          the click handles taps within the checkbox itself. */}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelect}
        onClick={(e) => e.stopPropagation()}
        aria-label={`Select ${draft.clientName}`}
        className="h-3.5 w-3.5 rounded border-border accent-violet-500 shrink-0"
      />
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
      >
        <div
          className={cn(
            "h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-white shadow-sm",
            isEmail ? "bg-blue-500" : "bg-[#25D366]",
          )}
          title={(isEmail ? "Email" : "WhatsApp") + titleSuffix}
        >
          {isEmail ? (
            <Mail className="h-3.5 w-3.5" strokeWidth={2.4} />
          ) : (
            <WhatsAppIcon className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-medium truncate",
              active ? "text-foreground" : "text-foreground/90",
            )}
          >
            {draft.clientName}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {draft.contactFirstName ? `${draft.contactFirstName} · ` : ""}
            {draft.accountManager || "-"}
          </p>
        </div>
        {edited && (
          <span
            className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0"
            title="Bewerkt sinds geopend"
          />
        )}
      </button>
    </div>
  )
}

// ─── Active editor pane ──────────────────────────────────────────────────

function ActiveDraftEditor({
  draft,
  parts,
  setParts,
  onResolved,
}: {
  draft: WeeklyUpdateDraftListItem
  parts: EditableParts
  setParts: (next: EditableParts) => void
  /** Called after a draft is consumed (sent OR dismissed). When passing
   *  `sentClientName`, the parent shows a toast "Verzonden naar <name>"
   *  in the sheet header so the success is visible across the auto-
   *  advance to the next draft. */
  onResolved: (draftId: string, sentClientName?: string) => void
}) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEmail = draft.channel === "email"
  // Autosave UI state: "idle" before first edit, "saving" while the
  // PATCH is in flight, "saved" briefly after success. Drives the
  // small grey marker next to the footer buttons.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")

  // Re-derive the AM's first name from the template slug so the WhatsApp
  // sign-off in the preview matches what the customer will receive.
  // Strip both the prefix AND any `_N` version suffix (e.g.
  // `rl_weekly_danny_2` after a Meta re-approval → "Danny").
  const amSignOffName = useMemo(() => {
    if (!draft.templateName) return "…"
    const slug = draft.templateName
      .replace(/^rl_(weekly|universal)_/i, "")
      .replace(/_\d+$/, "")
      .trim()
    if (!slug) return "…"
    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }, [draft.templateName])

  // Frozen at mount per draft - looks like "now" when the AM opens the
  // editor. Reads draft.id so the linter sees the dep and so re-mounting
  // for a different draft does refresh the displayed time.
  const timestamp = useMemo(() => {
    void draft.id
    const d = new Date()
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }, [draft.id])

  const sendMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      const message = renderForSend(parts)
      const res = await fetch(`/api/clients/${draft.mondayItemId}/send-client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, subject: parts.subject, parts }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(err.message ?? err.error ?? "Verzenden mislukt")
      }
      const data = (await res.json()) as { outboundMsgId?: string }
      // Mark the draft consumed in the queue table. Fire-and-forget: a
      // flake here doesn't roll back the actual send.
      try {
        await fetch(`/api/weekly-update-drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "sent",
            sentMessageId: data.outboundMsgId,
          }),
        })
      } catch {
        // intentional swallow
      }
      return data
    },
    onSuccess: () => {
      setSent(true)
      // ~1.2s lets the AM register the "Verzonden ✓" state on the button
      // before we auto-advance to the next draft. The parent ALSO surfaces
      // a "Verzonden naar <client>" toast in the sheet header that lingers
      // for ~4s, so even after the editor switches the success is visible.
      setTimeout(() => onResolved(draft.id, draft.clientName), 1200)
    },
    onError: (e: Error) => setError(e.message),
  })

  const dismissMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      // Previously this awaited the fetch without checking res.ok, so a 4xx/5xx
      // looked like a silent success — the local row got cleared client-side
      // but the server still held the draft as `status='pending'`. Next refetch
      // resurrected the row. Roy 2026-06-12: surface the actual server error
      // so the AM sees why skip didn't take.
      const res = await fetch(`/api/weekly-update-drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? `Skip failed (${res.status})`)
      }
    },
    onSuccess: () => onResolved(draft.id),
    onError: (e: Error) => setError(e.message),
  })

  const inputsDisabled = sendMutation.isPending || sent

  // Autosave + flush + beforeunload + on-error save all flow through
  // the shared hook so the queue editor and the per-client dialog stay
  // identical. Returns `flushNow` we trigger from the send-error path
  // below so the latest edit is safe even before the AM reads the
  // toast.
  const { flushNow } = useWeeklyDraftAutosave({
    draftId: draft.id,
    parts,
    suspendDuring: inputsDisabled,
  })

  // Surface the small "Bezig met opslaan… / Opgeslagen" marker the
  // editor renders. Mirrors the debounce window in the hook so the UI
  // accurately reflects what's in flight.
  const initialPartsRef = useRef(parts)
  useEffect(() => {
    if (inputsDisabled) return
    if (parts === initialPartsRef.current) return
    setSaveState("saving")
    const handle = setTimeout(() => setSaveState("saved"), 800)
    return () => clearTimeout(handle)
  }, [parts, inputsDisabled])

  // Save-on-error: when the Trengo send blows up (Danny's case), flush
  // the latest parts back to the draft immediately so even a hard
  // reload after the error keeps the edit. Roy 2026-05-23.
  const sendError = sendMutation.error
  useEffect(() => {
    if (sendError) void flushNow()
  }, [sendError, flushNow])

  return (
    <>
      {/* Inner header: 56px to match the outer header so the split-pane
          horizontal seams line up. Template chip moved to a subtle muted
          pill (was an unstyled <code> tag that visually fought with the
          title weight). */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 h-14 shrink-0">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight truncate">{draft.clientName}</h3>
          <p className="text-[11px] text-muted-foreground/70 leading-tight mt-0.5 truncate">
            {draft.contactFirstName ? `${draft.contactFirstName} · ` : ""}
            AM: {draft.accountManager || "-"}
          </p>
        </div>
        {draft.templateName && (
          <span className="hidden sm:inline-flex items-center rounded-md bg-muted/60 px-2 py-1 font-mono text-[10px] text-muted-foreground/80 ring-1 ring-border/40">
            {draft.templateName}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isEmail ? (
          <EmailPreview parts={parts} setParts={setParts} inputsDisabled={inputsDisabled} />
        ) : (
          <WhatsAppPreview
            parts={parts}
            setParts={setParts}
            inputsDisabled={inputsDisabled}
            amSignOffName={amSignOffName}
            timestamp={timestamp}
          />
        )}
        {error && (
          <div className="mx-5 my-3 rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-500 leading-relaxed">{error}</p>
          </div>
        )}
      </div>

      {/* Footer: 56px row to mirror both headers; outlined skip + filled
          violet send anchor opposite sides. Autosave marker tucks between
          them so it stays visible without crowding either action. */}
      <footer className="border-t border-border/60 bg-muted/20 dark:bg-zinc-900/40 px-5 h-14 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => dismissMutation.mutate()}
            disabled={inputsDisabled || dismissMutation.isPending}
            className="border-border/80 text-muted-foreground hover:text-foreground hover:bg-muted/60"
            title="Sla deze klant deze week over (verschijnt niet meer in de queue)"
          >
            {dismissMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
            ) : (
              <SkipForward className="h-3.5 w-3.5 mr-1.5" />
            )}
            Overslaan
          </Button>
          {/* Autosave indicator - only renders when something has happened.
              "Opslaan…" during PATCH, "Opgeslagen" briefly after success. */}
          {saveState === "saving" && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Opslaan…
            </span>
          )}
          {saveState === "saved" && (
            <span className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
              <Check className="h-3 w-3 text-emerald-500" />
              Opgeslagen
            </span>
          )}
        </div>
        <Button
          size="sm"
          onClick={() => sendMutation.mutate()}
          disabled={inputsDisabled || sendMutation.isPending}
          className="bg-violet-500 hover:bg-violet-600 text-white shadow-sm"
        >
          {sent ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Verzonden
            </>
          ) : sendMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Versturen…
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Verstuur
            </>
          )}
        </Button>
      </footer>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Mirror of `renderFromParts` from the template module - duplicated here
 *  to avoid a deep import chain from a client component into a route
 *  type. Keep the two in sync if you change the join rules. */
function renderForSend(parts: EditableParts): string {
  const blocks: string[] = []
  const pushIf = (s: string | undefined) => {
    const t = (s ?? "").trim()
    if (t) blocks.push(t)
  }
  pushIf(parts.opener)
  pushIf(parts.intro)
  pushIf(parts.kpiBlock)
  // trendSentence + note removed from the editing surface and now empty
  // on new composes; still call pushIf so legacy stored drafts that
  // contain values still render.
  pushIf(parts.trendSentence)
  pushIf(parts.note)
  pushIf(parts.conclusion)
  const validActions = (parts.actions ?? []).map((a) => a.trim()).filter(Boolean)
  if (validActions.length > 0) {
    const lines: string[] = []
    if (parts.actionsHeader?.trim()) lines.push(parts.actionsHeader.trim())
    lines.push(...validActions.map((a) => `• ${a}`))
    blocks.push(lines.join("\n"))
  }
  // Overdue invoice payment block - sits between actions and sign-off so
  // the call-to-action reads as the closing CTA. Auto-populated by the
  // composer when Stripe returns one or more overdue invoices for this
  // client; AM can strip / edit per send.
  pushIf(parts.overdueBlock)
  pushIf(parts.signOff)
  return blocks.join("\n\n").trim()
}
