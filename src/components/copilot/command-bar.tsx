"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Sparkles, Check, X, ArrowRight, Loader2 } from "lucide-react"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import { useQueueCommand, useCompleteDraft, useCopilotDrafts } from "./use-copilot-drafts"

type DoneInfo = { summary: string; message: string; link: string | null }

/**
 * AI Co-pilot. Rendered as the same 187N command-palette panel as the ⌘K
 * search (`.cmd-overlay` / `.cmd-panel`). Opens via the `copilot:open` event
 * (palette Actions group) or ⌘J.
 *
 * Flow: type a command → ↵ → loading bar → the proposed action loads inline
 * with a green ✓ (create) / red ✗ (discard). On ✓ the action actually runs
 * client-side (executeAction creates the task), then a persistent confirmation
 * shows what was created + a link to view it. No auto-close.
 */
export function CommandBar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const qc = useQueryClient()

  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [doneInfo, setDoneInfo] = useState<DoneInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const queueCommand = useQueueCommand()
  const completeDraft = useCompleteDraft()
  const draftsQ = useCopilotDrafts()
  const activeDraft = activeDraftId
    ? draftsQ.data?.drafts.find((d) => d.id === activeDraftId) ?? null
    : null

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

  useEffect(() => {
    if (open) {
      setInput(prefillRef.current)
      prefillRef.current = ""
      setActiveDraftId(null)
      setSubmitError(null)
      setDoneInfo(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

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
    setDoneInfo(null)
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

  // Approve = actually RUN the action (creates the task client-side), then
  // record the draft as approved for the audit trail. Persistent confirmation.
  const approve = useCallback(async () => {
    const draft = activeDraft
    if (!draft?.draftAction || !activeDraftId || approving) return
    setSubmitError(null)
    setApproving(true)
    try {
      const result = await executeAction(draft.draftAction, router)
      if (!result.ok) {
        setSubmitError(result.message)
        return
      }
      void completeDraft.mutateAsync({ id: activeDraftId, status: "approved" }).catch(() => {})
      setDoneInfo({
        summary: draft.summary ?? result.message,
        message: result.message,
        link: result.navigateTo ?? null,
      })
      setActiveDraftId(null)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Aanmaken mislukt.")
    } finally {
      setApproving(false)
    }
  }, [activeDraft, activeDraftId, approving, completeDraft, router])

  const dismiss = useCallback(async () => {
    const id = activeDraftId
    setActiveDraftId(null)
    setDoneInfo(null)
    if (id) {
      try {
        await completeDraft.mutateAsync({ id, status: "dismissed" })
      } catch {
        // Non-fatal.
      }
    }
  }, [activeDraftId, completeDraft])

  const goto = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const isProcessing = !!activeDraftId && (!activeDraft || activeDraft.status === "pending")
  const isReady = activeDraft?.status === "ready"
  const isFailed = activeDraft?.status === "failed"
  const isIdle = !isProcessing && !isReady && !isFailed && !doneInfo && !submitError

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
            disabled={isProcessing || approving}
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
                  disabled={approving}
                  aria-label="Aanmaken"
                >
                  {approving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Aanmaken
                </button>
                <button
                  type="button"
                  className="cmd-reject"
                  onClick={dismiss}
                  disabled={approving}
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

          {/* Persistent confirmation - shows what was created + a link to it. */}
          {doneInfo && (
            <div className="rounded-md border border-[color-mix(in_srgb,var(--st-live)_22%,transparent)] bg-[var(--st-live-tint)] px-3.5 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--st-live)]">
                <Check className="h-4 w-4" />
                {doneInfo.message || "Aangemaakt"}
              </div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-foreground">{doneInfo.summary}</div>
              <div className="mt-3 flex items-center gap-2">
                {doneInfo.link && (
                  <button
                    type="button"
                    onClick={() => goto(doneInfo.link!)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--st-live)] px-3 text-[12px] font-semibold text-white hover:brightness-105"
                  >
                    Bekijk in Inbox
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium text-foreground/80 hover:bg-muted/60"
                >
                  Klaar
                </button>
              </div>
            </div>
          )}

          {isIdle && (
            <div className="cmd-empty">
              Type a command and press ↵ — e.g. “Maak een taak voor Mike, vandaag, nieuwe creatives op de winning angle”.
            </div>
          )}
        </div>

        <div className="cmd-foot">
          {isProcessing || approving ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> {approving ? "creating" : "processing"}
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
