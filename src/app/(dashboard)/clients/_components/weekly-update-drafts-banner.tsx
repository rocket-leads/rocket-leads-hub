"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Sparkles, X, Send, Loader2, Check, MessageCircle, Mail } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ContextNoteCard,
  WhatsAppPreview,
  EmailPreview,
  reshapeForV2,
} from "./client-update-button"
import type { EditableParts } from "@/lib/clients/client-update-template"
import type {
  WeeklyUpdateDraftListResponse,
  WeeklyUpdateDraftListItem,
} from "@/app/api/weekly-update-drafts/route"

/**
 * Monday-morning weekly-update queue surface — banner + split-pane sheet.
 *
 * Banner: compact button showing the pending count. Click to open the sheet.
 * Hidden when count is zero — we don't want persistent UI noise on a
 * Tuesday when the queue is empty.
 *
 * Sheet: full-width dialog with two panes:
 *   - LEFT (sidebar, ~300px): scrollable list of pending drafts. Each row
 *     shows the company name + contact first name + AM. Click swaps the
 *     right pane to that draft. The first draft is auto-selected on open
 *     so the AM lands directly in an editor instead of an extra click.
 *   - RIGHT (editor, flex-1): the existing inline composer (Extra Context
 *     card + WhatsApp/Email preview + footer + action buttons). Edits are
 *     held per-draft in a Map so switching between rows doesn't discard
 *     work in progress.
 *
 * Send / Dismiss live at the bottom of the right pane. On success we
 * remove the draft from the local list (optimistic) AND fire a refetch
 * so the global count stays in sync across tabs.
 */
export function WeeklyUpdateDraftsBanner() {
  const queryClient = useQueryClient()
  const [sheetOpen, setSheetOpen] = useState(false)

  const draftsQuery = useQuery<WeeklyUpdateDraftListResponse>({
    queryKey: ["weekly-update-drafts"],
    queryFn: () => fetch("/api/weekly-update-drafts").then((r) => r.json()),
    staleTime: 5 * 60 * 1000,
  })

  const count = draftsQuery.data?.count ?? 0
  if (count === 0 && !draftsQuery.isPending) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="w-full flex items-center gap-3 rounded-lg border border-violet-500/30 bg-gradient-to-r from-violet-500/5 to-violet-500/[0.02] px-4 py-2.5 text-left hover:from-violet-500/10 hover:to-violet-500/5 hover:border-violet-500/50 transition-all"
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-500/15 shrink-0">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {count} wekelijkse update{count === 1 ? "" : "s"} te verzenden
          </p>
          <p className="text-[11px] text-muted-foreground/70">
            Pre-gegenereerd op maandag — klik om te reviewen en versturen.
          </p>
        </div>
        <span className="text-[11px] text-violet-500 font-medium">Open queue →</span>
      </button>

      {sheetOpen && (
        <WeeklyUpdateQueueSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          drafts={draftsQuery.data?.drafts ?? []}
          onDraftConsumed={() => {
            void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
            void queryClient.invalidateQueries({ queryKey: ["last-client-updates"] })
          }}
        />
      )}
    </>
  )
}

// ─── Split-pane queue sheet ─────────────────────────────────────────────

function WeeklyUpdateQueueSheet({
  open,
  onOpenChange,
  drafts,
  onDraftConsumed,
}: {
  open: boolean
  onOpenChange: (next: boolean) => void
  drafts: WeeklyUpdateDraftListItem[]
  onDraftConsumed: () => void
}) {
  // User-clicked draft id. When null, the active draft is derived as the
  // first visible draft (auto-select on open + auto-advance after a send).
  // Storing the user pick separately keeps the derivation pure and avoids
  // a setState-in-effect cascade.
  const [userPickedId, setUserPickedId] = useState<string | null>(null)
  // Per-draft edited parts so switching between rows keeps work in progress.
  // Initialised lazily from each draft's snapshotted parts (with V2 reshape
  // applied — see `reshapeForV2` for what that does).
  const [editedByDraft, setEditedByDraft] = useState<Record<string, EditableParts>>({})
  // Track which drafts are gone (sent or dismissed) so they disappear
  // from the list immediately, even before the server refetch completes.
  const [consumedIds, setConsumedIds] = useState<Set<string>>(new Set())

  const visibleDrafts = useMemo(
    () => drafts.filter((d) => !consumedIds.has(d.id)),
    [drafts, consumedIds],
  )

  // Derived active id: user pick if still visible, else first visible draft.
  // This collapses "auto-select first on open" and "auto-advance after send"
  // into one pure derivation — no useEffect race conditions.
  const activeId =
    userPickedId && visibleDrafts.some((d) => d.id === userPickedId)
      ? userPickedId
      : visibleDrafts[0]?.id ?? null

  const activeDraft = activeId ? drafts.find((d) => d.id === activeId) ?? null : null
  const activeParts = useMemo(() => {
    if (!activeDraft) return null
    if (editedByDraft[activeDraft.id]) return editedByDraft[activeDraft.id]
    return activeDraft.templateVersion === 2
      ? reshapeForV2(activeDraft.parts)
      : activeDraft.parts
  }, [activeDraft, editedByDraft])

  const setActiveParts = (next: EditableParts) => {
    if (!activeDraft) return
    setEditedByDraft((prev) => ({ ...prev, [activeDraft.id]: next }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px] w-[95vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">
          Wekelijkse updates ({visibleDrafts.length})
        </DialogTitle>
        <header className="flex items-center justify-between border-b border-border/60 px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-4 w-4 text-violet-500 shrink-0" />
            <h2 className="text-sm font-semibold truncate">
              Wekelijkse updates · {visibleDrafts.length}
              {visibleDrafts.length === 1 ? " open" : " open"}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md p-1 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar with draft list */}
          <aside className="w-[300px] border-r border-border/60 shrink-0 overflow-y-auto">
            {visibleDrafts.length === 0 && (
              <p className="text-sm text-muted-foreground p-4 text-center">
                Alles verzonden ✨
              </p>
            )}
            <ul className="py-2">
              {visibleDrafts.map((d) => (
                <li key={d.id}>
                  <DraftSidebarRow
                    draft={d}
                    active={d.id === activeId}
                    onClick={() => setUserPickedId(d.id)}
                    edited={!!editedByDraft[d.id]}
                  />
                </li>
              ))}
            </ul>
          </aside>

          {/* Editor pane */}
          <section className="flex-1 flex flex-col min-w-0">
            {activeDraft && activeParts ? (
              <ActiveDraftEditor
                draft={activeDraft}
                parts={activeParts}
                setParts={setActiveParts}
                onResolved={(id) => {
                  setConsumedIds((prev) => {
                    const next = new Set(prev)
                    next.add(id)
                    return next
                  })
                  onDraftConsumed()
                  // If this was the last remaining draft, auto-close the
                  // sheet shortly after the "Sent ✓" state is visible.
                  const remaining = visibleDrafts.filter((d) => d.id !== id)
                  if (remaining.length === 0) {
                    setTimeout(() => onOpenChange(false), 800)
                  }
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                Geen draft geselecteerd.
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DraftSidebarRow({
  draft,
  active,
  onClick,
  edited,
}: {
  draft: WeeklyUpdateDraftListItem
  active: boolean
  onClick: () => void
  edited: boolean
}) {
  const channelIcon = draft.channel === "email" ? Mail : MessageCircle
  const ChannelIcon = channelIcon
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 border-l-2 transition-colors flex items-start gap-2.5",
        active
          ? "border-violet-500 bg-violet-500/8"
          : "border-transparent hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "mt-0.5 h-6 w-6 rounded-md flex items-center justify-center shrink-0",
          draft.channel === "email"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        )}
        title={draft.channel}
      >
        <ChannelIcon className="h-3 w-3" />
      </div>
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm font-medium truncate",
            active ? "text-foreground" : "text-foreground/90",
          )}
        >
          {draft.clientName}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {draft.contactFirstName ? `${draft.contactFirstName} · ` : ""}
          {draft.accountManager || "—"}
        </p>
      </div>
      {edited && (
        <span
          className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-500"
          title="Bewerkt sinds geopend"
        />
      )}
    </button>
  )
}

// ─── Active editor pane ──────────────────────────────────────────────────

function ActiveDraftEditor({
  draft,
  parts,
  setParts,
  onResolved,
}: {
  draft: WeeklyUpdateDraftListItem
  parts: EditableParts
  setParts: (next: EditableParts) => void
  onResolved: (draftId: string) => void
}) {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isV2 = draft.templateVersion === 2
  const isEmail = draft.channel === "email"

  // Re-derive the AM's first name from the template slug so the WhatsApp
  // sign-off in the preview matches what the customer will receive.
  const amSignOffName = useMemo(() => {
    if (!draft.templateName) return "…"
    const slug = draft.templateName.replace(/^rl_(weekly|universal)_/i, "").trim()
    if (!slug) return "…"
    return slug.charAt(0).toUpperCase() + slug.slice(1)
  }, [draft.templateName])

  // Frozen at mount per draft — looks like "now" when the AM opens the
  // editor. Reads draft.id so the linter sees the dep and so re-mounting
  // for a different draft does refresh the displayed time.
  const timestamp = useMemo(() => {
    void draft.id
    const d = new Date()
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }, [draft.id])

  const sendMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      const message = renderForSend(parts)
      const res = await fetch(`/api/clients/${draft.mondayItemId}/send-client-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, subject: parts.subject, parts }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(err.message ?? err.error ?? "Verzenden mislukt")
      }
      const data = (await res.json()) as { outboundMsgId?: string }
      // Mark the draft consumed in the queue table. Fire-and-forget: a
      // flake here doesn't roll back the actual send.
      try {
        await fetch(`/api/weekly-update-drafts/${draft.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "sent",
            sentMessageId: data.outboundMsgId,
          }),
        })
      } catch {
        // intentional swallow
      }
      return data
    },
    onSuccess: () => {
      setSent(true)
      // Brief "Sent ✓" state before the parent yanks this row from the
      // sidebar; the parent's effect also auto-selects the next draft.
      setTimeout(() => onResolved(draft.id), 600)
    },
    onError: (e: Error) => setError(e.message),
  })

  const dismissMutation = useMutation({
    mutationFn: async () => {
      setError(null)
      await fetch(`/api/weekly-update-drafts/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      })
    },
    onSuccess: () => onResolved(draft.id),
    onError: (e: Error) => setError(e.message),
  })

  const inputsDisabled = sendMutation.isPending || sent

  return (
    <>
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{draft.clientName}</h3>
          <p className="text-[11px] text-muted-foreground/70">
            {draft.contactFirstName ? `${draft.contactFirstName} · ` : ""}
            AM: {draft.accountManager || "—"}
          </p>
        </div>
        {draft.templateName && (
          <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {draft.templateName}
          </code>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <ContextNoteCard parts={parts} setParts={setParts} inputsDisabled={inputsDisabled} />
        {isEmail ? (
          <EmailPreview parts={parts} setParts={setParts} inputsDisabled={inputsDisabled} />
        ) : (
          <WhatsAppPreview
            parts={parts}
            setParts={setParts}
            inputsDisabled={inputsDisabled}
            amSignOffName={amSignOffName}
            timestamp={timestamp}
            isV2={isV2}
          />
        )}
        {error && (
          <div className="mx-5 my-3 rounded-md border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-500 leading-relaxed">{error}</p>
          </div>
        )}
      </div>

      <footer className="border-t border-border/60 px-5 py-3 flex items-center justify-between shrink-0 bg-muted/20 dark:bg-zinc-900/40">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dismissMutation.mutate()}
          disabled={inputsDisabled || dismissMutation.isPending}
        >
          {dismissMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : null}
          Dismiss
        </Button>
        <Button
          size="sm"
          onClick={() => sendMutation.mutate()}
          disabled={inputsDisabled || sendMutation.isPending}
          className="bg-violet-500 hover:bg-violet-600 text-white"
        >
          {sent ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Verzonden
            </>
          ) : sendMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Versturen…
            </>
          ) : (
            <>
              <Send className="h-3.5 w-3.5 mr-1.5" />
              Verstuur
            </>
          )}
        </Button>
      </footer>
    </>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Mirror of `renderFromParts` from the template module — duplicated here
 *  to avoid a deep import chain from a client component into a route
 *  type. Keep the two in sync if you change the join rules. */
function renderForSend(parts: EditableParts): string {
  const blocks: string[] = []
  const pushIf = (s: string | undefined) => {
    const t = (s ?? "").trim()
    if (t) blocks.push(t)
  }
  pushIf(parts.opener)
  pushIf(parts.intro)
  pushIf(parts.kpiBlock)
  pushIf(parts.trendSentence)
  pushIf(parts.note)
  pushIf(parts.conclusion)
  const validActions = (parts.actions ?? []).map((a) => a.trim()).filter(Boolean)
  if (validActions.length > 0) {
    const lines: string[] = []
    if (parts.actionsHeader?.trim()) lines.push(parts.actionsHeader.trim())
    lines.push(...validActions.map((a) => `• ${a}`))
    blocks.push(lines.join("\n"))
  }
  pushIf(parts.signOff)
  return blocks.join("\n\n").trim()
}
