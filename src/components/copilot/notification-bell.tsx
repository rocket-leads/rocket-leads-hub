"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Bell,
  Loader2,
  AlertCircle,
  Sparkles,
  Check,
  Pencil,
  Trash2,
  Calendar,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { StatusPill } from "@/components/ui/status-pill"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction, CopilotDraft } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"
import {
  useCompleteDraft,
  useCopilotDrafts,
} from "./use-copilot-drafts"
import { ConfirmDialog } from "./confirm-dialog"

type UserRow = { id: string; name: string | null; email: string; role: string | null }

/**
 * AI Co-pilot notification bell. Visual language mirrors the inbox row
 * card 1:1 per Roy's directive (2026-05-22) so dismiss/approve/edit on
 * an AI draft feels identical to mark-done/delete on a regular task:
 *
 *   - Colored left rail (primary brand purple - AI is the "third type"
 *     next to violet=Task, sky=Update)
 *   - Type chip top-left ("AI Draft" with Sparkles icon)
 *   - StatusPill (Ready / Processing / Failed) in the same row
 *   - Title using inbox `text-[15px] font-medium`
 *   - Meta row with `text-xs text-muted-foreground/80` and `·` separators
 *   - Right-side 36×36 ActionIconButtons (success/danger/muted) - same
 *     component the inbox row uses, so the chrome is literally identical
 */
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editingDraft, setEditingDraft] = useState<CopilotDraft | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Roster lazily loaded once - same pattern the command bar uses for
  // the editable confirmation card.
  const [users, setUsers] = useState<UserRow[]>([])
  const [clients, setClients] = useState<ClientSearchResult[]>([])
  const rosterLoadedRef = useRef(false)
  const loadRoster = useCallback(async () => {
    if (rosterLoadedRef.current) return
    rosterLoadedRef.current = true
    try {
      const [uRes, cRes] = await Promise.all([
        fetch("/api/inbox/users"),
        fetch("/api/clients/search"),
      ])
      if (uRes.ok) setUsers((await uRes.json()).users ?? [])
      if (cRes.ok) {
        const data = await cRes.json()
        setClients(Array.isArray(data) ? data : [])
      }
    } catch {
      // Non-fatal - the bell still renders with raw ids.
    }
  }, [])

  const { data } = useCopilotDrafts()
  const completeDraft = useCompleteDraft()

  const drafts = data?.drafts ?? []
  const actionable = drafts.filter((d) => d.status === "ready" || d.status === "failed")
  const pending = drafts.filter((d) => d.status === "pending")
  const badgeCount = actionable.length

  // Click outside to close.
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

  async function quickApprove(draft: CopilotDraft) {
    if (!draft.draftAction) return
    const result = await executeAction(draft.draftAction, router)
    if (!result.ok) {
      console.error("Approve failed:", result.message)
      return
    }
    await completeDraft.mutateAsync({ id: draft.id, status: "approved" })
    if (result.navigateTo) router.push(result.navigateTo)
  }

  function openEditor(draft: CopilotDraft) {
    void loadRoster()
    setEditingDraft(draft)
    setOpen(false)
  }

  async function dismiss(draft: CopilotDraft) {
    await completeDraft.mutateAsync({ id: draft.id, status: "dismissed" })
  }

  return (
    <>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className={cn(
            "relative flex items-center justify-center h-10 w-10 rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]",
            badgeCount > 0 && "text-foreground",
          )}
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          {badgeCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {badgeCount}
            </span>
          )}
          {pending.length > 0 && badgeCount === 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted">
              <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
            </span>
          )}
        </button>

        {open && (
          <div className="absolute top-full right-0 mt-1 w-[28rem] rounded-xl border border-border bg-popover shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 bg-muted/30">
              <div className="flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Notifications
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                {actionable.length} ready · {pending.length} pending
              </span>
            </div>
            <div className="max-h-[28rem] overflow-y-auto p-2 space-y-2">
              {drafts.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <Sparkles className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
                  <div className="text-xs text-muted-foreground/70">
                    Niks open. Druk{" "}
                    <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘J</kbd> om een
                    command te starten.
                  </div>
                </div>
              ) : (
                drafts.map((d) => (
                  <DraftRow
                    key={d.id}
                    draft={d}
                    onApprove={quickApprove}
                    onEdit={openEditor}
                    onDismiss={dismiss}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={editingDraft !== null}
        onOpenChange={(o) => {
          if (!o) setEditingDraft(null)
        }}
        draft={editingDraft}
        users={users}
        clients={clients}
        onApprove={async (id) => {
          await completeDraft.mutateAsync({ id, status: "approved" })
          setEditingDraft(null)
        }}
      />
    </>
  )
}

// ─── Row card - mirrors inbox-list-row.tsx 1:1 ─────────────────────────────

const RAIL = {
  pending: "bg-amber-500",
  ready: "bg-primary",
  failed: "bg-red-500",
} as const

const KIND_CHIP = "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 bg-primary/10 text-primary border-primary/20"

function DraftRow({
  draft,
  onApprove,
  onEdit,
  onDismiss,
}: {
  draft: CopilotDraft
  onApprove: (d: CopilotDraft) => void
  onEdit: (d: CopilotDraft) => void
  onDismiss: (d: CopilotDraft) => void
}) {
  const isReady = draft.status === "ready"
  const isFailed = draft.status === "failed"
  const isPending = draft.status === "pending"

  // Row body click-area opens the editor for ready drafts; pending/failed
  // don't have an editor target so the body just sits inert.
  const bodyClickable = isReady

  function handleBodyClick() {
    if (bodyClickable) onEdit(draft)
  }
  function handleBodyKeyDown(e: React.KeyboardEvent) {
    if (!bodyClickable) return
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onEdit(draft)
    }
  }

  // Action mapping per status - matches inbox row semantics:
  //   ready  → success (Approve, Check) + muted (Edit, Pencil) + danger (Dismiss, Trash)
  //   failed → danger (Dismiss only)
  //   pending → no actions; just the spinner glyph
  const titleText = isReady ? draft.summary ?? "Ready" : draft.input

  return (
    <div className="relative rounded-lg border border-border bg-card hover:bg-muted/40 hover:shadow-sm transition-all overflow-hidden">
      {/* Left rail - same visual language as the inbox type rail */}
      <span
        aria-hidden
        className={cn("absolute left-0 top-0 bottom-0 w-1", RAIL[draft.status as keyof typeof RAIL] ?? "bg-muted")}
      />

      <div className="pl-4 pr-3 py-3 flex items-start gap-3">
        <div
          role={bodyClickable ? "button" : undefined}
          tabIndex={bodyClickable ? 0 : -1}
          onClick={handleBodyClick}
          onKeyDown={handleBodyKeyDown}
          className={cn(
            "flex-1 min-w-0",
            bodyClickable && "cursor-pointer",
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className={KIND_CHIP} title="AI Co-pilot draft">
              <Sparkles className="h-3 w-3" />
              AI Draft
            </span>
            {isPending && <StatusPill tone="warning">Processing</StatusPill>}
            {isFailed && <StatusPill tone="danger">Failed</StatusPill>}
            {isReady && <StatusPill tone="success">Ready</StatusPill>}
          </div>
          <div className="text-[15px] font-medium text-foreground mt-1.5 line-clamp-2">
            {titleText}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground/80 flex-wrap">
            {isFailed && draft.error && (
              <>
                <AlertCircle className="h-3 w-3 text-red-500" />
                <span className="text-red-500 line-clamp-1">{draft.error}</span>
              </>
            )}
            {isPending && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Processing context…</span>
              </>
            )}
            {isReady && draft.sourcesUsed.length > 0 && (
              <>
                <Calendar className="h-3 w-3" />
                <span className="line-clamp-1">{draft.sourcesUsed.join(" · ")}</span>
              </>
            )}
          </div>
        </div>

        {/* Right-side actions - identical chrome to inbox row */}
        <div className="flex items-center gap-1 shrink-0 pt-0.5">
          {isReady && (
            <>
              <ActionIconButton
                tone="success"
                label="Approve"
                onClick={(e) => {
                  e.stopPropagation()
                  onApprove(draft)
                }}
                icon={<Check className="h-4 w-4" />}
              />
              <ActionIconButton
                tone="muted"
                label="Edit"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit(draft)
                }}
                icon={<Pencil className="h-4 w-4" />}
              />
              <ActionIconButton
                tone="danger"
                label="Dismiss"
                onClick={(e) => {
                  e.stopPropagation()
                  onDismiss(draft)
                }}
                icon={<Trash2 className="h-4 w-4" />}
              />
            </>
          )}
          {isFailed && (
            <ActionIconButton
              tone="danger"
              label="Dismiss"
              onClick={(e) => {
                e.stopPropagation()
                onDismiss(draft)
              }}
              icon={<Trash2 className="h-4 w-4" />}
            />
          )}
        </div>
      </div>
    </div>
  )
}
