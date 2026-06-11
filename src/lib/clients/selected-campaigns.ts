import type { createAdminClient } from "@/lib/supabase/server"

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

/**
 * Paginated fetch of `client_campaigns` rows where `is_selected = true`, for
 * the given client IDs. Returns the raw `{ client_id, meta_campaign_id }` rows.
 *
 * Why this exists: Supabase's default row cap is 1000. A plain
 * `.select(...).in("client_id", clientIds).eq("is_selected", true)` against
 * accounts with many active campaigns silently truncates at row 1000.
 * Clients whose rows land in the tail of the result lose their selections,
 * the KPI cron then falls back to "no filter" for them, and any client on a
 * shared ad account ends up showing the full account total - surfaced as
 * three Hero Leads Monday items reporting identical adspend + leads on the
 * Clients overview (Roy 2026-06-07).
 *
 * Mirrors the pagination pattern already in use in `auto-select-non-rl-campaigns.ts`.
 */
export async function fetchSelectedCampaignRows(
  supabase: Supabase,
  clientIds: string[],
): Promise<Array<{ client_id: string; meta_campaign_id: string }>> {
  if (clientIds.length === 0) return []

  const PAGE = 1000
  // Safety cap so a runaway query can't infinite-loop. 100k is well past any
  // realistic Hub dataset (hundreds of clients × tens of campaigns each).
  const MAX = 100_000

  const out: Array<{ client_id: string; meta_campaign_id: string }> = []
  let offset = 0
  while (offset < MAX) {
    const { data, error } = await supabase
      .from("client_campaigns")
      .select("client_id, meta_campaign_id")
      .in("client_id", clientIds)
      .eq("is_selected", true)
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error("[fetchSelectedCampaignRows] page fetch failed:", error.message)
      break
    }
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
    offset += PAGE
  }
  return out
}
