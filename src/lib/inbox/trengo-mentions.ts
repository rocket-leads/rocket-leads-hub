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
  // First-name → Hub id, but only kept when that first name is UNAMBIGUOUS
  // (exactly one Hub user has it). Bridges spelling drift between Trengo and
  // the Hub ("Stefan vd Wijdeven" vs "Stefan van de Wijdeven") without risking
  // a wrong match when two teammates share a first name.
  const firstNameCounts = new Map<string, number>()
  const hubByFirstName = new Map<string, string>()
  for (const h of (hubUsers ?? []) as Array<{ id: string; name: string | null; email: string | null }>) {
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
  for (const u of trengoUsers) {
    const firstName = normName(u.name).split(" ")[0]
    const hubId =
      hubByName.get(normName(u.name)) ??
      (u.email ? hubByEmail.get(u.email.trim().toLowerCase()) : undefined) ??
      (firstName && firstNameCounts.get(firstName) === 1
        ? hubByFirstName.get(firstName)
        : undefined)
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
