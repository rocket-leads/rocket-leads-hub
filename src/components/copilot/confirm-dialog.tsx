"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction, CopilotDraft } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"

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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CopilotDraft | null
  users: UserRow[]
  clients: ClientSearchResult[]
  /** Called after the executor runs successfully. Caller marks the draft approved
   *  + closes the dialog. The action passed back reflects user edits. */
  onApprove: (draftId: string, finalAction: CopilotAction) => Promise<void>
}) {
  const router = useRouter()
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

  if (!draft || !editAction) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-heading text-base font-medium">Confirm action</span>
          </div>
          {draft.summary && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground italic">
              AI parsed: {draft.summary}
            </div>
          )}
          {draft.sourcesUsed.length > 0 && (
            <div className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary/80">
              <span className="font-medium">Context used:</span> {draft.sourcesUsed.join(" · ")}
            </div>
          )}

          {editAction.type === "create_task" && (
            <CreateTaskFields draft={editAction} onChange={setEditAction} users={users} clients={clients} />
          )}
          {editAction.type === "trigger_pedro_refresh" && (
            <PedroRefreshFields draft={editAction} onChange={setEditAction} clients={clients} />
          )}
          {editAction.type === "navigate_to_client" && (
            <NavigateFields draft={editAction} onChange={setEditAction} clients={clients} />
          )}

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={executing}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} disabled={executing}>
              {executing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                </>
              ) : editAction.type === "create_task" ? (
                "Approve & create"
              ) : editAction.type === "trigger_pedro_refresh" ? (
                "Approve & run Pedro"
              ) : (
                "Open"
              )}
            </Button>
          </div>
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
}: {
  draft: Extract<CopilotAction, { type: "create_task" }>
  onChange: (d: CopilotAction) => void
  users: UserRow[]
  clients: ClientSearchResult[]
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
      <Field label="Title">
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label="Body (optional)">
        <AutoTextarea
          value={draft.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
          minRows={3}
          maxRows={12}
          placeholder="Extra context - KPI numbers, ad names, why this matters"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Client">
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">- No client -</option>
            {clients.map((c) => (
              <option key={c.mondayItemId} value={c.mondayItemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select
            value={draft.assigneeId}
            onChange={(e) => update({ assigneeId: e.target.value })}
            className={fieldClass}
          >
            <option value="">- Pick someone -</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Due date">
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(e) => update({ dueDate: e.target.value || undefined })}
            className={fieldClass}
          />
        </Field>
        <Field label="Priority">
          <select
            value={draft.priority ?? "normal"}
            onChange={(e) => update({ priority: e.target.value as "low" | "normal" | "high" })}
            className={fieldClass}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
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
}: {
  draft: Extract<CopilotAction, { type: "trigger_pedro_refresh" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label="Client">
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
      <Field label="Lookback (days)">
        <input
          type="number"
          min={7}
          max={90}
          value={draft.days ?? 30}
          onChange={(e) => update({ days: Number(e.target.value) || 30 })}
          className={fieldClass}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        This can take 40-90 seconds. The result will be saved as a Pedro deliverable and shown on the
        client&apos;s Campaigns tab.
      </p>
    </div>
  )
}

function NavigateFields({
  draft,
  onChange,
  clients,
}: {
  draft: Extract<CopilotAction, { type: "navigate_to_client" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label="Client">
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
      <Field label="Tab">
        <select
          value={draft.tab ?? "campaigns"}
          onChange={(e) =>
            update({ tab: e.target.value as "campaigns" | "billing" | "communication" | "settings" })
          }
          className={fieldClass}
        >
          <option value="campaigns">Campaigns</option>
          <option value="billing">Billing</option>
          <option value="communication">Communication</option>
          <option value="settings">Settings</option>
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
