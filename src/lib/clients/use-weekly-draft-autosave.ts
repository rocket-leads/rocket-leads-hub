"use client"

import { useCallback, useEffect, useRef } from "react"
import type { EditableParts } from "@/lib/clients/client-update-template"

/**
 * Autosave any in-flight EditableParts edits back to a `weekly_update_drafts`
 * row via PATCH. Used by both the queue banner editor and the per-client
 * Client Update dialog so an AM never loses work when:
 *
 *   - they edit the message, click Send, and Trengo errors mid-flight
 *   - they edit, change tab, then close it
 *   - they hard-reload the browser mid-edit
 *
 * What the hook does:
 *   1. Debounced save (800ms) on every `parts` change after the seed
 *   2. Immediate save via `flushNow()` - the caller invokes this from the
 *      sendMutation `onError` so the latest edit is safe even before the
 *      AM can read the error toast
 *   3. Unmount flush - catches "close the sheet right after typing"
 *   4. `beforeunload` flush via `keepalive: true` - catches hard reloads
 *      and tab closes (regular `fetch` is killed when the page unloads;
 *      keepalive keeps the request alive for up to 64KB after navigation)
 *
 * Caller passes `suspendDuring` (typically the in-flight + sent flags)
 * so we don't clobber the row while the send transition is mid-flight
 * or after the row has already flipped to status='sent'.
 *
 * Drafts with `draftId === null` are no-op: ad-hoc sends (no underlying
 * draft) have nowhere to write. The hook short-circuits cleanly so the
 * dialog can use it unconditionally without branching.
 *
 * Roy 2026-05-23: Danny lost edits after a Trengo send failed. Earlier
 * versions only had debounced autosave in the queue editor - the
 * per-client dialog had none, and even the queue editor relied on the
 * unmount flush which doesn't fire on hard reload.
 */
export function useWeeklyDraftAutosave(args: {
  draftId: string | null
  parts: EditableParts | null
  /** When true, the hook suspends all saves. Pass `isSending || sent` so
   *  we don't overwrite the row during the send→sent transition. */
  suspendDuring: boolean
}): { flushNow: () => Promise<boolean> } {
  const { draftId, parts, suspendDuring } = args

  // Refs keep the latest values addressable from cleanup + event handlers
  // without re-binding them every render. The autosave effect itself
  // depends on parts so it still fires on edits.
  const draftIdRef = useRef(draftId)
  const partsRef = useRef(parts)
  const suspendRef = useRef(suspendDuring)
  const seedRef = useRef(parts)

  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])
  useEffect(() => {
    partsRef.current = parts
  }, [parts])
  useEffect(() => {
    suspendRef.current = suspendDuring
  }, [suspendDuring])

  // First non-null parts becomes the "seed" we compare against so the
  // initial render of an existing draft doesn't trigger a save.
  useEffect(() => {
    if (seedRef.current === null && parts !== null) {
      seedRef.current = parts
    }
  }, [parts])

  // Imperative save the caller can fire on the send-error path.
  const flushNow = useCallback(async (): Promise<boolean> => {
    const id = draftIdRef.current
    const p = partsRef.current
    if (!id || !p) return false
    return savePartsToDraft(id, p, { keepalive: false })
  }, [])

  // Debounced save on every edit.
  useEffect(() => {
    if (suspendDuring) return
    if (!draftId || !parts) return
    if (parts === seedRef.current) return // initial render - nothing to save
    const handle = setTimeout(() => {
      void savePartsToDraft(draftId, parts, { keepalive: false })
    }, 800)
    return () => clearTimeout(handle)
  }, [parts, draftId, suspendDuring])

  // Unmount flush + beforeunload flush. Both pull from the refs so the
  // most recent edit always wins. beforeunload uses keepalive so the
  // request survives the page going away.
  useEffect(() => {
    function flushKeepalive() {
      if (suspendRef.current) return
      const id = draftIdRef.current
      const p = partsRef.current
      if (!id || !p) return
      if (p === seedRef.current) return
      void savePartsToDraft(id, p, { keepalive: true })
    }
    window.addEventListener("beforeunload", flushKeepalive)
    return () => {
      window.removeEventListener("beforeunload", flushKeepalive)
      flushKeepalive()
    }
  }, [])

  return { flushNow }
}

async function savePartsToDraft(
  draftId: string,
  parts: EditableParts,
  opts: { keepalive: boolean },
): Promise<boolean> {
  try {
    const res = await fetch(`/api/weekly-update-drafts/${draftId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parts }),
      // `keepalive: true` lets the browser keep this fetch alive past
      // navigation / page-unload - required for the beforeunload path
      // because a normal fetch gets aborted the moment the page goes
      // away, taking the last edit with it.
      keepalive: opts.keepalive,
    })
    return res.ok
  } catch {
    return false
  }
}
