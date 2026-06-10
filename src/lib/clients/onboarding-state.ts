import { createAdminClient } from "@/lib/supabase/server"
import type { StoredStepRow } from "./onboarding"

/**
 * Storage layer for the onboarding wizard. Reads/writes rows in
 * `client_onboarding_tasks` (key: monday_item_id + task_key). Output
 * data for a step (brief JSON, email body, etc.) lives in the `content`
 * column so the wizard can prefill prior work on revisit.
 */

/**
 * Fetch stored step rows for one client. Returns a Map (task_key →
 * stored row) so the registry's `resolveWizardState` can do O(1) lookups
 * while merging with derived state. Empty map on missing/error — derived
 * steps still resolve fine.
 */
export async function fetchStoredSteps(
  mondayItemId: string,
): Promise<Map<string, StoredStepRow>> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("client_onboarding_tasks")
    .select("task_key, done, completed_at, completed_by, content")
    .eq("monday_item_id", mondayItemId)

  const map = new Map<string, StoredStepRow>()
  if (!data) return map
  for (const row of data) {
    map.set(row.task_key as string, {
      done: row.done as boolean,
      completedAt: row.completed_at as string | null,
      completedBy: row.completed_by as string | null,
      content: row.content,
    })
  }
  return map
}

/**
 * Batched fetch for the cross-client overview. Returns
 * Map<mondayItemId, Map<task_key, row>> so the overview can compute
 * progress + missing-critical for every onboarding client in one
 * Supabase round-trip instead of N+1.
 */
export async function fetchStoredStepsBulk(
  mondayItemIds: string[],
): Promise<Map<string, Map<string, StoredStepRow>>> {
  const result = new Map<string, Map<string, StoredStepRow>>()
  if (mondayItemIds.length === 0) return result

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("client_onboarding_tasks")
    .select("monday_item_id, task_key, done, completed_at, completed_by, content")
    .in("monday_item_id", mondayItemIds)

  for (const id of mondayItemIds) result.set(id, new Map())
  if (!data) return result

  for (const row of data) {
    const id = row.monday_item_id as string
    let inner = result.get(id)
    if (!inner) {
      inner = new Map()
      result.set(id, inner)
    }
    inner.set(row.task_key as string, {
      done: row.done as boolean,
      completedAt: row.completed_at as string | null,
      completedBy: row.completed_by as string | null,
      content: row.content,
    })
  }
  return result
}

/**
 * Persist a step's state — done flag, optional content blob, completed
 * timestamps. Idempotent: re-saving with the same `done` value only
 * touches `updated_at`. Set `done=false` to revert; `completed_*` are
 * cleared so the audit reflects the latest state.
 */
export async function saveStepState(args: {
  mondayItemId: string
  stepKey: string
  done: boolean
  content?: unknown
  userId: string
}): Promise<StoredStepRow> {
  const supabase = await createAdminClient()
  const now = new Date().toISOString()

  const payload: Record<string, unknown> = {
    monday_item_id: args.mondayItemId,
    task_key: args.stepKey,
    done: args.done,
    completed_at: args.done ? now : null,
    completed_by: args.done ? args.userId : null,
    updated_at: now,
  }
  // Only overwrite content when the caller passes it — undefined leaves
  // the existing blob intact (e.g. AM marks step done without re-writing
  // the brief draft they typed earlier).
  if (args.content !== undefined) payload.content = args.content

  const { data, error } = await supabase
    .from("client_onboarding_tasks")
    .upsert(payload, { onConflict: "monday_item_id,task_key" })
    .select("done, completed_at, completed_by, content")
    .single()

  if (error) throw new Error(`Failed to save onboarding step: ${error.message}`)

  return {
    done: data.done as boolean,
    completedAt: data.completed_at as string | null,
    completedBy: data.completed_by as string | null,
    content: data.content,
  }
}
