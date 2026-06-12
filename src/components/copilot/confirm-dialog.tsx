"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, Trash2, X, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionIconButton } from "@/components/ui/action-icon-button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction, CopilotDraft } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

type UserRow = { id: string; name: string | null; email: string; role: string | null }

/**
 * Editable confirmation dialog. Opened from the notification bell when
 * the user clicks "Edit" on a ready draft. The original parse + enrich
 * pre-filled all fields - this dialog lets the user tweak before approving.
 *
 * On confirm: PATCHes the draft action (so the audit trail reflects what
 * actually shipped), runs the client-side executor, and marks the draft
 * approved.
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
          {editAction.type === "create_task" && (
            <CreateTaskFields draft={editAction} onChange={setEditAction} users={users} clients={clients} locale={locale} />
          )}
          {editAction.type === "create_reminder" && (
            <CreateReminderFields draft={editAction} onChange={setEditAction} clients={clients} locale={locale} />
          )}
          {editAction.type === "trigger_pedro_refresh" && (
            <PedroRefreshFields draft={editAction} onChange={setEditAction} clients={clients} locale={locale} />
          )}
          {editAction.type === "navigate_to_client" && (
            <NavigateFields draft={editAction} onChange={setEditAction} clients={clients} locale={locale} />
          )}

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


// ─── Per-action field editors ─────────────────────────────────────────────

function CreateTaskFields({
  draft,
  onChange,
  users,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "create_task" }>
  onChange: (d: CopilotAction) => void
  users: UserRow[]
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })

  // Pre-fill due date with today if AI didn't pick one (matches existing
  // inbox composer behaviour - tasks require a due date).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  useEffect(() => {
    if (!draft.dueDate) update({ dueDate: today })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.title", locale)}>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={t("copilot.field.body_optional", locale)}>
        <AutoTextarea
          value={draft.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
          minRows={3}
          maxRows={12}
          placeholder={t("copilot.field.body_placeholder_task", locale)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.client", locale)}>
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.client_none", locale)}</option>
            {clients.map((c) => (
              <option key={c.mondayItemId} value={c.mondayItemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("copilot.field.assignee", locale)}>
          <select
            value={draft.assigneeId}
            onChange={(e) => update({ assigneeId: e.target.value })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.assignee_none", locale)}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.due_date", locale)}>
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(e) => update({ dueDate: e.target.value || undefined })}
            className={fieldClass}
          />
        </Field>
        <Field label={t("copilot.field.priority", locale)}>
          <select
            value={draft.priority ?? "normal"}
            onChange={(e) => update({ priority: e.target.value as "low" | "normal" | "high" })}
            className={fieldClass}
          >
            <option value="low">{t("copilot.field.priority_low", locale)}</option>
            <option value="normal">{t("copilot.field.priority_normal", locale)}</option>
            <option value="high">{t("copilot.field.priority_high", locale)}</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

function CreateReminderFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "create_reminder" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.kind", locale)}>
        <select
          value={draft.kind}
          onChange={(e) => update({ kind: e.target.value as "task" | "update" })}
          className={fieldClass}
        >
          <option value="task">{t("copilot.field.kind_task", locale)}</option>
          <option value="update">{t("copilot.field.kind_update", locale)}</option>
        </select>
      </Field>
      <Field label={t("copilot.field.title", locale)}>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={t("copilot.field.body_optional", locale)}>
        <AutoTextarea
          value={draft.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
          minRows={2}
          maxRows={10}
          placeholder={t("copilot.field.body_placeholder_reminder", locale)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.remind_on", locale)}>
          <input
            type="date"
            value={draft.remindAt}
            onChange={(e) => update({ remindAt: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label={t("copilot.field.client", locale)}>
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.client_none", locale)}</option>
            {clients.map((c) => (
              <option key={c.mondayItemId} value={c.mondayItemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}

function PedroRefreshFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "trigger_pedro_refresh" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.client", locale)}>
        <select
          value={draft.clientId}
          onChange={(e) => update({ clientId: e.target.value })}
          className={fieldClass}
        >
          {clients.map((c) => (
            <option key={c.mondayItemId} value={c.mondayItemId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("copilot.field.lookback_days", locale)}>
        <input
          type="number"
          min={7}
          max={90}
          value={draft.days ?? 30}
          onChange={(e) => update({ days: Number(e.target.value) || 30 })}
          className={fieldClass}
        />
      </Field>
      <p className="text-xs text-muted-foreground">{t("copilot.pedro.eta_hint", locale)}</p>
    </div>
  )
}

function NavigateFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "navigate_to_client" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.client", locale)}>
        <select
          value={draft.clientId}
          onChange={(e) => update({ clientId: e.target.value })}
          className={fieldClass}
        >
          {clients.map((c) => (
            <option key={c.mondayItemId} value={c.mondayItemId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("copilot.field.tab", locale)}>
        <select
          value={draft.tab ?? "campaigns"}
          onChange={(e) =>
            update({ tab: e.target.value as "campaigns" | "billing" | "communication" | "settings" })
          }
          className={fieldClass}
        >
          <option value="campaigns">{t("copilot.field.tab.campaigns", locale)}</option>
          <option value="billing">{t("copilot.field.tab.billing", locale)}</option>
          <option value="communication">{t("copilot.field.tab.communication", locale)}</option>
          <option value="settings">{t("copilot.field.tab.settings", locale)}</option>
        </select>
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const fieldClass = cn(
  "w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm outline-none transition-colors",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
)
