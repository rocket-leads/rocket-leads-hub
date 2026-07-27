"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, Trash2, X, ArrowLeft } from "lucide-react"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction, CopilotDraft } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { ActionFields, type UserRow } from "./action-fields"

/**
 * Editable confirmation dialog. Opened from the notification bell when
 * the user clicks "Edit" on a ready draft. The original parse + enrich
 * pre-filled all fields - this dialog lets the user tweak before approving.
 *
 * On confirm: PATCHes the draft action (so the audit trail reflects what
 * actually shipped), runs the client-side executor, and marks the draft
 * approved.
 *
 * Roy 2026-07-27: the per-action field editors now live in action-fields.tsx
 * so the ⌘K → Co-pilot command palette can share them for inline editing.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  draft,
  users,
  clients,
  onApprove,
  onDismiss,
  onBack,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CopilotDraft | null
  users: UserRow[]
  clients: ClientSearchResult[]
  /** Called after the executor runs successfully. Caller marks the draft approved
   *  + closes the dialog. The action passed back reflects user edits. */
  onApprove: (draftId: string, finalAction: CopilotAction) => Promise<void>
  /** Called when the user clicks the trash icon in the header. Caller marks
   *  the draft dismissed (queue side) and closes the dialog. */
  onDismiss?: (draftId: string) => Promise<void>
  /** When provided, renders a back-arrow in the header that calls this and
   *  closes the editor without dismissing the draft. Used to return to the
   *  Copilot drafts list. */
  onBack?: () => void
}) {
  const router = useRouter()
  const locale = useLocale()
  const [editAction, setEditAction] = useState<CopilotAction | null>(null)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && draft?.draftAction) {
      setEditAction(draft.draftAction)
      setError(null)
    } else if (!open) {
      setEditAction(null)
      setError(null)
      setExecuting(false)
    }
  }, [open, draft?.id, draft?.draftAction])

  async function confirm() {
    if (!draft || !editAction) return
    setExecuting(true)
    setError(null)
    try {
      const result = await executeAction(editAction, router)
      if (!result.ok) {
        setError(result.message)
        setExecuting(false)
        return
      }
      await onApprove(draft.id, editAction)
      onOpenChange(false)
      if (result.navigateTo) router.push(result.navigateTo)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execution failed")
      setExecuting(false)
    }
  }

  async function dismiss() {
    if (!draft || !onDismiss) {
      onOpenChange(false)
      return
    }
    try {
      await onDismiss(draft.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dismiss failed")
    }
  }

  if (!draft || !editAction) return null

  // The "what will happen on approve" verb. Used as the green check's
  // tooltip / aria-label so the icon still telegraphs the consequence.
  const approveLabel =
    editAction.type === "create_task"
      ? t("copilot.confirm.btn.create_task", locale)
      : editAction.type === "create_reminder"
        ? t("copilot.confirm.btn.schedule_reminder", locale)
        : editAction.type === "trigger_pedro_refresh"
          ? t("copilot.confirm.btn.run_pedro", locale)
          : editAction.type === "create_calendar_event"
            ? t("copilot.confirm.btn.create_event", locale)
            : t("copilot.confirm.btn.open", locale)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl p-0 overflow-hidden gap-0"
      >
        {/* Header bar - clean action cluster only. Roy 2026-06-12: no AI
            Draft chip, no Ready pill, no "AI parsed" line - the form fields
            below carry every editable piece of info, the chips were just
            noise. Back-arrow on the left (when caller provides onBack) so
            the user can return to the Copilot drafts list without having
            to close the entire surface. */}
        <div className="flex items-center justify-between gap-3 border-b border-border/40 bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-1 shrink-0">
            {onBack && (
              <button
                type="button"
                onClick={() => onBack()}
                disabled={executing}
                aria-label={t("copilot.confirm.back", locale)}
                title={t("copilot.confirm.back", locale)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ActionIconButton
              tone="success"
              label={approveLabel}
              onClick={(e) => {
                e.preventDefault()
                confirm()
              }}
              disabled={executing}
              icon={
                executing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )
              }
            />
            <ActionIconButton
              tone="danger"
              label={t("copilot.confirm.dismiss", locale)}
              onClick={(e) => {
                e.preventDefault()
                dismiss()
              }}
              disabled={executing}
              icon={<Trash2 className="h-4 w-4" />}
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={executing}
              aria-label={t("copilot.confirm.close", locale)}
              title={t("copilot.confirm.close", locale)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body - just the form fields. Roy 2026-06-12: stripped the AI
            parsed summary + sources-used line so this surface stays clean.
            The form below is the canonical view of what will be created. */}
        <div className="flex flex-col gap-3 px-5 py-4">
          <ActionFields action={editAction} onChange={setEditAction} users={users} clients={clients} />

          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
