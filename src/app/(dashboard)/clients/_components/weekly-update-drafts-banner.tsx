"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Sparkles, X, Send, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ClientUpdateDialog, type ClientUpdateDraftSeed } from "./client-update-button"
import type { WeeklyUpdateDraftListResponse, WeeklyUpdateDraftListItem } from "@/app/api/weekly-update-drafts/route"

/**
 * Monday-morning weekly-update queue surface.
 *
 * Banner shows when the current user has pending drafts (created by the
 * `weekly-update-drafts` cron). Click → overlay lists every draft they
 * can act on. Clicking a row opens the existing Client Update dialog
 * pre-filled with that draft's snapshotted parts; on successful send,
 * the dialog PATCHes the draft to status='sent' which removes it from
 * the queue on the next refetch.
 *
 * Hidden entirely when there are zero pending drafts — we don't want
 * persistent UI noise on a Tuesday when the queue is empty.
 */
export function WeeklyUpdateDraftsBanner() {
  const queryClient = useQueryClient()
  const [overlayOpen, setOverlayOpen] = useState(false)
  /** When set, the Client Update dialog is open for this draft. The queue
   *  overlay stays mounted underneath but visually hidden (overlay's own
   *  open=false), so closing the dialog returns the user to the queue. */
  const [activeDraft, setActiveDraft] = useState<WeeklyUpdateDraftListItem | null>(null)

  const draftsQuery = useQuery<WeeklyUpdateDraftListResponse>({
    queryKey: ["weekly-update-drafts"],
    queryFn: () => fetch("/api/weekly-update-drafts").then((r) => r.json()),
    // Refresh every 5min so a draft sent from another tab/AM disappears
    // without a hard reload.
    staleTime: 5 * 60 * 1000,
  })

  const dismissMutation = useMutation({
    mutationFn: async (draftId: string) => {
      await fetch(`/api/weekly-update-drafts/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "dismissed" }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
    },
  })

  const count = draftsQuery.data?.count ?? 0
  if (count === 0 && !draftsQuery.isPending) return null

  const seed: ClientUpdateDraftSeed | undefined = activeDraft
    ? {
        draftId: activeDraft.id,
        parts: activeDraft.parts,
        channel: activeDraft.channel,
        templateVersion: activeDraft.templateVersion,
        templateName: activeDraft.templateName,
      }
    : undefined

  return (
    <>
      <button
        type="button"
        onClick={() => setOverlayOpen(true)}
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

      {/* Queue overlay — list of drafts. Stays mounted while individual
          draft dialogs open on top, so closing returns here. */}
      <Dialog
        open={overlayOpen && !activeDraft}
        onOpenChange={(next) => {
          if (!next) setOverlayOpen(false)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              Wekelijkse updates ({count})
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 mt-4">
            {draftsQuery.isPending && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Drafts laden…
              </div>
            )}
            {draftsQuery.data?.drafts.map((draft) => (
              <DraftRow
                key={draft.id}
                draft={draft}
                onOpen={() => setActiveDraft(draft)}
                onDismiss={() => dismissMutation.mutate(draft.id)}
                isDismissing={dismissMutation.isPending && dismissMutation.variables === draft.id}
              />
            ))}
            {draftsQuery.data && draftsQuery.data.drafts.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Geen drafts voor jouw klanten op dit moment.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Client Update dialog, opened from a draft. Mounts on top of the
          queue overlay and unmounts on close so the queue is re-visible. */}
      {activeDraft && seed && (
        <ClientUpdateDialog
          mondayItemId={activeDraft.mondayItemId}
          clientName={activeDraft.clientName}
          open={!!activeDraft}
          onOpenChange={(next) => {
            if (!next) setActiveDraft(null)
          }}
          draftSeed={seed}
          onDraftResolved={() => {
            // Already invalidated inside the dialog; redundant here is
            // cheap and guards against races.
            void queryClient.invalidateQueries({ queryKey: ["weekly-update-drafts"] })
          }}
        />
      )}
    </>
  )
}

function DraftRow({
  draft,
  onOpen,
  onDismiss,
  isDismissing,
}: {
  draft: WeeklyUpdateDraftListItem
  onOpen: () => void
  onDismiss: () => void
  isDismissing: boolean
}) {
  const channelLabel =
    draft.channel === "whatsapp" ? "WhatsApp" : draft.channel === "email" ? "Email" : "—"
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{draft.clientName}</p>
        <p className="text-[11px] text-muted-foreground/70">
          {channelLabel}
          {draft.templateName ? (
            <>
              {" · "}
              <code className="font-mono">{draft.templateName}</code>
              <span
                className={
                  "ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium " +
                  (draft.templateVersion === 2
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400")
                }
              >
                V{draft.templateVersion}
              </span>
            </>
          ) : null}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={isDismissing}
        title="Dismiss"
        className="text-muted-foreground/50 hover:text-red-500 transition-colors p-1 disabled:opacity-30"
      >
        {isDismissing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/5 px-2.5 py-1 text-[11px] font-medium text-violet-500 hover:bg-violet-500/10 hover:border-violet-500/50 transition-colors"
      >
        <Send className="h-3 w-3" />
        Open
      </button>
    </div>
  )
}
