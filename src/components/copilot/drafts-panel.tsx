"use client"

import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Calendar,
  Check,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { StatusPill } from "@/components/ui/status-pill"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotDraft } from "@/lib/copilot/tools"
import { useCompleteDraft, useCopilotDrafts } from "./use-copilot-drafts"

/**
 * Drafts panel rendered inside the AI Co-pilot command bar dialog.
 *
 * Editor state (editingDraft + roster + ConfirmDialog rendering) lives
 * one level up in CommandBar — Roy 2026-06-12: clicking a draft used to
 * close the parent Dialog which unmounted this panel (and the
 * ConfirmDialog inside it) before the editor could show. Lifting it
 * means the editor survives the parent close.
 *
 * Row chrome is identical to the inbox row (chip, status pill, 36×36
 * ActionIconButtons) so the AI Draft surface visually belongs to the
 * same family as Tasks / Updates.
 */
export function DraftsPanel({
  onEditDraft,
  pendingInputs = [],
}: {
  /** Called when the user clicks a ready draft (body or pencil icon).
   *  Parent owns the editor state — see CommandBar. */
  onEditDraft: (draft: CopilotDraft) => void
  /** Optimistic in-flight queue submissions from the parent. Each entry
   *  renders as a "Queuing…" placeholder row at the top of the list so the
   *  user sees their command land without the input locking up. Cleared
   *  by the parent when the server responds. */
  pendingInputs?: Array<{ tempId: string; text: string }>
}) {
  const router = useRouter()

  const { data } = useCopilotDrafts()
  const completeDraft = useCompleteDraft()

  const drafts = data?.drafts ?? []
  const actionable = drafts.filter((d) => d.status === "ready" || d.status === "failed")
  const pending = drafts.filter((d) => d.status === "pending")

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

  async function dismiss(draft: CopilotDraft) {
    await completeDraft.mutateAsync({ id: draft.id, status: "dismissed" })
  }

  // Roy 2026-06-12: the panel is always rendered, even when empty, so the
  // dialog has consistent structure and the optimistic Queuing… placeholder
  // has somewhere to land. The header counter folds in pending submissions
  // so "1 queuing" shows up the moment the user hits Enter.
  const isEmpty = drafts.length === 0 && pendingInputs.length === 0

  return (
    <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Drafts
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">
          {pendingInputs.length > 0 && `${pendingInputs.length} queuing · `}
          {actionable.length} ready · {pending.length} pending
        </span>
      </div>
      <div className="max-h-[22rem] overflow-y-auto p-2 space-y-2">
        {pendingInputs.map((p) => (
          <QueueingPlaceholderRow key={p.tempId} input={p.text} />
        ))}
        {drafts.map((d) => (
          <DraftRow
            key={d.id}
            draft={d}
            onApprove={quickApprove}
            onEdit={onEditDraft}
            onDismiss={dismiss}
          />
        ))}
        {isEmpty && (
          <div className="px-3 py-8 text-center">
            <Sparkles className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/70">
              Nog geen drafts. Type een command hierboven en hij verschijnt hier.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Actionable-drafts count for the ⌘J button badge. Returns 0 when the
 *  query hasn't resolved yet so the badge doesn't flicker on mount. */
export function useCopilotDraftsBadge(): number {
  const { data } = useCopilotDrafts()
  const drafts = data?.drafts ?? []
  return drafts.filter((d) => d.status === "ready" || d.status === "failed").length
}

/** Optimistic placeholder shown the moment the user submits a command,
 *  until the server's pending row arrives via the next drafts refetch.
 *  Visually matches the Processing state so the swap is seamless. */
function QueueingPlaceholderRow({ input }: { input: string }) {
  return (
    <div className="relative rounded-lg border border-border bg-card overflow-hidden opacity-90">
      <span aria-hidden className="absolute left-0 top-0 bottom-0 w-1 bg-amber-500" />
      <div className="pl-4 pr-3 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={KIND_CHIP} title="AI Co-pilot draft">
              <Sparkles className="h-3 w-3" />
              AI Draft
            </span>
            <StatusPill tone="warning">Queuing…</StatusPill>
          </div>
          <div className="text-[15px] font-medium text-foreground mt-1.5 line-clamp-2">
            {input}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground/80">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Versturen…</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Row card - mirrors inbox-list-row.tsx 1:1 ─────────────────────────────

const RAIL = {
  pending: "bg-amber-500",
  ready: "bg-primary",
  failed: "bg-red-500",
} as const

const KIND_CHIP =
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 bg-primary/10 text-primary border-primary/20"

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

  const titleText = isReady ? draft.summary ?? "Ready" : draft.input

  return (
    <div className="relative rounded-lg border border-border bg-card hover:bg-muted/40 hover:shadow-sm transition-all overflow-hidden">
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1",
          RAIL[draft.status as keyof typeof RAIL] ?? "bg-muted",
        )}
      />

      <div className="pl-4 pr-3 py-3 flex items-start gap-3">
        <div
          role={bodyClickable ? "button" : undefined}
          tabIndex={bodyClickable ? 0 : -1}
          onClick={handleBodyClick}
          onKeyDown={handleBodyKeyDown}
          className={cn("flex-1 min-w-0", bodyClickable && "cursor-pointer")}
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
