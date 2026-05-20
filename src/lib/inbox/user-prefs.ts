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

/**
 * Per-user primary outbound channels — separate from the visibility set
 * above. Each AM picks ONE channel to send FROM per type (email + WA),
 * so a client-update triggered by anyone (admin, the AM themselves) for
 * the AM's client lands in Trengo from the AM's own address. Nullable:
 * an AM who hasn't picked yet gets a hard error at send-time, not a
 * silent fallback to the workspace's catch-all.
 *
 * See migration 20240043000000_primary_outbound_channels.sql.
 */
export type UserPrimaryChannels = {
  primaryEmailChannelId: number | null
  primaryWaChannelId: number | null
}

export async function getUserPrimaryChannels(
  userId: string,
): Promise<UserPrimaryChannels> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("primary_email_channel_id, primary_wa_channel_id")
    .eq("id", userId)
    .maybeSingle<{
      primary_email_channel_id: number | null
      primary_wa_channel_id: number | null
    }>()
  return {
    primaryEmailChannelId: data?.primary_email_channel_id ?? null,
    primaryWaChannelId: data?.primary_wa_channel_id ?? null,
  }
}

export async function setUserPrimaryChannels(
  userId: string,
  patch: Partial<UserPrimaryChannels>,
): Promise<void> {
  // Partial: caller can update just one of the two without clearing the
  // other. `null` is a meaningful value here (= "unset"), so we
  // distinguish between an absent key and an explicit null.
  const update: Record<string, number | null> = {}
  if ("primaryEmailChannelId" in patch) {
    update.primary_email_channel_id = normaliseChannelId(patch.primaryEmailChannelId)
  }
  if ("primaryWaChannelId" in patch) {
    update.primary_wa_channel_id = normaliseChannelId(patch.primaryWaChannelId)
  }
  if (Object.keys(update).length === 0) return
  const supabase = await createAdminClient()
  const { error } = await supabase.from("users").update(update).eq("id", userId)
  if (error) throw new Error(error.message)
}

function normaliseChannelId(v: number | null | undefined): number | null {
  if (v == null) return null
  return typeof v === "number" && Number.isFinite(v) ? v : null
}
