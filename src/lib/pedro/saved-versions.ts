import type { SupabaseClient } from "@supabase/supabase-js"
import type { PedroStage } from "@/lib/pedro/past-campaigns"

/**
 * Pedro saved-versions reader.
 *
 * Layer 2 of the two-layer storage model: explicit "Save final version"
 * snapshots. Code that wants the canonical "current state" for a client
 * should prefer `loadLatestSavedVersion` (this file) and fall back to
 * the draft in `pedro_client_state` only when no saved version exists.
 *
 * Why prefer saved over draft: drafts include in-progress experiments
 * the CM hasn't committed to. Reading drafts as if they were canonical
 * pollutes downstream features (cross-client examples, client detail
 * Pedro tab, knowledge proposals).
 */

export type SavedVersionRow = {
  id: string
  client_id: string
  campaign_number: number
  stage: PedroStage
  version_number: number
  data: unknown
  label: string | null
  saved_by: string | null
  saved_at: string
}

/**
 * Latest saved version for one (client, stage). Returns null when
 * nothing has been explicitly saved yet - caller falls back to draft.
 */
export async function loadLatestSavedVersion(
  supabase: SupabaseClient,
  clientId: string,
  stage: PedroStage,
  campaignNumber = 1,
): Promise<SavedVersionRow | null> {
  if (!clientId) return null
  const { data } = await supabase
    .from("pedro_stage_versions")
    .select("*")
    .eq("client_id", clientId)
    .eq("campaign_number", campaignNumber)
    .eq("stage", stage)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as SavedVersionRow | null) ?? null
}

/**
 * All versions across all stages for a client - used by the client
 * detail Pedro tab to render a unified history timeline.
 */
export async function loadAllVersionsForClient(
  supabase: SupabaseClient,
  clientId: string,
  limit = 50,
): Promise<SavedVersionRow[]> {
  const { data } = await supabase
    .from("pedro_stage_versions")
    .select("*")
    .eq("client_id", clientId)
    .order("saved_at", { ascending: false })
    .limit(limit)
  return (data ?? []) as SavedVersionRow[]
}
