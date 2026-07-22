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

/** The phone embedded in a phone-canonical thread_key (`trengo:phone:<E164>`). */
export function phoneFromThreadKey(threadKey: string | null | undefined): string | null {
  if (!threadKey) return null
  const m = threadKey.match(/^trengo:phone:([^|]+)/)
  return m ? m[1] : null
}

/** Normalise a phone to a stable identity key: keep a leading `+`, drop every
 *  other non-digit. `+31 6 34235885` / `0031634235885` → comparable forms.
 *  Returns null for anything too short to be a real number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  const plus = trimmed.startsWith("+") || trimmed.startsWith("00")
  const digits = trimmed.replace(/\D/g, "").replace(/^00/, "")
  if (digits.length < 7) return null
  return (plus ? "+" : "") + digits
}

/**
 * Resolve the CANONICAL thread base for a set of Trengo contact ids. When a
 * contact has a phone in the registry, its base is `trengo:phone:<E164>` so
 * every Trengo contact record for the same WhatsApp number collapses into one
 * thread (Roy 2026-07-22: duplicate contacts split the same person's history).
 * Contacts with no known phone keep their `trengo:contact:<id>` base. Returns a
 * Map only for the ids that map to a phone; callers default to the contact base.
 */
export async function getCanonicalThreadBases(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  contactIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const unique = Array.from(new Set(contactIds.filter((n) => Number.isFinite(n))))
  if (unique.length === 0) return out
  const { data } = await supabase
    .from("trengo_contacts")
    .select("id, phone")
    .in("id", unique)
  for (const r of (data ?? []) as Array<{ id: number; phone: string | null }>) {
    const norm = normalizePhone(r.phone)
    if (norm) out.set(r.id, `trengo:phone:${norm}`)
  }
  return out
}

/**
 * Auto-relink a DEAD (deleted/404) Trengo contact's thread onto the client's
 * live number. When a contact record is gone in Trengo but still has Hub history
 * (a stale duplicate the weekly-update automation left behind, a merged-away
 * record, …) and it's linked to a client that has exactly ONE live phone number
 * among its other contacts, we can safely conclude it's the same person and
 * merge its rows into that phone thread. Ambiguous cases (unlinked, or a client
 * with several distinct numbers) are left untouched. Roy 2026-07-22.
 */
export async function reconcileDeadContact(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  deadContactId: number | string,
): Promise<{ merged: boolean; phone?: string; rows?: number }> {
  const deadIdStr = String(deadContactId)
  const { data: clients } = await supabase
    .from("clients")
    .select("monday_item_id, trengo_contact_ids")
    .contains("trengo_contact_ids", [deadIdStr])
  const list = (clients ?? []) as Array<{ monday_item_id: string; trengo_contact_ids: string[] | null }>
  if (list.length !== 1) return { merged: false } // unlinked or linked to several clients → don't guess
  const client = list[0]
  const otherIds = (client.trengo_contact_ids ?? [])
    .filter((x) => x !== deadIdStr)
    .map(Number)
    .filter((n) => Number.isFinite(n))
  if (otherIds.length === 0) return { merged: false }

  const { data: contacts } = await supabase
    .from("trengo_contacts")
    .select("phone")
    .in("id", otherIds)
    .not("phone", "is", null)
  const phones = Array.from(
    new Set(
      ((contacts ?? []) as Array<{ phone: string | null }>)
        .map((c) => normalizePhone(c.phone))
        .filter((p): p is string => p != null),
    ),
  )
  if (phones.length !== 1) return { merged: false } // no single unambiguous number
  const phone = phones[0]
  const phoneBase = `trengo:phone:${phone}`

  // Merge the dead contact's rows into the live phone thread + attribute them.
  const { data: upd } = await supabase
    .from("inbox_events")
    .update({ thread_key: phoneBase, client_id: client.monday_item_id })
    .eq("thread_key", `trengo:contact:${deadIdStr}`)
    .select("id")
  // Drop the dead id from the client's link list - it's gone in Trengo.
  await supabase
    .from("clients")
    .update({ trengo_contact_ids: (client.trengo_contact_ids ?? []).filter((x) => x !== deadIdStr) })
    .eq("monday_item_id", client.monday_item_id)

  return { merged: true, phone, rows: upd?.length ?? 0 }
}

/** Display names for a set of phone-canonical threads: phone → contact name.
 *  Picks any registry row on that phone that carries a name. */
export async function getTrengoNamesByPhone(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  phones: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const unique = Array.from(new Set(phones.filter(Boolean)))
  if (unique.length === 0) return out
  const { data } = await supabase
    .from("trengo_contacts")
    .select("name, phone")
    .in("phone", unique)
    .not("name", "is", null)
  for (const r of (data ?? []) as Array<{ name: string | null; phone: string | null }>) {
    const norm = normalizePhone(r.phone)
    if (norm && r.name?.trim() && !out.has(norm)) out.set(norm, r.name.trim())
  }
  return out
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
