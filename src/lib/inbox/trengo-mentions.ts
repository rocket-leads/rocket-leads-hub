import { createAdminClient } from "@/lib/supabase/server"
import { fetchTrengoUsers, type TrengoUser } from "@/lib/integrations/trengo"

/**
 * Everything needed to turn a Trengo internal-note's raw mention data into
 * Hub-facing values:
 *   - `trengoById`     Trengo user id → Trengo user (name, avatar, …)
 *   - `hubIdByTrengoId` Trengo user id → Hub user id (matched by display name)
 *
 * Trengo stores a note author in `message.agent` / `message.user_id` and its
 * @-mentions both as a structured `message.mentions` array (`{ user_id }`) and
 * inline in the body as `@<firstname><userId>` handles (e.g. `@roy430594`).
 * Neither is human-readable, so we resolve both against the Trengo user list
 * and map onto Hub users by name (Trengo emails are @rocketleads.nl while Hub
 * emails are @rocketleads.com, so name is the reliable join key).
 */
export type TrengoMentionContext = {
  trengoById: Map<number, TrengoUser>
  hubIdByTrengoId: Map<number, string>
}

function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

export async function getTrengoMentionContext(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<TrengoMentionContext> {
  const trengoById = new Map<number, TrengoUser>()
  const hubIdByTrengoId = new Map<number, string>()
  let trengoUsers: TrengoUser[] = []
  try {
    trengoUsers = await fetchTrengoUsers()
  } catch {
    // Trengo briefly unreachable → return empty maps; callers degrade to
    // leaving handles as-is and skipping fan-out (no crash).
    return { trengoById, hubIdByTrengoId }
  }
  for (const u of trengoUsers) trengoById.set(u.id, u)

  const { data: hubUsers } = await supabase
    .from("users")
    .select("id, name, email")
    .not("name", "is", null)
  const hubByName = new Map<string, string>()
  const hubByEmail = new Map<string, string>()
  for (const h of (hubUsers ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
    if (h.name) hubByName.set(normName(h.name), h.id)
    if (h.email) hubByEmail.set(h.email.trim().toLowerCase(), h.id)
  }
  for (const u of trengoUsers) {
    const hubId =
      hubByName.get(normName(u.name)) ??
      (u.email ? hubByEmail.get(u.email.trim().toLowerCase()) : undefined)
    if (hubId) hubIdByTrengoId.set(u.id, hubId)
  }
  return { trengoById, hubIdByTrengoId }
}

/**
 * Replace inline Trengo mention handles `@<firstname><userId>` with the user's
 * display name `@Roy Vosters`, so the stored/rendered note reads naturally and
 * the Hub's name-based @-mention colouring lights it up. Leaves unresolved
 * handles untouched.
 */
export function rewriteMentionHandles(
  body: string,
  trengoById: Map<number, TrengoUser>,
): string {
  if (!body) return body
  return body.replace(/@([A-Za-zÀ-ÖØ-öø-ÿ]+)(\d{3,})/g, (whole, _first, idStr) => {
    const u = trengoById.get(Number(idStr))
    return u?.name ? `@${u.name}` : whole
  })
}

/**
 * Resolve the Hub user ids @-mentioned in a note. Prefers the structured
 * `mentions` array (authoritative), falling back to parsing `@<first><id>`
 * handles out of the body. Self-mentions (the note author) are excluded.
 */
export function resolveMentionedHubIds(
  ctx: TrengoMentionContext,
  opts: {
    structuredMentionUserIds?: number[]
    body?: string
    authorTrengoUserId?: number | null
  },
): string[] {
  const trengoIds = new Set<number>()
  for (const id of opts.structuredMentionUserIds ?? []) trengoIds.add(id)
  if (trengoIds.size === 0 && opts.body) {
    for (const m of opts.body.matchAll(/@([A-Za-zÀ-ÖØ-öø-ÿ]+)(\d{3,})/g)) {
      trengoIds.add(Number(m[2]))
    }
  }
  const hubIds = new Set<string>()
  for (const tid of trengoIds) {
    if (opts.authorTrengoUserId && tid === opts.authorTrengoUserId) continue
    const hubId = ctx.hubIdByTrengoId.get(tid)
    if (hubId) hubIds.add(hubId)
  }
  return Array.from(hubIds)
}
