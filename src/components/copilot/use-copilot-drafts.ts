"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CopilotAction, CopilotDraft } from "@/lib/copilot/tools"

/**
 * Co-pilot drafts hook. Backed by /api/copilot/drafts and invalidated
 * automatically by the existing broadcast channel: when the server
 * flips a draft from pending → ready (or → failed) it calls
 * broadcastInvalidate(['copilot-drafts']) and this hook refetches.
 *
 * `useRealtimeInvalidation` is already mounted in providers.tsx so we
 * don't need a per-component channel here.
 */
export function useCopilotDrafts() {
  return useQuery<{ drafts: CopilotDraft[] }>({
    queryKey: ["copilot-drafts"],
    queryFn: async () => {
      const res = await fetch("/api/copilot/drafts")
      if (!res.ok) throw new Error("Failed to load drafts")
      return res.json()
    },
    staleTime: 30_000,
  })
}

/** Patch the action JSON on a draft (used by the Edit dialog before approve). */
export function usePatchDraftAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: CopilotAction }) => {
      const res = await fetch(`/api/copilot/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error("Failed to patch draft")
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot-drafts"] }),
  })
}

/** Mark a draft approved/dismissed (terminal state). Optimistically
 *  removes the row from the local cache so the UI feels instant -
 *  Roy 2026-05-22: "When I press dismiss it doesn't go away directly."
 *  Rolls back on server error; resyncs from server on settle. */
export function useCompleteDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "dismissed" }) => {
      const res = await fetch(`/api/copilot/drafts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error("Failed to complete draft")
    },
    onMutate: async ({ id }) => {
      // Cancel any in-flight refetch so it doesn't overwrite our optimistic
      // patch on the way back.
      await qc.cancelQueries({ queryKey: ["copilot-drafts"] })
      const prev = qc.getQueryData<{ drafts: CopilotDraft[] }>(["copilot-drafts"])
      if (prev) {
        qc.setQueryData<{ drafts: CopilotDraft[] }>(
          ["copilot-drafts"],
          { drafts: prev.drafts.filter((d) => d.id !== id) },
        )
      }
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      // Roll back to the snapshot if the server rejected the mutation.
      if (ctx?.prev) qc.setQueryData(["copilot-drafts"], ctx.prev)
    },
    onSettled: () => {
      // Always resync with the server (will be a no-op when the broadcast
      // already invalidated us, but cheap insurance against drift).
      void qc.invalidateQueries({ queryKey: ["copilot-drafts"] })
    },
  })
}

/** Queue a new command. Returns immediately with the draft id. */
export function useQueueCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      input,
      context,
    }: {
      input: string
      context: { pathname: string; currentClientId: string | null; currentClientTab: string | null }
    }) => {
      const res = await fetch("/api/copilot/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input, context }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Queue failed" }))
        throw new Error(err.error ?? "Queue failed")
      }
      return res.json() as Promise<{ draftId: string; status: "pending" }>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["copilot-drafts"] }),
  })
}
