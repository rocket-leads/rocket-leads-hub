import { createAdminClient } from "@/lib/supabase/server"

/**
 * Maps a teammate's display name → their uploaded avatar URL (Settings → Me).
 * Account/Campaign managers on a client are stored as plain Monday name
 * strings, so this is how the Watch List + Clients table turn "Sander Vos"
 * into their profile photo. Keys are lower-cased + trimmed for tolerant
 * matching; only users who actually uploaded a photo are included (everyone
 * else falls back to coloured initials in the UI).
 */
export async function getTeamAvatarMap(): Promise<Record<string, string>> {
  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("users")
    .select("name, avatar_url")
    .not("avatar_url", "is", null)

  if (error || !data) return {}

  const map: Record<string, string> = {}
  for (const row of data) {
    const name = (row.name ?? "").trim().toLowerCase()
    if (name && row.avatar_url) map[name] = row.avatar_url
  }
  return map
}
