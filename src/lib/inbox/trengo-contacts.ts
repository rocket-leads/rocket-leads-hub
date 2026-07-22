import { createAdminClient } from "@/lib/supabase/server"

/**
 * Trengo contact registry (`trengo_contacts`). Keyed by Trengo contact id,
 * upserted from every `ticket.contact` the ingest paths see so a thread can be
 * named after the real contact even when it's outbound-only or unlinked.
 * Roy 2026-07-22: "laad gewoon de Trengo contact name in de inbox".
 */

export type TrengoContactSeed = {
  id: number
  name?: string | null
  email?: string | null
  phone?: string | null
}

/** The base contact id embedded in a chat thread_key (`trengo:contact:<id>` or
 *  the per-channel `…|ch:<n>` variant). Null for non-Trengo / malformed keys. */
export function contactIdFromThreadKey(threadKey: string | null | undefined): number | null {
  if (!threadKey) return null
  const m = threadKey.match(/^trengo:contact:(\d+)/)
  return m ? Number(m[1]) : null
}

/**
 * Upsert a batch of contacts. Only writes fields we actually have (never
 * clobbers an existing phone/name with null), so a later phone-enrichment pass
 * and the name-carrying poll can each fill their own column. Best-effort: a
 * failure here must not break message ingest.
 */
export async function upsertTrengoContacts(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  seeds: TrengoContactSeed[],
): Promise<void> {
  // De-dupe by id, preferring the richest seed (one with a name).
  const byId = new Map<number, TrengoContactSeed>()
  for (const s of seeds) {
    if (!s.id) continue
    const prev = byId.get(s.id)
    if (!prev) byId.set(s.id, s)
    else
      byId.set(s.id, {
        id: s.id,
        name: s.name ?? prev.name,
        email: s.email ?? prev.email,
        phone: s.phone ?? prev.phone,
      })
  }
  const rows = Array.from(byId.values())
    .filter((s) => s.name != null || s.email != null || s.phone != null)
    .map((s) => ({
      id: s.id,
      // Empty string → null so a blank name doesn't count as "known".
      name: s.name?.trim() || null,
      email: s.email?.trim() || null,
      phone: s.phone?.trim() || null,
      updated_at: new Date().toISOString(),
    }))
  if (rows.length === 0) return
  try {
    await supabase.from("trengo_contacts").upsert(rows, { onConflict: "id" })
  } catch (e) {
    console.error("[trengo-contacts] upsert failed:", e instanceof Error ? e.message : e)
  }
}

/**
 * Resolve display names for a set of Trengo contact ids. Returns a Map of
 * id → name for the ones we know. Used by thread grouping so every thread shows
 * its real contact name.
 */
export async function getTrengoContactNames(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  ids: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const unique = Array.from(new Set(ids.filter((n) => Number.isFinite(n))))
  if (unique.length === 0) return out
  const { data } = await supabase
    .from("trengo_contacts")
    .select("id, name")
    .in("id", unique)
  for (const r of (data ?? []) as Array<{ id: number; name: string | null }>) {
    if (r.name && r.name.trim()) out.set(r.id, r.name.trim())
  }
  return out
}
