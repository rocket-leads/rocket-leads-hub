import { createAdminClient } from "@/lib/supabase/server"

/** A single emoji's tally on one inbox item: how many reacted with it, and
 *  whether the current user is one of them (drives the active chip state). */
export type ReactionSummary = { emoji: string; count: number; mine: boolean }

type RawReaction = { item_id: string; user_id: string; emoji: string }

/**
 * Bulk-load reactions for a set of inbox items, grouped per item and per emoji.
 * Used by the update feed so a page of cards needs one query, not one per card.
 * Returns `{}` for an empty id list. Items with no reactions are simply absent
 * from the map (the caller defaults to []).
 */
export async function listReactionsForItems(
  itemIds: string[],
  userId: string,
): Promise<Record<string, ReactionSummary[]>> {
  if (itemIds.length === 0) return {}
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_reactions")
    .select("item_id, user_id, emoji")
    .in("item_id", itemIds)
  if (error || !data) return {}

  // item_id -> emoji -> { count, mine }
  const byItem = new Map<string, Map<string, { count: number; mine: boolean }>>()
  for (const row of data as RawReaction[]) {
    let emojiMap = byItem.get(row.item_id)
    if (!emojiMap) {
      emojiMap = new Map()
      byItem.set(row.item_id, emojiMap)
    }
    const cur = emojiMap.get(row.emoji) ?? { count: 0, mine: false }
    cur.count += 1
    if (row.user_id === userId) cur.mine = true
    emojiMap.set(row.emoji, cur)
  }

  const out: Record<string, ReactionSummary[]> = {}
  for (const [itemId, emojiMap] of byItem) {
    out[itemId] = Array.from(emojiMap.entries())
      .map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine }))
      // Stable order: most-reacted first, emoji as tiebreak so it doesn't jump.
      .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji))
  }
  return out
}

/**
 * Toggle one emoji reaction for a user on an item: adds it if absent, removes
 * it if present. Returns the item's fresh reaction summary so the caller can
 * update the UI without a second round-trip.
 */
export async function toggleReaction(
  itemId: string,
  userId: string,
  emoji: string,
): Promise<ReactionSummary[]> {
  const supabase = await createAdminClient()
  const { data: existing } = await supabase
    .from("inbox_reactions")
    .select("id")
    .eq("item_id", itemId)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .maybeSingle<{ id: string }>()

  if (existing) {
    await supabase.from("inbox_reactions").delete().eq("id", existing.id)
  } else {
    await supabase.from("inbox_reactions").insert({ item_id: itemId, user_id: userId, emoji })
  }

  const map = await listReactionsForItems([itemId], userId)
  return map[itemId] ?? []
}
