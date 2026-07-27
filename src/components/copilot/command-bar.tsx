"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { Sparkles, Check, X, ArrowRight, Loader2, Users } from "lucide-react"
import { buildPageContext } from "@/lib/copilot/context"
import { executeAction } from "@/lib/copilot/executors"
import type { CopilotAction } from "@/lib/copilot/tools"
import { ActionFields, useCopilotRosters } from "./action-fields"
import {
  useQueueCommand,
  useCompleteDraft,
  usePatchDraftAction,
  useCopilotDrafts,
} from "./use-copilot-drafts"

type DoneInfo = { summary: string; message: string; link: string | null }

/**
 * AI Co-pilot. Rendered as the same 187N command-palette panel as the ⌘K
 * search (`.cmd-overlay` / `.cmd-panel`). Opens via the `copilot:open` event
 * (palette Actions group) or ⌘J.
 *
 * Flow (Roy 2026-07-27):
 *   1. ⌘K palette → "Ask AI Co-pilot" hands the typed command here as a
 *      prefill. We AUTO-SUBMIT it — no second Enter, straight to thinking.
 *   2. "Thinking…" loading bar (spans the queue POST + server parse, so the
 *      handoff never flashes the idle hint) while the server parses + enriches.
 *   3. The proposed action loads inline as an EDITABLE form (client,
 *      assignee, due date, …). The user tweaks the variables, then
 *      ✓ Aanmaken (runs the executor) or ✗ discard.
 *   4. Persistent confirmation showing what was created + a link to view it.
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
  // Local, editable copy of the ready draft's action. Seeded once per draft
  // from the server parse, then owned by the form until approve/discard.
  const [editAction, setEditAction] = useState<CopilotAction | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const initedDraftRef = useRef<string | null>(null)

  const queueCommand = useQueueCommand()
  const completeDraft = useCompleteDraft()
  const patchDraftAction = usePatchDraftAction()
  const draftsQ = useCopilotDrafts()
  const { users, clients } = useCopilotRosters()
  const activeDraft = activeDraftId
    ? draftsQ.data?.drafts.find((d) => d.id === activeDraftId) ?? null
    : null

  const submit = useCallback(
    async (raw?: string) => {
      const userInput = (raw ?? input).trim()
      if (!userInput || queueCommand.isPending) return
      const sp = searchParams ? new URLSearchParams(searchParams.toString()) : null
      const context = buildPageContext(pathname ?? "/", sp)
      setInput("")
      setSubmitError(null)
      setDoneInfo(null)
      setEditAction(null)
      initedDraftRef.current = null
      setActiveDraftId(null)
      try {
        const res = await queueCommand.mutateAsync({ input: userInput, context })
        setActiveDraftId(res.draftId)
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : "Kon deze command niet verwerken.")
      }
    },
    [input, queueCommand, pathname, searchParams],
  )

  // Latest `submit` without retriggering the open effect (which is keyed on
  // `open` alone) - lets the prefill auto-submit call the current closure.
  const submitRef = useRef(submit)
  useEffect(() => {
    submitRef.current = submit
  }, [submit])

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
    if (!open) return
    const prefill = prefillRef.current.trim()
    prefillRef.current = ""
    setInput("")
    setActiveDraftId(null)
    setSubmitError(null)
    setDoneInfo(null)
    setEditAction(null)
    initedDraftRef.current = null
    if (prefill) {
      // Came from the ⌘K palette with a command already typed → skip the
      // input entirely and go straight to "Aan het nadenken…".
      void submitRef.current(prefill)
    } else {
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

  // Seed the editable form once, the moment the draft turns ready. Keyed on
  // the draft id so re-renders (or drafts-query refetches) don't clobber the
  // user's in-progress edits.
  useEffect(() => {
    if (
      activeDraft?.status === "ready" &&
      activeDraft.draftAction &&
      initedDraftRef.current !== activeDraft.id
    ) {
      setEditAction(activeDraft.draftAction)
      initedDraftRef.current = activeDraft.id
    }
  }, [activeDraft?.status, activeDraft?.id, activeDraft?.draftAction])

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      void submit()
    }
  }

  // Approve = actually RUN the (edited) action, persist the edits to the draft
  // for the audit trail, then mark it approved. Persistent confirmation.
  const approve = useCallback(async () => {
    if (!editAction || !activeDraftId || approving) return
    setSubmitError(null)
    setApproving(true)
    try {
      const result = await executeAction(editAction, router)
      if (!result.ok) {
        setSubmitError(result.message)
        return
      }
      // Record what actually shipped (edits included), then mark approved.
      void patchDraftAction.mutateAsync({ id: activeDraftId, action: editAction }).catch(() => {})
      void completeDraft.mutateAsync({ id: activeDraftId, status: "approved" }).catch(() => {})
      setDoneInfo({
        summary: activeDraft?.summary ?? result.message,
        message: result.message,
        link: result.navigateTo ?? null,
      })
      setActiveDraftId(null)
      setEditAction(null)
      initedDraftRef.current = null
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Aanmaken mislukt.")
    } finally {
      setApproving(false)
    }
  }, [editAction, activeDraft, activeDraftId, approving, completeDraft, patchDraftAction, router])

  // Disambiguation choice: the user clicked one of the candidate clients.
  // Record the draft as approved for the audit trail and navigate there.
  const chooseClient = useCallback(
    (clientId: string) => {
      if (activeDraftId) {
        void completeDraft.mutateAsync({ id: activeDraftId, status: "approved" }).catch(() => {})
      }
      void executeAction({ type: "navigate_to_client", clientId }, router)
      setOpen(false)
    },
    [activeDraftId, completeDraft, router],
  )

  const dismiss = useCallback(async () => {
    const id = activeDraftId
    setActiveDraftId(null)
    setDoneInfo(null)
    setEditAction(null)
    initedDraftRef.current = null
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

  // "Thinking" spans the whole gap with no visible state in between: from the
  // moment the queue POST is in-flight (queueCommand.isPending) through the
  // server parsing the draft (status pending). Without the isPending half, the
  // ~2s POST would fall through to the idle hint - the flash the ⌘K handoff hit.
  const isProcessing =
    queueCommand.isPending || (!!activeDraftId && (!activeDraft || activeDraft.status === "pending"))
  // Ready is driven by draft status alone (not editAction) so the idle hint
  // never flashes in the one frame between status→ready and the seed effect
  // populating editAction. The ready block itself guards on editAction.
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
                Thinking…
              </div>
              <div className="cmd-progress">
                <span />
              </div>
            </div>
          )}

          {/* Disambiguation - the input matched several clients (or a typo).
              Render the candidates as clickable buttons; a click opens that
              client. Solution-first: no error, no raw ids, clients only. */}
          {isReady && editAction?.type === "choose_client" && (
            <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
              <div className="border-b border-border/40 bg-muted/30 px-3.5 py-2.5 text-[13px] text-foreground">
                {editAction.question}
              </div>
              <div className="p-2 space-y-1">
                {editAction.options.map((opt) => (
                  <button
                    key={opt.clientId}
                    type="button"
                    onClick={() => chooseClient(opt.clientId)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[14px] text-foreground hover:bg-muted/60 transition-colors"
                  >
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{opt.name}</span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={dismiss}
                  className="w-full rounded-md px-3 py-1.5 text-left text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
                >
                  Geen van deze
                </button>
              </div>
            </div>
          )}

          {/* Editable proposal - the user reviews + tweaks the variables
              (client, assignee, due date, …) then approves or discards. */}
          {isReady && activeDraft && editAction && editAction.type !== "choose_client" && (
            <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/30 px-3.5 py-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3 w-3 text-primary" />
                  Review &amp; edit
                </span>
                <div className="flex items-center gap-1.5">
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
              <div className="px-3.5 py-3">
                <ActionFields action={editAction} onChange={setEditAction} users={users} clients={clients} />
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
