"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Sparkles, ArrowRight, Check, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { buildPageContext } from "@/lib/copilot/context"
import { useQueueCommand, useCompleteDraft, useCopilotDrafts } from "./use-copilot-drafts"

/**
 * AI Co-pilot composer. Lives on the ⌘K command palette (Actions group) and
 * opens via the `copilot:open` event or ⌘J — no standalone button.
 *
 * Flow (Roy 2026-07): type a command → Queue → a quick loading bar in the SAME
 * popup → the proposed action loads inline with a green ✓ (create) and a red ✗
 * (discard). One command, one draft, approve/reject on the spot. No drafts
 * list, no bell, no separate editor.
 */
export function CommandBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const queueCommand = useQueueCommand()
  const completeDraft = useCompleteDraft()
  const draftsQ = useCopilotDrafts()
  const activeDraft = activeDraftId
    ? draftsQ.data?.drafts.find((d) => d.id === activeDraftId) ?? null
    : null

  // Opened from the ⌘K palette ("Ask AI Co-pilot" / "Create task") with an
  // optional prefill, or via ⌘J.
  const prefillRef = useRef("")
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

  useEffect(() => {
    function onOpen(e: Event) {
      prefillRef.current = (e as CustomEvent<{ prefill?: string }>).detail?.prefill ?? ""
      setOpen(true)
    }
    window.addEventListener("copilot:open", onOpen as EventListener)
    return () => window.removeEventListener("copilot:open", onOpen as EventListener)
  }, [])

  // Reset per open, seeding any prefill from the palette.
  useEffect(() => {
    if (open) {
      setInput(prefillRef.current)
      prefillRef.current = ""
      setActiveDraftId(null)
      setSubmitError(null)
      setDone(false)
    }
  }, [open])

  // Poll while the active draft is still processing (the realtime broadcast
  // usually beats this; the interval is a safety net so the ✓/✗ appears fast).
  const activeStatus = activeDraft?.status
  useEffect(() => {
    if (!activeDraftId) return
    if (activeDraft && activeStatus !== "pending") return
    const t = setInterval(() => void qc.invalidateQueries({ queryKey: ["copilot-drafts"] }), 1200)
    return () => clearInterval(t)
  }, [activeDraftId, activeStatus, activeDraft, qc])

  const submit = useCallback(async () => {
    if (!input.trim() || queueCommand.isPending) return
    const userInput = input.trim()
    const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
    const context = buildPageContext(pathname ?? "/", sp)
    setInput("")
    setSubmitError(null)
    setDone(false)
    setActiveDraftId(null)
    try {
      const res = await queueCommand.mutateAsync({ input: userInput, context })
      setActiveDraftId(res.draftId)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Kon deze command niet verwerken.")
    }
  }, [input, queueCommand, pathname, searchParams])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const approve = useCallback(async () => {
    if (!activeDraftId) return
    try {
      await completeDraft.mutateAsync({ id: activeDraftId, status: "approved" })
      setActiveDraftId(null)
      setDone(true)
      // Close shortly after the "created" confirmation so the flow feels quick.
      setTimeout(() => setOpen(false), 850)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Aanmaken mislukt.")
    }
  }, [activeDraftId, completeDraft])

  const dismiss = useCallback(async () => {
    const id = activeDraftId
    setActiveDraftId(null)
    setDone(false)
    if (id) {
      try {
        await completeDraft.mutateAsync({ id, status: "dismissed" })
      } catch {
        // Non-fatal - the row just stays server-side until the next sweep.
      }
    }
  }, [activeDraftId, completeDraft])

  const isProcessing = !!activeDraftId && (!activeDraft || activeDraft.status === "pending")
  const isReady = activeDraft?.status === "ready"
  const isFailed = activeDraft?.status === "failed"

  return (
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
            disabled={queueCommand.isPending || isProcessing}
          />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Enter</kbd> to queue ·{" "}
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">Shift+Enter</kbd> for newline
            </span>
            <Button
              onClick={submit}
              disabled={!input.trim() || queueCommand.isPending || isProcessing}
              size="sm"
            >
              {queueCommand.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  Queue <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>

          {submitError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {submitError}
            </div>
          )}

          {isProcessing && (
            <div>
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Aan het nadenken…
              </div>
              <div className="cmd-progress">
                <span />
              </div>
            </div>
          )}

          {isReady && activeDraft && (
            <div className="cmd-draft">
              <div className="cmd-draft-body">{activeDraft.summary}</div>
              <div className="cmd-draft-actions">
                <button
                  type="button"
                  className="cmd-approve"
                  onClick={approve}
                  disabled={completeDraft.isPending}
                  aria-label="Aanmaken"
                >
                  <Check className="h-4 w-4" />
                  Aanmaken
                </button>
                <button
                  type="button"
                  className="cmd-reject"
                  onClick={dismiss}
                  disabled={completeDraft.isPending}
                  aria-label="Annuleer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {isFailed && activeDraft && (
            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <span>{activeDraft.error ?? "Kon deze command niet verwerken."}</span>
              <button type="button" onClick={dismiss} aria-label="Sluit" className="shrink-0 opacity-70 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-md bg-[var(--st-live-tint)] px-3 py-2 text-[13px] font-medium text-[var(--st-live)]">
              <Check className="h-4 w-4" />
              Aangemaakt
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
