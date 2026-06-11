"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import { Sparkles, Loader2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import { useQueueCommand } from "./use-copilot-drafts"

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
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const queueCommand = useQueueCommand()

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

  // Reset on open.
  useEffect(() => {
    if (open) setInput("")
  }, [open])

  // Auto-clear toast after 4s.
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const submit = useCallback(async () => {
    if (!input.trim() || queueCommand.isPending) return
    const userInput = input.trim()
    const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
    const context = buildPageContext(pathname ?? "/", sp)

    // Optimistically close the dialog so the user can keep working -
    // the actual queue insert happens in parallel.
    setOpen(false)
    setToast(`Working on "${truncate(userInput, 60)}"… Check 🔔 when ready.`)

    try {
      await queueCommand.mutateAsync({ input: userInput, context })
    } catch (e) {
      setToast(`Queue failed: ${e instanceof Error ? e.message : "unknown error"}`)
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Brand-purple chrome (Roy 2026-06-11 v2): the AI Co-pilot is
        // where the CM actually creates tasks + updates, so it gets the
        // primary purple. NotificationBell stays neutral (passive
        // "look at this" surface) and the weekly-update chip stays
        // neutral (scheduled deliverable, not AI).
        className="flex items-center gap-2 h-10 rounded-lg border border-primary/40 bg-primary/10 px-3.5 text-sm text-primary hover:bg-primary/20 hover:border-primary/60 transition-colors"
        aria-label="Open AI co-pilot"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-medium text-primary/80">
          <span className="text-xs">⌘</span>J
        </kbd>
      </button>

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
              disabled={queueCommand.isPending}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> to queue ·{" "}
                <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for newline
              </span>
              <Button onClick={submit} disabled={!input.trim() || queueCommand.isPending} size="sm">
                {queueCommand.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queuing…
                  </>
                ) : (
                  <>
                    Queue <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground/70 -mt-1">
              Dialog sluit direct. Je krijgt een melding 🔔 zodra het concept klaar is om te
              approven.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {toast && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed bottom-6 right-6 z-[60] max-w-sm rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-xl">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
              <div className="flex-1">{toast}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…"
}

// Re-export executeAction so any future component-level callers can use it
// without reaching into the lib path directly.
export { executeAction }
