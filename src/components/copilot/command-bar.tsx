"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import { Sparkles, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction, CopilotParseResult } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"

type UserRow = { id: string; name: string | null; email: string; role: string | null }

type Phase = "input" | "loading" | "confirm" | "executing" | "done"

/**
 * AI Co-pilot command bar — global ⌘J overlay where the user types or
 * dictates (via Wispr Flow at the OS level) a natural-language command.
 * The server parses intent into a structured action; the user always
 * confirms in an editable card before execution.
 *
 * v1 actions: create_task, trigger_pedro_refresh, navigate_to_client.
 * Mounted from the dashboard layout so it's reachable from every page.
 */
export function CommandBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>("input")
  const [input, setInput] = useState("")
  const [parseResult, setParseResult] = useState<CopilotParseResult | null>(null)
  const [draft, setDraft] = useState<CopilotAction | null>(null)
  const [resultMessage, setResultMessage] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  // Roster used by editable dropdowns in the confirmation card. Fetched
  // once per session — both endpoints are cheap and the data is stable
  // across commands.
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
      if (uRes.ok) {
        const j = await uRes.json()
        setUsers(j.users ?? [])
      }
      if (cRes.ok) {
        const j = await cRes.json()
        setClients(Array.isArray(j) ? j : [])
      }
    } catch {
      // Non-fatal — confirmation card will still render with raw ids.
    }
  }, [])

  // ⌘J / Ctrl+J opens from anywhere; Esc closes. Skip when modifier-less
  // J would interfere with typing in another field (we only open with
  // the modifier, so plain "j" in textareas is unaffected).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
      if (e.key === "Escape" && open) setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  // Reset to clean state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setPhase("input")
      setInput("")
      setParseResult(null)
      setDraft(null)
      setResultMessage("")
      setError(null)
      void loadRoster()
    }
  }, [open, loadRoster])

  async function submitInput() {
    if (!input.trim()) return
    setPhase("loading")
    setError(null)
    try {
      const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
      const context = buildPageContext(pathname ?? "/", sp)
      const res = await fetch("/api/copilot/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim(), context }),
      })
      const result = (await res.json()) as CopilotParseResult
      setParseResult(result)
      if (result.ok) {
        setDraft(result.action)
        setPhase("confirm")
      } else {
        setError(result.message)
        setPhase("input")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Parse failed")
      setPhase("input")
    }
  }

  async function confirmAndExecute() {
    if (!draft) return
    setPhase("executing")
    setError(null)
    try {
      const result = await executeAction(draft, router)
      if (result.ok) {
        setResultMessage(result.message)
        setPhase("done")
        // Auto-close after a brief beat; navigate if requested.
        setTimeout(() => {
          if (result.navigateTo) router.push(result.navigateTo)
          setOpen(false)
        }, 800)
      } else {
        setError(result.message)
        setPhase("confirm")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Execution failed")
      setPhase("confirm")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 h-10 rounded-lg border border-border bg-card px-3.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors shadow-[0_1px_2px_0_rgb(0_0_0_/_0.03)]"
        aria-label="Open AI co-pilot"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-border/60 bg-muted/60 px-1.5 text-[10px] font-medium text-muted-foreground/70">
          <span className="text-xs">⌘</span>J
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl" showCloseButton={phase === "input"}>
          {phase === "input" || phase === "loading" ? (
            <InputView
              input={input}
              onInputChange={setInput}
              onSubmit={submitInput}
              loading={phase === "loading"}
              error={error}
            />
          ) : phase === "confirm" || phase === "executing" ? (
            <ConfirmView
              draft={draft!}
              onDraftChange={setDraft}
              users={users}
              clients={clients}
              onConfirm={confirmAndExecute}
              onCancel={() => setPhase("input")}
              executing={phase === "executing"}
              originalSummary={parseResult?.ok ? parseResult.summary : ""}
              sourcesUsed={parseResult?.ok ? parseResult.sourcesUsed ?? [] : []}
              error={error}
            />
          ) : (
            <DoneView message={resultMessage} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function InputView({
  input,
  onInputChange,
  onSubmit,
  loading,
  error,
}: {
  input: string
  onInputChange: (v: string) => void
  onSubmit: () => void
  loading: boolean
  error: string | null
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-heading text-base font-medium">AI Co-pilot</span>
      </div>
      <AutoTextarea
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Wat moet er gebeuren? Bijv. 'Maak een taak voor Mike, vandaag, om nieuwe creatives te maken op de winning angle voor deze klant'"
        minRows={3}
        maxRows={10}
        autoFocus
        disabled={loading}
      />
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> to submit ·{" "}
          <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for newline
        </span>
        <Button onClick={onSubmit} disabled={!input.trim() || loading} size="sm">
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading context…
            </>
          ) : (
            "Parse"
          )}
        </Button>
      </div>
    </div>
  )
}

function ConfirmView({
  draft,
  onDraftChange,
  users,
  clients,
  onConfirm,
  onCancel,
  executing,
  originalSummary,
  sourcesUsed,
  error,
}: {
  draft: CopilotAction
  onDraftChange: (d: CopilotAction) => void
  users: UserRow[]
  clients: ClientSearchResult[]
  onConfirm: () => void
  onCancel: () => void
  executing: boolean
  originalSummary: string
  sourcesUsed: string[]
  error: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-heading text-base font-medium">Confirm action</span>
      </div>
      {originalSummary && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground italic">
          AI parsed: {originalSummary}
        </div>
      )}
      {sourcesUsed.length > 0 && (
        <div className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary/80">
          <span className="font-medium">Context used:</span> {sourcesUsed.join(" · ")}
        </div>
      )}

      {draft.type === "create_task" && (
        <CreateTaskFields draft={draft} onChange={onDraftChange} users={users} clients={clients} />
      )}
      {draft.type === "trigger_pedro_refresh" && (
        <PedroRefreshFields draft={draft} onChange={onDraftChange} clients={clients} />
      )}
      {draft.type === "navigate_to_client" && (
        <NavigateFields draft={draft} onChange={onDraftChange} clients={clients} />
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={executing}>
          Back
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={executing}>
          {executing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
            </>
          ) : draft.type === "create_task" ? (
            "Create task"
          ) : draft.type === "trigger_pedro_refresh" ? (
            "Run Pedro"
          ) : (
            "Open"
          )}
        </Button>
      </div>
    </div>
  )
}

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
  // composer behaviour — tasks require a due date).
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
          minRows={2}
          maxRows={8}
          placeholder="Extra context — KPI numbers, ad names, why this matters"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Client">
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">— No client —</option>
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
            <option value="">— Pick someone —</option>
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
        client's Campaigns tab.
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

function DoneView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
        ✓
      </div>
      <p className="text-sm">{message}</p>
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
