"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Sparkles, Loader2, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import { useQueueCommand } from "./use-copilot-drafts"
import { DraftsPanel, useCopilotDraftsBadge } from "./drafts-panel"

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

  const submit = useCallback(async () => {
    if (!input.trim() || queueCommand.isPending) return
    const userInput = input.trim()
    const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
    const context = buildPageContext(pathname ?? "/", sp)

    // Roy 2026-06-12: dialog stays open after submit. The user watches the
    // freshly-queued draft appear in the Drafts panel below as "Processing"
    // and flips to Ready in-place, so they can approve right there without
    // reopening anything. Clear the input so a second command can be
    // dictated immediately.
    setInput("")

    try {
      await queueCommand.mutateAsync({ input: userInput, context })
    } catch (e) {
      console.error("Queue failed:", e instanceof Error ? e.message : "unknown error")
    }
  }, [input, queueCommand, pathname, searchParams])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const badgeCount = useCopilotDraftsBadge()

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Brand-purple chrome (Roy 2026-06-11 v2): the AI Co-pilot is
        // where the CM actually creates tasks + updates, so it gets the
        // primary purple. Roy 2026-06-12: the notification bell merged
        // into this surface, so the badge counter that lived on the bell
        // now sits here - one button, one place to look.
        className="relative flex items-center gap-2 h-10 rounded-lg border border-primary/40 bg-primary/10 px-3.5 text-sm text-primary hover:bg-primary/20 hover:border-primary/60 transition-colors"
        aria-label="Open AI co-pilot"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-[10px] font-medium text-primary/80">
          <span className="text-xs">⌘</span>J
        </kbd>
        {badgeCount > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground shadow-sm"
            aria-label={`${badgeCount} drafts ready`}
          >
            {badgeCount}
          </span>
        )}
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
            {/* Drafts panel - drafts queue lives directly below the input
                so the user watches their submission appear as Processing
                and flip to Ready in-place. Renders nothing when the queue
                is empty so the dialog stays compact for new users. */}
            <DraftsPanel onParentOpenChange={setOpen} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// Re-export executeAction so any future component-level callers can use it
// without reaching into the lib path directly.
export { executeAction }
