import { createAdminClient } from "@/lib/supabase/server"
import { encrypt, decrypt } from "@/lib/encryption"

/**
 * Per-user encrypted platform credentials.
 *
 * Each Hub user can connect their personal Slack OAuth / Trengo API key /
 * Monday API key. When the user replies to a chat from the Hub, the outbound
 * call uses *their* token so the message lands as them in the source system,
 * not as a generic system bot. See `project_phase_c_unified_inbox_design.md`
 * for the full reply-as-self rationale.
 */

export type Platform = "slack" | "trengo" | "monday"

export type UserPlatformConnection = {
  platform: Platform
  /** Free-form metadata: slack team id, trengo agent name, monday account id, etc. */
  meta: Record<string, unknown> | null
  connectedAt: string
  updatedAt: string
}

/** Read-only listing — never returns the decrypted token. */
export async function listUserPlatformConnections(userId: string): Promise<UserPlatformConnection[]> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("user_platform_tokens")
    .select("platform, meta, connected_at, updated_at")
    .eq("user_id", userId)
  return (data ?? []).map((row) => ({
    platform: row.platform as Platform,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    connectedAt: row.connected_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * Decrypted token retrieval — for use server-side when sending an outbound
 * reply on behalf of the user. Returns null when the user hasn't connected
 * the platform yet, so callers can prompt with "Connect your X first" rather
 * than surprising them with an error.
 */
export async function getUserPlatformToken(
  userId: string,
  platform: Platform,
): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("user_platform_tokens")
    .select("token_enc")
    .eq("user_id", userId)
    .eq("platform", platform)
    .maybeSingle()
  if (!data?.token_enc) return null
  try {
    return decrypt(data.token_enc)
  } catch (e) {
    console.error("Failed to decrypt user platform token:", e)
    return null
  }
}

/** Upsert a fresh token for the user — replaces any existing one. */
export async function setUserPlatformToken(
  userId: string,
  platform: Platform,
  token: string,
  meta: Record<string, unknown> | null = null,
): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error("Empty token")

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("user_platform_tokens")
    .upsert(
      {
        user_id: userId,
        platform,
        token_enc: encrypt(trimmed),
        meta,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,platform" },
    )
  if (error) throw new Error(error.message)
}

/** Drop the user's connection for a platform. */
export async function disconnectUserPlatform(
  userId: string,
  platform: Platform,
): Promise<void> {
  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("user_platform_tokens")
    .delete()
    .eq("user_id", userId)
    .eq("platform", platform)
  if (error) throw new Error(error.message)
}
