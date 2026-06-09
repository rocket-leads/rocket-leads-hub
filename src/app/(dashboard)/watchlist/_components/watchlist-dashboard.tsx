"use client"

import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { FiltersPopover, type FilterConfig } from "@/components/ui/filters-popover"
import { PageHeader } from "@/components/ui/page-header"
import { StatusPill } from "@/components/ui/status-pill"
import { RefreshCw, AlertCircle, TrendingUp, CheckCircle2, Check, ChevronDown, ChevronRight, ExternalLink, CircleDashed, Lightbulb, ListTodo, Loader2, ArrowRightLeft, Megaphone } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { KpiTile, type KpiValueTone } from "@/components/ui/kpi-tile"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { WatchlistStateResponse } from "@/app/api/watchlist/state/route"
// Watchlist narrative + score-history queries were removed 2026-06-09 —
// the Key Insights / Optimisation Proposals panels and the "vs 7d avg"
// KPI card they fed are gone. The endpoints stay live for cron / admin
// usage; this view just doesn't call them anymore.
import { categorize as sharedCategorize, severityScore as sharedSeverityScore, type WatchCategory as SharedWatchCategory } from "@/lib/watchlist/categorize"
import { buildSignature, suggestAiAdjustment } from "@/lib/watchlist/learning"
import type { RecentOverridesResponse } from "@/app/api/watchlist/recent-overrides/route"
import { ClientSlideOver } from "@/app/(dashboard)/clients/_components/client-slide-over"
import type { CurrentUser } from "@/app/(dashboard)/inbox/_components/inbox-view"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { formatCurrency } from "@/lib/i18n/format"
import type { Locale } from "@/lib/i18n/types"

// --- Categorization ---
//
// The actual category logic lives in `src/lib/watchlist/categorize.ts` so the cron
// (which writes the state table) and the UI agree on bucketing rules. This file just
// adds the UI-only fields (severity score, days/new flags from the state table).

type WatchCategory = SharedWatchCategory

type CategorizedClient = {
  client: MondayClient
  category: WatchCategory
  insight: string
  kpi: KpiSummary | undefined
  /** Severity score used to rank within Action/Watch — higher = more urgent */
  severity: number
  /** Days the client has been in this category — null when state is still loading or unknown */
  daysInBucket: number | null
  /** True when the client transitioned into this category today */
  isNewToday: boolean
  /** Yesterday's bucket — null if unknown / brand-new client */
  prevCategory: WatchCategory | null
  /** Active manual override surfaced from the state API — null when none */
  manualOverride: import("@/app/api/watchlist/state/route").WatchlistClientState["manualOverride"]
}

const categorize = sharedCategorize
const severityScore = sharedSeverityScore

function fmtCurrency(v: number): string {
  if (v >= 1000) return `€${(v / 1000).toFixed(1)}k`
  return `€${v.toFixed(0)}`
}

/**
 * Manual override action — campaign manager moves a client into a different
 * bucket with a required reason. Override lasts 7d max OR releases earlier
 * when CPL/spend shifts >25% from the snapshot (handled categorizer-side).
 *
 * Every Move also lands in the `watchlist_overrides` audit log — that's the
 * learning corpus the AI adjustment layer feeds on, so the same pattern on
 * future clients can be auto-suggested.
 *
 * Click handling mirrors CreateTaskButton: stopPropagation so the row's
 * slide-over doesn't open at the same time.
 */
function MoveButton({
  mondayItemId,
  clientName,
  category,
  insight,
  kpi,
  manualOverride,
  locale,
}: {
  mondayItemId: string
  clientName: string
  category: WatchCategory
  insight: string
  kpi: KpiSummary | undefined
  manualOverride: import("@/app/api/watchlist/state/route").WatchlistClientState["manualOverride"]
  locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const isOverridden = !!manualOverride
  const daysLeft = isOverridden
    ? Math.max(
        0,
        Math.ceil((new Date(manualOverride!.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      )
    : 0

  function handleClick(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation()
    e.preventDefault()
    setOpen(true)
  }

  const tooltip = isOverridden
    ? t("watchlist.move.tooltip_overridden", locale, { days: String(daysLeft) })
    : t("watchlist.move.tooltip", locale)

  const baseCls = "shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-md border transition-colors"
  const stateCls = isOverridden
    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
    : "border-border/40 text-muted-foreground/60 hover:border-border hover:text-foreground hover:bg-muted/40"

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick(e)
          else e.stopPropagation()
        }}
        title={tooltip}
        aria-label={tooltip}
        className={cn(baseCls, stateCls)}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
      </button>
      <MoveDialog
        open={open}
        onOpenChange={setOpen}
        mondayItemId={mondayItemId}
        clientName={clientName}
        category={category}
        insight={insight}
        kpi={kpi}
        manualOverride={manualOverride}
        locale={locale}
      />
    </>
  )
}

function MoveDialog({
  open,
  onOpenChange,
  mondayItemId,
  clientName,
  category,
  insight,
  kpi,
  manualOverride,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mondayItemId: string
  clientName: string
  category: WatchCategory
  insight: string
  kpi: KpiSummary | undefined
  manualOverride: import("@/app/api/watchlist/state/route").WatchlistClientState["manualOverride"]
  locale: Locale
}) {
  type Target = "action" | "watch" | "good"
  // Default selection: if already overridden → its current bucket;
  // else any rules-based bucket except the one we're already in.
  const initialTarget: Target = manualOverride
    ? manualOverride.category
    : category === "action"
      ? "watch"
      : category === "good"
        ? "watch"
        : "good"
  const [target, setTarget] = useState<Target>(initialTarget)
  const [reason, setReason] = useState(manualOverride?.reason ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Reset when the dialog re-opens — picks up the latest override snapshot
  // if the user opens, closes, then re-opens after another override landed.
  useEffect(() => {
    if (open) {
      setTarget(initialTarget)
      setReason(manualOverride?.reason ?? "")
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reasonTrimmed = reason.trim()
  const canSubmit = reasonTrimmed.length > 0 && !submitting && !clearing
  const targetLabel: Record<Target, string> = {
    action: t("watchlist.move.target_action", locale),
    watch: t("watchlist.move.target_watch", locale),
    good: t("watchlist.move.target_good", locale),
  }

  async function handleSubmit() {
    if (!reasonTrimmed) {
      setError(t("watchlist.move.reason_required", locale))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/watchlist/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mondayItemId,
          clientName,
          toCategory: target,
          fromCategory: category,
          reason: reasonTrimmed,
          insightAtTime: insight,
          kpiSnapshot: kpi
            ? {
                adSpend: kpi.adSpend,
                leads: kpi.leads,
                cpl: kpi.cpl,
                prevCpl: kpi.prevCpl,
              }
            : null,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || t("watchlist.move.failed", locale))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watchlist-state"] }),
        queryClient.invalidateQueries({ queryKey: ["watchlist-recent-overrides"] }),
      ])
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("watchlist.move.failed", locale))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleClear() {
    setClearing(true)
    setError(null)
    try {
      const res = await fetch(`/api/watchlist/override?mondayItemId=${encodeURIComponent(mondayItemId)}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error || t("watchlist.move.failed", locale))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watchlist-state"] }),
        queryClient.invalidateQueries({ queryKey: ["watchlist-recent-overrides"] }),
      ])
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : t("watchlist.move.failed", locale))
    } finally {
      setClearing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("watchlist.move.dialog_title", locale)} — {clientName}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("watchlist.move.dialog_subtitle", locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Active override pill */}
          {manualOverride && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              {t("watchlist.move.current_override", locale, {
                category: targetLabel[manualOverride.category],
                days: String(Math.max(0, Math.ceil((new Date(manualOverride.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))),
                reason: manualOverride.reason,
              })}
            </div>
          )}

          {/* Bucket selector */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
              {t("watchlist.move.target_label", locale)}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["action", "watch", "good"] as const).map((opt) => {
                const isSelected = target === opt
                const tone =
                  opt === "action"
                    ? isSelected
                      ? "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300"
                      : "border-border/40 hover:border-red-500/40"
                    : opt === "watch"
                      ? isSelected
                        ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-border/40 hover:border-amber-500/40"
                      : isSelected
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border/40 hover:border-emerald-500/40"
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setTarget(opt)}
                    className={cn(
                      "h-9 rounded-md border px-2 text-[12px] font-medium transition-colors",
                      tone,
                    )}
                  >
                    {targetLabel[opt]}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">
              {t("watchlist.move.reason_label", locale)}
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("watchlist.move.reason_placeholder", locale)}
              rows={4}
              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
              maxLength={2000}
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-600 dark:text-red-400">{error}</div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {manualOverride && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={submitting || clearing}
              onClick={handleClear}
              className="mr-auto text-xs"
            >
              {clearing ? t("watchlist.move.clear_saving", locale) : t("watchlist.move.clear", locale)}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting || clearing}
          >
            {t("watchlist.move.cancel", locale)}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? t("watchlist.move.submit_saving", locale) : t("watchlist.move.submit", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Create task" chip that opens a small editable pop-up on every Watch
 * List row. Click → AI pre-fills a title + body draft based on the
 * insight + 7d KPI snapshot, Roy edits anything (title, body, due
 * date), submits. The actual inbox row is assigned to the client's
 * Campaign Manager.
 *
 * Button states are now just:
 *   - idle:   primary chip, ready
 *   - done:   ✓ green chip for 3.5s after a successful create
 *   - error:  red chip with last error tooltip
 *   - disabled: muted, when the client has no campaignManager set
 *
 * The dialog handles its own saving/loading state — the trigger button
 * doesn't gate on a network round-trip anymore.
 */
function CreateTaskButton({
  mondayItemId,
  clientName,
  campaignManager,
  category,
  insight,
  kpi,
  locale,
}: {
  mondayItemId: string
  clientName: string
  campaignManager: string | null
  category: "action" | "watch" | "good"
  insight: string
  kpi: KpiSummary | undefined
  locale: Locale
}) {
  const [open, setOpen] = useState(false)
  const [lastResult, setLastResult] = useState<"done" | "error" | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const hasCm = !!campaignManager?.trim()

  function handleClick(e: React.MouseEvent | React.KeyboardEvent) {
    // Don't open the row's slide-over — this button has its own action.
    e.stopPropagation()
    e.preventDefault()
    if (!hasCm) return
    setOpen(true)
  }

  function handleCreated() {
    setLastResult("done")
    setOpen(false)
    setTimeout(() => setLastResult(null), 3500)
  }

  function handleFailed(message: string) {
    setLastResult("error")
    setErrorMsg(message)
    setOpen(false)
    setTimeout(() => {
      setLastResult(null)
      setErrorMsg(null)
    }, 5000)
  }

  const tooltip = !hasCm
    ? t("watchlist.row.create_task_no_cm_tooltip", locale)
    : lastResult === "done"
      ? t("watchlist.row.create_task_done", locale, { cm: campaignManager ?? "" })
      : lastResult === "error"
        ? errorMsg ?? t("watchlist.row.create_task_failed", locale)
        : t("watchlist.row.create_task_tooltip", locale, { cm: campaignManager ?? "" })

  return (
    <>
      <ActionIconButton
        tone="muted"
        label={t("watchlist.row.create_task", locale)}
        showLabel
        disabled={!hasCm}
        state={lastResult}
        tooltip={tooltip}
        icon={lastResult === "done" ? <Check className="h-3.5 w-3.5" /> : <ListTodo className="h-3.5 w-3.5" />}
        onClick={(e) => handleClick(e)}
      />
      {/* Dialog stays mounted so Base UI's body-scroll-lock cleanup
          can run when `open` flips to false. Unmounting via
          `{open && <Dialog>}` skips the cleanup and leaves
          `body.style.overflow = "hidden"`, which kills page scroll
          (see 2026-05-18 incident). The popup itself is only portaled
          to the DOM while open, so always-mounting is cheap. */}
      <CreateTaskDialog
        open={open}
        onOpenChange={setOpen}
        mondayItemId={mondayItemId}
        clientName={clientName}
        campaignManager={campaignManager}
        category={category}
        insight={insight}
        kpi={kpi}
        locale={locale}
        onCreated={handleCreated}
        onFailed={handleFailed}
      />
    </>
  )
}

/** Small edit dialog for the Watch List "Create task" flow. Fires the
 *  prefill request on open, then lets the AM tweak everything before
 *  the actual task lands in the CM's inbox. */
function CreateTaskDialog({
  open,
  onOpenChange,
  mondayItemId,
  clientName,
  campaignManager,
  category,
  insight,
  kpi,
  locale,
  onCreated,
  onFailed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mondayItemId: string
  clientName: string
  campaignManager: string | null
  category: "action" | "watch" | "good"
  insight: string
  kpi: KpiSummary | undefined
  locale: Locale
  onCreated: () => void
  onFailed: (message: string) => void
}) {
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [dueDate, setDueDate] = useState(todayIso)
  const [prefilling, setPrefilling] = useState(true)
  const [aiGenerated, setAiGenerated] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prefillFiredRef = useRef(false)

  const fetchPrefill = useCallback(async () => {
    setPrefilling(true)
    setError(null)
    try {
      const res = await fetch("/api/watchlist/task-prefill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          campaignManager,
          category,
          insight,
          kpi: kpi
            ? {
                adSpend: kpi.adSpend,
                leads: kpi.leads,
                cpl: kpi.cpl,
                prevCpl: kpi.prevCpl,
              }
            : undefined,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        title?: string
        body?: string
        aiGenerated?: boolean
      }
      setTitle(data.title ?? "")
      setBody(data.body ?? "")
      setAiGenerated(!!data.aiGenerated)
    } catch {
      // Fall back to a minimal title — Roy can edit + submit anyway.
      setTitle(t("watchlist.row.create_task_title", locale, { client: clientName }))
      setBody("")
      setAiGenerated(false)
    } finally {
      setPrefilling(false)
    }
  }, [clientName, campaignManager, category, insight, kpi, locale])

  // Fire prefill each time the dialog opens (not just first mount —
  // the dialog stays mounted now to keep Base UI's body-scroll-lock
  // cleanup intact). Reset the ref on close so the next open gets a
  // fresh Haiku draft against the latest insight/KPI snapshot. The
  // ref still guards against React 18 Strict Mode double-invoke.
  useEffect(() => {
    if (!open) {
      prefillFiredRef.current = false
      return
    }
    if (prefillFiredRef.current) return
    prefillFiredRef.current = true
    void fetchPrefill()
  }, [open, fetchPrefill])

  async function handleSubmit() {
    if (!title.trim()) {
      setError(t("watchlist.task_dialog.error_no_title", locale))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/watchlist/quick-cm-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mondayItemId,
          campaignManager,
          title: title.trim(),
          taskBody: body.trim() || null,
          dueDate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 404) {
          onFailed(t("watchlist.row.create_task_no_mapping", locale, { cm: campaignManager ?? "" }))
        } else {
          onFailed(data?.message ?? data?.error ?? t("watchlist.row.create_task_failed", locale))
        }
        return
      }
      onCreated()
    } catch {
      onFailed(t("watchlist.row.create_task_failed", locale))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onKeyDown={(e: React.KeyboardEvent) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t("watchlist.task_dialog.title", locale)}</DialogTitle>
          <DialogDescription>
            {campaignManager?.trim()
              ? t("watchlist.task_dialog.subtitle_with_cm", locale, { cm: campaignManager })
              : t("watchlist.task_dialog.subtitle_no_cm", locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* AI-draft state indicator + regenerate */}
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {prefilling ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  {t("watchlist.task_dialog.ai_drafting", locale)}
                </>
              ) : aiGenerated ? (
                <>
                  <Lightbulb className="h-3 w-3 text-violet-400" />
                  {t("watchlist.task_dialog.ai_label", locale)}
                </>
              ) : (
                <>
                  <Lightbulb className="h-3 w-3 text-muted-foreground/40" />
                  {t("watchlist.task_dialog.manual_label", locale)}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void fetchPrefill()
              }}
              disabled={prefilling || submitting}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={cn("h-3 w-3", prefilling && "animate-spin")} />
              {prefilling ? t("watchlist.task_dialog.field.regenerating", locale) : t("watchlist.task_dialog.field.regenerate", locale)}
            </button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-title" className="text-xs font-medium text-foreground/80">
              {t("watchlist.task_dialog.field.title", locale)}
            </label>
            <input
              id="task-title"
              type="text"
              value={title}
              disabled={prefilling || submitting}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-body" className="text-xs font-medium text-foreground/80">
              {t("watchlist.task_dialog.field.body", locale)}
            </label>
            <textarea
              id="task-body"
              value={body}
              disabled={prefilling || submitting}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("watchlist.task_dialog.field.body_placeholder", locale)}
              rows={6}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-y disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="task-due" className="text-xs font-medium text-foreground/80">
              {t("watchlist.task_dialog.field.due", locale)}
            </label>
            <input
              id="task-due"
              type="date"
              value={dueDate}
              disabled={submitting}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-3 text-sm tabular-nums dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            type="button"
          >
            {t("watchlist.task_dialog.cancel", locale)}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || prefilling || !campaignManager?.trim()}
            type="button"
          >
            {submitting ? t("watchlist.task_dialog.submitting", locale) : t("watchlist.task_dialog.submit", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

/**
 * Admin setup gaps surfaced in the No Data bucket. Meta ad account is intentionally
 * excluded — that gap is already produced by `categorize()` itself (with a richer
 * "no Meta ad account configured" reason). Monday board is excluded too because it
 * has a Meta-fallback path and therefore isn't a setup blocker.
 */
function getSetupGaps(client: MondayClient): string[] {
  const missing: string[] = []
  if (!client.stripeCustomerId) missing.push("Stripe")
  if (!client.trengoContactId) missing.push("Trengo")
  return missing
}

// --- Section config ---
//
// Styling (icon, colours) stays here as a const so the visual treatment of
// each bucket lives in one place. The section LABEL is resolved through the
// dictionary on render so the language switch flips "Action Needed" ↔
// "Actie nodig" without the styling having to change.

const CATEGORY_CONFIG = {
  action: {
    icon: AlertCircle,
    iconColor: "text-red-500",
    headerBg: "bg-red-500/5 border-red-500/20",
    rowBorder: "border-l-red-500/60",
    insightColor: "text-red-400",
    labelKey: "watchlist.section.action" as const,
  },
  watch: {
    icon: TrendingUp,
    iconColor: "text-amber-500",
    headerBg: "bg-amber-500/5 border-amber-500/20",
    rowBorder: "border-l-amber-500/60",
    insightColor: "text-amber-400",
    labelKey: "watchlist.section.watch" as const,
  },
  good: {
    icon: CheckCircle2,
    iconColor: "text-green-500",
    headerBg: "bg-green-500/5 border-green-500/20",
    rowBorder: "border-l-green-500/60",
    insightColor: "text-green-500",
    labelKey: "watchlist.section.good" as const,
  },
} as const

/**
 * Compact "how long has this client been in this bucket" indicator. Sits inline next
 * to the client name. Three states:
 *   - Just landed today  → red NEW pill (attention-grabbing, transient)
 *   - 1–2 days           → muted "Nd" — recent, no alarm
 *   - 3–6 days           → amber "Nd" — sticky, watch out
 *   - 7+ days            → red "Nd" — stuck in the bucket, structural problem
 * Returns null when there's nothing meaningful to show (state still loading, or 0d
 * without the NEW signal). For Good clients we keep the visual subtle since long-good
 * is a positive signal but not urgent.
 */
function BucketAge({
  category,
  daysInBucket,
  isNewToday,
  locale,
}: {
  category: WatchCategory
  daysInBucket: number | null
  isNewToday: boolean
  locale: Locale
}) {
  if (isNewToday) {
    return (
      <span className="inline-flex items-center rounded-sm px-1 py-px text-[9px] font-bold uppercase tracking-wider bg-red-500/15 text-red-400">
        {t("watchlist.row.new_pill", locale)}
      </span>
    )
  }
  if (daysInBucket == null || daysInBucket <= 0) return null

  // Color emphasis only for Action / Watch — for Good a long stretch is good news, just
  // not something to highlight. No-data buckets don't show this at all (handled by caller).
  let toneClass = "text-muted-foreground/50"
  if (category === "action" || category === "watch") {
    if (daysInBucket >= 7) toneClass = "text-red-400 font-medium"
    else if (daysInBucket >= 3) toneClass = "text-amber-400"
    else toneClass = "text-muted-foreground/60"
  }

  return <span className={`text-[10px] tabular-nums ${toneClass}`}>{daysInBucket}d</span>
}

// --- Summary Header ---
//
// Watchlist KPI summary uses the canonical KpiTile primitive — same
// chrome, label, value typography and tone-system as Home, Targets and
// the Client home tab. Roy 2026-05-23: "structuur en fonts moeten overal
// hetzelfde". WatchlistKpiCard + WatchlistKpiSkeletons were removed in
// favour of the shared component so any future tweak to KpiTile lands
// across all surfaces at once.

type WatchlistKpiStatus = "good" | "warn" | "bad" | "neutral"

function WatchlistKpiSkeletons() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <KpiTile key={i} label="" value="" loading />
      ))}
    </div>
  )
}

// --- Watch Section ---

function WatchSection({
  category,
  items,
  defaultOpen,
  onSelectClient,
  locale,
}: {
  category: "action" | "watch" | "good"
  items: CategorizedClient[]
  defaultOpen: boolean
  onSelectClient: (mondayItemId: string) => void
  locale: Locale
}) {
  const [open, setOpen] = useState(defaultOpen)
  const config = CATEGORY_CONFIG[category]
  const Icon = config.icon

  if (items.length === 0) return null

  return (
    <div>
      {/* Section header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border ${config.headerBg} mb-3 transition-colors hover:opacity-80`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <Icon className={`h-4 w-4 ${config.iconColor}`} />
        <span className="text-sm font-medium">{t(config.labelKey, locale)}</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          {/* Column headers — kept tight per Roy's instruction: Client,
              Insight, Spend, Leads, CPL, and one Create-task quick action.
              AI Note / Appts / 14d CPL sparkline / Ask Pedro all removed
              (rolled into the slide-over which opens on row click). */}
          <div className="grid grid-cols-[minmax(180px,1.2fr)_minmax(280px,3fr)_90px_70px_80px_140px_44px_44px] gap-x-4 px-5 py-2.5 border-b border-border/60 bg-muted/50">
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.client", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.insight", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.spend", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.leads", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.cpl", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.create_task", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold sr-only">{t("watchlist.col.move", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold sr-only">{t("watchlist.col.ads_manager", locale)}</span>
          </div>

          {/* Rows */}
          {items.map(({ client, insight, kpi, daysInBucket, isNewToday, manualOverride }) => {
            const id = client.mondayItemId

            return (
              <div key={id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectClient(id)}
                  onKeyDown={(e) => {
                    // Skip when the keypress comes from an input / textarea /
                    // contenteditable. React synthetic events bubble through
                    // portals, so a Space pressed inside a portal-mounted
                    // dialog textarea (Move dialog, Create-task dialog) still
                    // reaches this handler — and preventDefault would block
                    // the literal space character from appearing in the
                    // field. Roy 2026-06-09.
                    const tag = (e.target as HTMLElement | null)?.tagName
                    if (
                      tag === "INPUT" ||
                      tag === "TEXTAREA" ||
                      tag === "SELECT" ||
                      (e.target as HTMLElement | null)?.isContentEditable
                    ) {
                      return
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectClient(id)
                    }
                  }}
                  className={`grid grid-cols-[minmax(180px,1.2fr)_minmax(280px,3fr)_90px_70px_80px_140px_44px_44px] gap-x-4 px-5 py-3 border-b border-border/40 border-l-2 ${config.rowBorder} hover:bg-muted/30 transition-colors items-center cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40`}
                >
                  {/* Client */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{client.name}</p>
                      <BucketAge category={category} daysInBucket={daysInBucket} isNewToday={isNewToday} locale={locale} />
                    </div>
                    <p className="text-[10px] text-muted-foreground/40 truncate">
                      {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  {/* Insight */}
                  <p className={`text-xs leading-snug ${config.insightColor}`}>
                    {insight}
                  </p>

                  {/* Spend */}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {kpi && kpi.adSpend > 0 ? fmtCurrency(kpi.adSpend) : "—"}
                  </span>

                  {/* Leads */}
                  <span className="text-xs tabular-nums font-medium">
                    {kpi && kpi.leads > 0 ? kpi.leads : kpi && kpi.adSpend > 0 ? "0" : "—"}
                  </span>

                  {/* CPL */}
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {kpi && kpi.cpl > 0 ? formatCurrency(kpi.cpl, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                  </span>

                  {/* Create task — opens edit dialog pre-filled with an
                      AI draft, assigned to the client's CM. */}
                  <CreateTaskButton
                    mondayItemId={id}
                    clientName={client.name}
                    campaignManager={client.campaignManager}
                    category={category}
                    insight={insight}
                    kpi={kpi}
                    locale={locale}
                  />

                  {/* Manual override — moves the client between buckets with a
                      required reason. Reason + KPI snapshot lands in the
                      audit log as training signal for the AI adjustment layer. */}
                  <MoveButton
                    mondayItemId={id}
                    clientName={client.name}
                    category={category}
                    insight={insight}
                    kpi={kpi}
                    manualOverride={manualOverride}
                    locale={locale}
                  />

                  {/* Open the Meta Ads Manager for this client in a NEW
                      tab — leaves the watchlist intact so the CM can
                      bounce between rows without losing scroll position
                      or the open detail dialog. Hidden when the client
                      has no Meta ad account configured. Roy 2026-06-09. */}
                  {client.metaAdAccountId ? (
                    <a
                      href={`https://business.facebook.com/adsmanager/manage/campaigns?act=${client.metaAdAccountId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={t("watchlist.row.open_ads_manager", locale)}
                      aria-label={t("watchlist.row.open_ads_manager", locale)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/40 text-muted-foreground/60 hover:border-blue-500/40 hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      <Megaphone className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span aria-hidden />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// --- No Data Section ---
// Live clients that have no actionable performance metrics for the 7d window — picked up
// here so they're never silently dropped. Reasons surface inline: RL ad account with no
// campaigns selected, no Meta ad account configured, or genuinely no spend/leads this week.

function NoDataSection({
  items,
  defaultOpen,
  locale,
}: {
  items: CategorizedClient[]
  defaultOpen: boolean
  locale: Locale
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (items.length === 0) return null

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 w-full px-4 py-2.5 rounded-lg border bg-muted/20 border-border/30 mb-3 transition-colors hover:opacity-80"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
        <CircleDashed className="h-4 w-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-muted-foreground">{t("watchlist.no_data.title", locale)}</span>
        <span className="text-xs text-muted-foreground/50 tabular-nums">{items.length}</span>
        <span className="text-[11px] text-muted-foreground/40 ml-1">{t("watchlist.no_data.subtitle", locale)}</span>
      </button>

      {open && (
        <div className="rounded-xl border border-border/30 overflow-hidden">
          <div className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-2.5 border-b border-border/60 bg-muted/50">
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.col.client", locale)}</span>
            <span className="text-[13px] text-foreground/80 font-semibold">{t("watchlist.no_data.col_reason", locale)}</span>
            <span />
          </div>

          {items.map(({ client, insight }) => (
            <Link
              key={client.mondayItemId}
              href={`/clients/${client.mondayItemId}?from=watchlist`}
              className="grid grid-cols-[minmax(180px,1.2fr)_1fr_32px] gap-x-4 px-5 py-3 border-b border-border/40 border-l-2 border-l-muted-foreground/30 hover:bg-muted/30 transition-colors items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-muted-foreground/80 truncate">{client.name}</p>
                <p className="text-[10px] text-muted-foreground/40 truncate">
                  {[client.campaignManager, client.accountManager].filter(Boolean).join(" · ")}
                </p>
              </div>

              <p className="text-xs text-muted-foreground/70 leading-snug">{insight}</p>

              <span className="text-muted-foreground/20 flex justify-center">
                <ExternalLink className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main Dashboard ---

type Props = {
  clients: MondayClient[]
  userName: string
  currentUser: CurrentUser | null
}

export function WatchListDashboard({ clients, currentUser }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const selectedClientId = searchParams.get("client")
  const locale = useLocale()

  const handleSelectClient = useCallback(
    (mondayItemId: string) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("client", mondayItemId)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  const handleClosePanel = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("client")
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  // Body scroll lock is handled by Base UI's Dialog inside ClientSlideOver.
  // The previous manual `body.style.overflow` lock here fought with Base UI's:
  // if Base UI ran first, `original` captured "hidden" and the cleanup
  // restored it back to "hidden" — leaving the page unscrollable until
  // a hard refresh. Removed 2026-06-07.

  const [cmFilter, setCmFilter] = useState("All")
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Lookup so the slide-over can render instantly with the client
  // object we already have, instead of waiting for /api/clients/[id]
  // to hit Monday again (~500-2000ms).
  const clientById = useMemo(() => {
    const map = new Map<string, MondayClient>()
    for (const c of clients) map.set(c.mondayItemId, c)
    return map
  }, [clients])
  const selectedClientPreview = selectedClientId ? clientById.get(selectedClientId) ?? null : null

  const campaignManagers = useMemo(() => uniqueSorted(clients.map((c) => c.campaignManager)), [clients])

  const filteredClients = useMemo(
    () => cmFilter === "All" ? clients : clients.filter((c) => c.campaignManager === cmFilter),
    [clients, cmFilter]
  )

  const kpiClients = useMemo(
    () =>
      filteredClients
        .filter((c) => c.metaAdAccountId || c.clientBoardId)
        .map((c) => ({
          mondayItemId: c.mondayItemId,
          metaAdAccountId: c.metaAdAccountId || null,
          clientBoardId: c.clientBoardId || null,
        })),
    [filteredClients]
  )

  const kpiQuery = useQuery<Record<string, KpiSummary>>({
    queryKey: ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
    queryFn: () =>
      fetch("/api/kpi-summaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
      }).then((r) => r.json()),
    enabled: kpiClients.length > 0,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const lastUpdated = kpiQuery.dataUpdatedAt
    ? new Date(kpiQuery.dataUpdatedAt).toLocaleTimeString(locale === "nl" ? "nl-NL" : "en-GB", { hour: "2-digit", minute: "2-digit" })
    : null

  // Watch List bucket state — written by the cron, read here to render Days indicator,
  // NEW badge, and yesterday-vs-today score trend.
  const stateQuery = useQuery<WatchlistStateResponse>({
    queryKey: ["watchlist-state"],
    queryFn: () => fetch("/api/watchlist/state").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  // Recent overrides — feeds the learning layer. Every Move action invalidates
  // this query so the pattern-matcher picks up new corrections immediately.
  const recentOverridesQuery = useQuery<RecentOverridesResponse>({
    queryKey: ["watchlist-recent-overrides"],
    queryFn: () => fetch("/api/watchlist/recent-overrides").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  function daysBetween(fromIso: string, toIso: string): number {
    // Date strings are YYYY-MM-DD UTC — use UTC math to avoid DST drift.
    const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10))
    const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10))
    return Math.max(0, Math.floor((b - a) / 86400000))
  }

  // Categorize
  const categorized = useMemo(() => {
    const action: CategorizedClient[] = []
    const watch: CategorizedClient[] = []
    const good: CategorizedClient[] = []
    const noData: CategorizedClient[] = []
    const stateMap = stateQuery.data ?? {}

    function buildItem(client: MondayClient, category: WatchCategory, insight: string, kpi: KpiSummary | undefined, severity: number): CategorizedClient {
      const state = stateMap[client.mondayItemId]
      const stateMatchesCategory = state?.category === category
      // Days only meaningful when the cron-recorded state agrees with what we're rendering
      // right now. If the UI computed a different bucket than the state row holds (e.g.
      // mid-cron-run, or live data flipped), we'd rather show no day count than a wrong one.
      const daysInBucket = stateMatchesCategory ? daysBetween(state!.sinceDate, today) : null
      const isNewToday = stateMatchesCategory && state!.sinceDate === today
      const prevCategory = stateMatchesCategory ? (state!.prevCategory as WatchCategory | null) : null
      const manualOverride = state?.manualOverride ?? null
      return { client, category, insight, kpi, severity, daysInBucket, isNewToday, prevCategory, manualOverride }
    }

    const overrides = recentOverridesQuery.data?.overrides ?? []

    for (const client of filteredClients) {
      const kpi = kpiQuery.data?.[client.mondayItemId]
      // Active manual override (if any) — categorize() short-circuits to this
      // bucket when the override is still within its 7d TTL AND the live KPI
      // hasn't drifted >25% from the snapshot the CM was looking at.
      const manualOverride = stateMap[client.mondayItemId]?.manualOverride ?? null
      // AI adjustment derived from the override audit log — pattern matches
      // against the team's past corrections. Returns a suggestion only when
      // ≥2 supporting overrides exist with consistent target bucket. Applied
      // by categorize() when confidence ≥ 0.75 AND no hard manual override.
      const aiAdjustment = suggestAiAdjustment(buildSignature(kpi), overrides)
      const { category, insight } = categorize(client, kpi, locale, {
        manualOverride,
        aiAdjustment,
      })
      const severity = kpi ? severityScore(kpi) : 0
      const gaps = getSetupGaps(client)

      // "missing — admin setup incomplete" suffix stays a UI-side build (not
      // produced inside categorize) so the locale-aware Dutch/English split
      // for the gap label lives next to the rest of the watchlist surface.
      const missingLabel = locale === "nl" ? "ontbreekt" : "missing"
      const adminIncompleteLabel = locale === "nl"
        ? "ontbreekt — admin setup onvolledig"
        : "missing — admin setup incomplete"

      if (category === "action") action.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "watch") watch.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "good") good.push(buildItem(client, category, insight, kpi, severity))
      else if (category === "no-data") {
        // Already a no-data client — append any Stripe/Trengo gap to the existing reason
        // so the CM sees both "no spend this week" + "Stripe missing" in one row.
        const augmented = gaps.length > 0 ? `${insight} · ${gaps.join(" + ")} ${missingLabel}` : insight
        noData.push(buildItem(client, category, augmented, kpi, severity))
      }

      // Surface setup gaps even when performance data exists. These intentionally appear
      // in BOTH the performance bucket (Action/Watch/Good) and in No Data — Roy explicitly
      // wants admin gaps prominently visible regardless of campaign performance.
      if (category !== "no-data" && gaps.length > 0) {
        noData.push(buildItem(client, "no-data", `${gaps.join(" + ")} ${adminIncompleteLabel}`, kpi, 0))
      }
    }

    // Action & Watch: rank by severity (worst first → drop everything at the top).
    // Days-in-bucket is the tiebreaker so longer-stuck clients edge out fresher entries
    // when their financial impact is similar.
    const sortByImpact = (a: CategorizedClient, b: CategorizedClient) => {
      if (b.severity !== a.severity) return b.severity - a.severity
      return (b.daysInBucket ?? 0) - (a.daysInBucket ?? 0)
    }
    action.sort(sortByImpact)
    watch.sort(sortByImpact)
    good.sort((a, b) => (b.kpi?.leads ?? 0) - (a.kpi?.leads ?? 0))
    noData.sort((a, b) => a.client.name.localeCompare(b.client.name))

    return { action, watch, good, noData }
  }, [filteredClients, kpiQuery.data, stateQuery.data, recentOverridesQuery.data, today, locale])

  // Health score for the summary header. Excludes no-data so setup gaps don't water down
  // the percentage (Roy: "die wil ik niet dat die de data beïnvloed").
  const healthScore = useMemo(() => {
    const total = categorized.action.length + categorized.watch.length + categorized.good.length
    return total > 0 ? Math.round((categorized.good.length / total) * 100) : 0
  }, [categorized])

  // Yesterday's bucket counts, reconstructed from the state table. For each client whose
  // since_date === today, prev_category was their bucket yesterday; otherwise category is.
  // Then we filter to the same CM scope and tally.
  const yesterdayTotals = useMemo(() => {
    const stateMap = stateQuery.data ?? {}
    const totals = { action: 0, watch: 0, good: 0, noData: 0 }
    for (const client of filteredClients) {
      const state = stateMap[client.mondayItemId]
      if (!state) continue
      const yCat: WatchCategory | null = state.sinceDate === today ? state.prevCategory : state.category
      if (yCat === "action") totals.action++
      else if (yCat === "watch") totals.watch++
      else if (yCat === "good") totals.good++
      else if (yCat === "no-data") totals.noData++
    }
    return totals
  }, [filteredClients, stateQuery.data, today])

  // Average CPL across all currently-live clients (action + watch + good). Computed as
  // SUM(spend) / SUM(leads) so the metric is weighted by spend — a single high-spend
  // client doesn't get drowned out by many low-spend clients with extreme CPLs.
  const avgCpl = useMemo(() => {
    const liveClients = [...categorized.action, ...categorized.watch, ...categorized.good]
    let totalSpend = 0
    let totalLeads = 0
    for (const c of liveClients) {
      if (!c.kpi) continue
      totalSpend += c.kpi.adSpend
      totalLeads += c.kpi.leads
    }
    return totalLeads > 0 ? totalSpend / totalLeads : null
  }, [categorized])

  // AI narrative (Key Insights + Optimisation Proposals) was removed
  // 2026-06-09 — Roy: nobody read it on the watchlist. The narrative
  // endpoint stays so the cron + admin debug surfaces can still hit
  // it; we just don't fetch it from this dashboard anymore.

  // AI Note column was removed per Roy's directive (Watch List home →
  // Watch List 2026-05-14). The /api/watchlist-summaries call and the
  // per-row note state went with it — the slide-over opened on row click
  // is where AI commentary still lives.

  async function handleRefresh() {
    setIsRefreshing(true)
    router.refresh()
    // Bypass the kpi_summaries cache (Meta/Monday live fetch). The endpoint
    // re-writes the cache on success so other consumers see the fresh data too.
    try {
      const fresh: Record<string, KpiSummary> = await fetch("/api/kpi-summaries?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clients: kpiClients }),
        cache: "no-store",
      }).then((r) => r.json())
      queryClient.setQueryData<Record<string, KpiSummary>>(
        ["kpi-summaries", kpiClients.map((c) => c.mondayItemId)],
        fresh,
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  const isFetching = kpiQuery.isFetching || isRefreshing

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("watchlist.title", locale)}
        actions={
          <>
            {lastUpdated && (
              <span className="text-[11px] text-muted-foreground/40">{t("watchlist.updated", locale, { time: lastUpdated })}</span>
            )}
            <button
              type="button"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-muted/50 transition-all"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </>
        }
      />

      {/* Summary pills + CM filter — uses the shared StatusPill primitive
          so the same chrome is used everywhere the Hub displays a status
          tone (table rows, slide-over headers, etc.). */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusPill tone="danger">
            {t("watchlist.pill.action", locale)} <span className="tabular-nums">{categorized.action.length}</span>
          </StatusPill>
          <StatusPill tone="warning">
            {t("watchlist.pill.watch", locale)} <span className="tabular-nums">{categorized.watch.length}</span>
          </StatusPill>
          <StatusPill tone="success">
            {t("watchlist.pill.good", locale)} <span className="tabular-nums">{categorized.good.length}</span>
          </StatusPill>
          <StatusPill tone="neutral">
            {t("watchlist.pill.no_data", locale)} <span className="tabular-nums">{categorized.noData.length}</span>
          </StatusPill>
        </div>

        <FiltersPopover
          align="end"
          filters={[
            {
              key: "cm",
              label: t("watchlist.filter.cm_label", locale),
              value: cmFilter,
              onChange: setCmFilter,
              options: [
                { value: "All", label: t("watchlist.filter.all_cms", locale) },
                ...campaignManagers.map((cm) => ({ value: cm, label: cm })),
              ],
            } satisfies FilterConfig,
          ]}
        />
      </div>

      {/* 4 KPI cards — same primitive as the Targets HeroPillars so the watchlist reads
          as the same product family. */}
      {kpiQuery.isLoading || stateQuery.isLoading ? (
        <WatchlistKpiSkeletons />
      ) : (
        (() => {
          const total = categorized.action.length + categorized.watch.length + categorized.good.length

          // Card 1 — health score (today). Traffic-light coloured by zone so the
          // number reads as "below target / on the line / on track" at a glance:
          //   <50 red, 50-74 amber, ≥75 green.
          const scoreStatus: WatchlistKpiStatus =
            total === 0
              ? "neutral"
              : healthScore < 50
                ? "bad"
                : healthScore < 75
                  ? "warn"
                  : "good"

          // "vs 7d avg" KPI card removed 2026-06-09 — Roy: the
          // delta-vs-rolling-average card wasn't being read. The
          // headline Health card already conveys current state; a
          // separate "vs 7d" delta added noise without driving
          // decisions. The score-history endpoint stays live for
          // crons / admin debug.

          // Card 3 — Healthy clients ratio. Always neutral status (it's a fact, not a verdict).
          const valueHealthy = total === 0 ? "—" : `${categorized.good.length}/${total}`
          const subtitleHealthy = total === 0
            ? t("watchlist.kpi.healthy.no_scope", locale)
            : t("watchlist.kpi.healthy.subtitle", locale)

          // Card 4 — Average CPL across live clients (weighted by spend).
          const valueCpl = avgCpl == null
            ? "—"
            : formatCurrency(avgCpl, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const liveCount = categorized.action.length + categorized.watch.length + categorized.good.length
          const subtitleCpl = avgCpl == null
            ? t("watchlist.kpi.avg_cpl.empty", locale)
            : t(
                liveCount === 1 ? "watchlist.kpi.avg_cpl.subtitle_one" : "watchlist.kpi.avg_cpl.subtitle_many",
                locale,
                { n: liveCount },
              )

          return (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <KpiTile
                label={t("watchlist.kpi.health.label", locale)}
                value={total === 0 ? "—" : `${healthScore}%`}
                valueTone={scoreStatus as KpiValueTone}
                sub={total === 0 ? t("watchlist.kpi.health.no_scope", locale) : t("watchlist.kpi.health.target", locale)}
              />
              <KpiTile
                label={t("watchlist.kpi.healthy.label", locale)}
                value={valueHealthy}
                sub={subtitleHealthy}
              />
              <KpiTile
                label={t("watchlist.kpi.avg_cpl.label", locale)}
                value={valueCpl}
                sub={subtitleCpl}
              />
            </div>
          )
        })()
      )}

      {/* Key Insights + Optimisation Proposal panels removed 2026-06-09 —
          per Roy nobody read them on the watchlist; the AI commentary
          still surfaces inside the slide-over opened on row click. */}

      {/* Sections */}
      <div className="space-y-6">
        <WatchSection
          category="action"
          items={categorized.action}
          defaultOpen={true}
          onSelectClient={handleSelectClient}
          locale={locale}
        />
        <WatchSection
          category="watch"
          items={categorized.watch}
          defaultOpen={true}
          onSelectClient={handleSelectClient}
          locale={locale}
        />
        <NoDataSection
          items={categorized.noData}
          defaultOpen={false}
          locale={locale}
        />
        <WatchSection
          category="good"
          items={categorized.good}
          defaultOpen={false}
          onSelectClient={handleSelectClient}
          locale={locale}
        />
      </div>

      {currentUser && (
        <ClientSlideOver
          clientId={selectedClientId}
          onClose={handleClosePanel}
          currentUser={currentUser}
          clientPreview={selectedClientPreview}
          allClients={clients}
          onSelectClient={handleSelectClient}
        />
      )}
    </div>
  )
}
