"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Sparkles, Check, X, Loader2 } from "lucide-react"
import { buildPageContext } from "@/lib/copilot/context"
import { useQueueCommand, useCompleteDraft, useCopilotDrafts } from "./use-copilot-drafts"

/**
 * AI Co-pilot. Rendered as the same 187N command-palette panel as the ⌘K
 * search (`.cmd-overlay` / `.cmd-panel`) so the two surfaces feel identical -
 * same width, backdrop, chrome. Opens via the `copilot:open` event (from the
 * palette's Actions group) or ⌘J; no standalone button.
 *
 * Flow: type a command → ↵ → a quick loading bar in the panel → the proposed
 * action loads inline with a green ✓ (create) and a red ✗ (discard).
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
  const inputRef = useRef<HTMLInputElement>(null)

  const queueCommand = useQueueCommand()
  const completeDraft = useCompleteDraft()
  const draftsQ = useCopilotDrafts()
  const activeDraft = activeDraftId
    ? draftsQ.data?.drafts.find((d) => d.id === activeDraftId) ?? null
    : null

  // Opened from the ⌘K palette (with an optional prefill) or via ⌘J.
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

  // Reset + focus per open, seeding any prefill from the palette.
  useEffect(() => {
    if (open) {
      setInput(prefillRef.current)
      prefillRef.current = ""
      setActiveDraftId(null)
      setSubmitError(null)
      setDone(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Poll while the active draft is still processing (realtime broadcast usually
  // beats this; the interval is a safety net so the ✓/✗ appears fast).
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

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
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
        // Non-fatal.
      }
    }
  }, [activeDraftId, completeDraft])

  const isProcessing = !!activeDraftId && (!activeDraft || activeDraft.status === "pending")
  const isReady = activeDraft?.status === "ready"
  const isFailed = activeDraft?.status === "failed"
  const isIdle = !isProcessing && !isReady && !isFailed && !done && !submitError

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className="cmd-overlay open" onMouseDown={() => setOpen(false)}>
      <div className="cmd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-search">
          <Sparkles />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Ask the AI Co-pilot — e.g. “Maak een taak voor Mike, vandaag”"
            disabled={isProcessing}
          />
          <button type="button" className="esc" onClick={() => setOpen(false)}>
            ESC
          </button>
        </div>

        <div className="cmd-results">
          {submitError && (
            <div className="rounded-md bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
              {submitError}
            </div>
          )}

          {isProcessing && (
            <div className="px-2 py-2">
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
            <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
              <span>{activeDraft.error ?? "Kon deze command niet verwerken."}</span>
              <button type="button" onClick={dismiss} aria-label="Sluit" className="shrink-0 opacity-70 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {done && (
            <div className="flex items-center gap-2 rounded-md bg-[var(--st-live-tint)] px-3 py-2.5 text-[13px] font-medium text-[var(--st-live)]">
              <Check className="h-4 w-4" />
              Aangemaakt
            </div>
          )}

          {isIdle && (
            <div className="cmd-empty">
              Type a command and press ↵ — e.g. “Maak een taak voor Mike, vandaag, nieuwe creatives op de winning angle”.
            </div>
          )}
        </div>

        <div className="cmd-foot">
          {isProcessing ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> processing
            </span>
          ) : (
            <span>
              <kbd>↵</kbd> run
            </span>
          )}
          <span>
            <kbd>esc</kbd> close
          </span>
          <span style={{ marginLeft: "auto" }}>AI Co-pilot · Rocket Leads</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
