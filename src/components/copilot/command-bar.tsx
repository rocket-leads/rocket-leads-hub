"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Sparkles, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotDraft } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"
import { useCompleteDraft, useQueueCommand } from "./use-copilot-drafts"
import { DraftsPanel } from "./drafts-panel"
import { ConfirmDialog } from "./confirm-dialog"

type UserRow = { id: string; name: string | null; email: string; role: string | null }

/**
 * AI Co-pilot command bar (⌘J).
 *
 * Roy's flow (2026-05-22):
 *   1. Hit ⌘J → big input opens
 *   2. Type / dictate (Wispr Flow types into here like any input)
 *   3. Press Enter → command queued, dialog closes immediately
 *   4. Server enriches in background (~5-10s)
 *   5. 🔔 bell badge bumps when the draft is ready to approve
 *
 * Navigation commands ("open Vlex Vending") are fast-pathed - those go
 * through the queue too but quick to land, and the user can still use
 * the bell. We don't try to detect navigate intent client-side; let the
 * LLM classify and let the bell handle approval consistently.
 *
 * The editable confirmation flow lives in confirm-dialog.tsx and is
 * opened from the bell when the user clicks Edit.
 */
export function CommandBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  // Optimistic queue list: each submit pushes one entry until the server
  // returns, then it gets popped (the real draft from the refetched query
  // takes its place). Lets Roy fire several commands back-to-back without
  // waiting on the previous round-trip - the textarea stays open and each
  // command surfaces as a "Queuing…" placeholder in the drafts panel.
  const [pendingInputs, setPendingInputs] = useState<
    Array<{ tempId: string; text: string }>
  >([])
  const queueCommand = useQueueCommand()
  const completeDraft = useCompleteDraft()

  // Draft editor state lives here (not in DraftsPanel) so it survives the
  // parent Dialog closing. Clicking a draft used to close the parent which
  // unmounted the panel before the editor could appear — Roy 2026-06-12.
  const [editingDraft, setEditingDraft] = useState<CopilotDraft | null>(null)
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
      // Non-fatal - the editor still renders with raw ids.
    }
  }, [])

  function openEditor(draft: CopilotDraft) {
    void loadRoster()
    // Close the command bar so the editor takes the modal surface; the
    // back-arrow in ConfirmDialog re-opens it.
    setOpen(false)
    setEditingDraft(draft)
  }

  function backToCommandBar() {
    setEditingDraft(null)
    setOpen(true)
  }

  // ⌘J / Ctrl+J opens from anywhere; Esc closes.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault()
        setOpen((p) => !p)
      }
      if (e.key === "Escape" && open) setOpen(false)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [open])

  // Opened from the ⌘K palette ("Ask AI Co-pilot" / "Create task") - the
  // palette dispatches `copilot:open` with an optional prefill. The standalone
  // button is gone; this event + ⌘J are the entry points now.
  const prefillRef = useRef("")
  useEffect(() => {
    function onOpen(e: Event) {
      prefillRef.current = (e as CustomEvent<{ prefill?: string }>).detail?.prefill ?? ""
      setOpen(true)
    }
    window.addEventListener("copilot:open", onOpen as EventListener)
    return () => window.removeEventListener("copilot:open", onOpen as EventListener)
  }, [])

  // Reset on open - seed with any prefill handed in by the palette.
  useEffect(() => {
    if (open) {
      setInput(prefillRef.current)
      prefillRef.current = ""
    }
  }, [open])

  const submit = useCallback(async () => {
    if (!input.trim()) return
    const userInput = input.trim()
    const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
    const context = buildPageContext(pathname ?? "/", sp)

    // Roy 2026-06-12: dialog stays open and the textarea stays unlocked
    // during the round-trip - the "Queuing…" indicator appears as a
    // placeholder row in the drafts panel instead of disabling the form.
    // Lets the user dictate multiple commands back-to-back.
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    setInput("")
    setPendingInputs((prev) => [...prev, { tempId, text: userInput }])

    try {
      await queueCommand.mutateAsync({ input: userInput, context })
    } catch (e) {
      console.error("Queue failed:", e instanceof Error ? e.message : "unknown error")
    } finally {
      setPendingInputs((prev) => prev.filter((p) => p.tempId !== tempId))
    }
  }, [input, queueCommand, pathname, searchParams])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <>
      {/* No standalone trigger button anymore - the Co-pilot is merged into the
          ⌘K command palette (Actions group). Opens via `copilot:open` + ⌘J. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-heading text-base font-medium">AI Co-pilot</span>
            </div>
            <AutoTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Wat moet er gebeuren? Bijv. 'Maak een taak voor Mike, vandaag, om nieuwe creatives te maken op de winning angle voor deze klant'"
              minRows={3}
              maxRows={10}
              autoFocus
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> to queue ·{" "}
                <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for newline
              </span>
              <Button onClick={submit} disabled={!input.trim()} size="sm">
                Queue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* Drafts panel - always rendered (Roy 2026-06-12) so the user
                sees the panel even when empty, and the in-flight Queuing…
                indicator surfaces here instead of locking the input. */}
            <DraftsPanel
              onEditDraft={openEditor}
              pendingInputs={pendingInputs}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Editor sits outside the command bar Dialog so it survives the
          parent close — and the back-arrow in its header returns to the
          command bar without losing draft state. */}
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
        onDismiss={async (id) => {
          await completeDraft.mutateAsync({ id, status: "dismissed" })
          setEditingDraft(null)
        }}
        onBack={backToCommandBar}
      />
    </>
  )
}

// Re-export executeAction so any future component-level callers can use it
// without reaching into the lib path directly.
export { executeAction }
