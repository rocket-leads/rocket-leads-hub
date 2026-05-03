import { createAdminClient } from "@/lib/supabase/server"

/**
 * Per-user inbox preferences. Sits on the `users` table (not in
 * user_platform_tokens) because subscriptions are independent of whether the
 * user has connected a personal token for replies — you can subscribe to a
 * channel for visibility without ever needing to reply through it.
 */

export async function getUserTrengoChannelIds(userId: string): Promise<number[]> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("trengo_channel_ids")
    .eq("id", userId)
    .maybeSingle()
  const raw = data?.trengo_channel_ids
  if (!Array.isArray(raw)) return []
  return raw.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
}

export async function setUserTrengoChannelIds(
  userId: string,
  channelIds: number[],
): Promise<void> {
  // Normalize: dedupe, drop non-finite values, keep order stable for diffing.
  const cleaned = Array.from(
    new Set(channelIds.filter((n) => typeof n === "number" && Number.isFinite(n))),
  )
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("users")
    .update({ trengo_channel_ids: cleaned })
    .eq("id", userId)
  if (error) throw new Error(error.message)
}
