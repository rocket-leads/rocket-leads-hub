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
  /** Reverse of hubIdByTrengoId: Hub user id → their Trengo user id. Used by the
   *  seen-state sync to find a Hub user's mention in a Trengo message. */
  trengoIdByHubId: Map<string, number>
}

function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ")
}

export async function getTrengoMentionContext(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<TrengoMentionContext> {
  const trengoById = new Map<number, TrengoUser>()
  const hubIdByTrengoId = new Map<number, string>()
  const trengoIdByHubId = new Map<string, number>()
  let trengoUsers: TrengoUser[] = []
  try {
    trengoUsers = await fetchTrengoUsers()
  } catch {
    // Trengo briefly unreachable → return empty maps; callers degrade to
    // leaving handles as-is and skipping fan-out (no crash).
    return { trengoById, hubIdByTrengoId, trengoIdByHubId }
  }
  for (const u of trengoUsers) trengoById.set(u.id, u)

  const { data: hubUsers } = await supabase
    .from("users")
    .select("id, name, email, trengo_user_id")
    .not("name", "is", null)
  type HubU = { id: string; name: string | null; email: string | null; trengo_user_id: number | null }
  const hub = (hubUsers ?? []) as HubU[]

  // 1. Durable id-based map (rename-proof): a Hub user whose trengo_user_id is
  //    seeded maps directly, no name guessing.
  const hubIdSeeded = new Set<string>()
  for (const h of hub) {
    if (h.trengo_user_id != null) {
      hubIdByTrengoId.set(h.trengo_user_id, h.id)
      if (!trengoIdByHubId.has(h.id)) trengoIdByHubId.set(h.id, h.trengo_user_id)
      hubIdSeeded.add(h.id)
    }
  }

  // 2. Name/email/first-name fallback for anyone not yet seeded. First-name only
  //    when UNAMBIGUOUS (one Hub user has it) so shared first names never match.
  const hubByName = new Map<string, string>()
  const hubByEmail = new Map<string, string>()
  const firstNameCounts = new Map<string, number>()
  const hubByFirstName = new Map<string, string>()
  for (const h of hub) {
    if (h.name) {
      hubByName.set(normName(h.name), h.id)
      const first = normName(h.name).split(" ")[0]
      if (first) {
        firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1)
        hubByFirstName.set(first, h.id)
      }
    }
    if (h.email) hubByEmail.set(h.email.trim().toLowerCase(), h.id)
  }
  const toSeed: Array<{ hubId: string; trengoId: number }> = []
  for (const u of trengoUsers) {
    if (hubIdByTrengoId.has(u.id)) continue // already id-mapped
    const firstName = normName(u.name).split(" ")[0]
    const hubId =
      hubByName.get(normName(u.name)) ??
      (u.email ? hubByEmail.get(u.email.trim().toLowerCase()) : undefined) ??
      (firstName && firstNameCounts.get(firstName) === 1
        ? hubByFirstName.get(firstName)
        : undefined)
    if (hubId) {
      hubIdByTrengoId.set(u.id, hubId)
      if (!trengoIdByHubId.has(hubId)) trengoIdByHubId.set(hubId, u.id)
      if (!hubIdSeeded.has(hubId)) toSeed.push({ hubId, trengoId: u.id })
    }
  }

  // 3. Self-seed: persist the freshly name-matched pairs so future resolution is
  //    id-based (rename-proof). Best-effort, fire-and-forget; only fills nulls.
  if (toSeed.length > 0) {
    void Promise.all(
      toSeed.map(({ hubId, trengoId }) =>
        supabase.from("users").update({ trengo_user_id: trengoId }).eq("id", hubId).is("trengo_user_id", null),
      ),
    ).catch(() => {})
  }

  return { trengoById, hubIdByTrengoId, trengoIdByHubId }
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

/** Trengo's mention handle for a user: first name (letters only, lowercased)
 *  immediately followed by their numeric id — e.g. Roy Vosters #430594 →
 *  `roy430594`. Posting an internal note whose body contains `@roy430594`
 *  makes Trengo create a REAL mention (+ notification) for that user
 *  (verified 2026-07-16). */
export function trengoMentionHandle(u: {
  id: number
  name: string | null
  first_name: string | null
}): string {
  const first = (u.first_name ?? (u.name ?? "").split(/\s+/)[0] ?? "")
    .toLowerCase()
    .replace(/[^a-zà-öø-ÿ]/g, "")
  return `${first}${u.id}`
}

/**
 * Convert human `@Full Name` mentions in an outbound internal-note body into
 * Trengo mention handles (`@roy430594`) so Trengo recognises them and pings the
 * user. The Hub keeps the readable `@Full Name` version; only the copy POSTed
 * to Trengo carries handles. Longest names first so `@Roy Vosters` wins over a
 * hypothetical `@Roy`. Best-effort: on a Trengo outage the body is posted as-is.
 */
export async function convertMentionNamesToHandles(body: string): Promise<string> {
  if (!body || !body.includes("@")) return body
  let users: TrengoUser[] = []
  try {
    users = await fetchTrengoUsers()
  } catch {
    return body
  }
  const named = users
    .filter((u): u is TrengoUser & { name: string } => !!u.name)
    .sort((a, b) => b.name.length - a.name.length)
  let out = body
  for (const u of named) {
    const re = new RegExp(`@${u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
    out = out.replace(re, `@${trengoMentionHandle(u)}`)
  }
  return out
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
