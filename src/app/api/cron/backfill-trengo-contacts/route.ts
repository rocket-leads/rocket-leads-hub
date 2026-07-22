import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { fetchTrengoContactStatus } from "@/lib/integrations/trengo"
import {
  upsertTrengoContacts,
  contactIdFromThreadKey,
  reconcileDeadContact,
} from "@/lib/inbox/trengo-contacts"

/**
 * Populate / refresh the `trengo_contacts` registry for EXISTING threads.
 *
 * The poll + webhook register a contact's name from `ticket.contact` going
 * forward, but historical threads — especially outbound-only ones like a
 * weekly-update push to a contact who never replied — have no name on record
 * and render as "Unknown" (Roy 2026-07-22). This walks every distinct Trengo
 * contact id in `inbox_events` and fills the registry:
 *   1. cheaply, from any inbound client row that already carries the name;
 *   2. for the rest (incl. outbound-only duplicates), from `GET /contacts/{id}`
 *      — which also gives the PHONE, seeding the later same-number merge.
 *
 * Idempotent + bounded (`?limit=`, default 400 API fetches/run) so a big inbox
 * finishes over a few runs without tripping Trengo's rate limit. Also scheduled
 * weekly so a contact renamed in Trengo refreshes here too.
 */

export const dynamic = "force-dynamic"
export const maxDuration = 300

const DEFAULT_FETCH_CAP = 400

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tracker = startCronRun("backfill-trengo-contacts")
  const startedAt = Date.now()
  const capParam = req.nextUrl.searchParams.get("limit")
  const fetchCap =
    capParam && Number.isFinite(Number(capParam))
      ? Math.min(Math.max(Number(capParam), 1), 2000)
      : DEFAULT_FETCH_CAP

  try {
    const supabase = await createAdminClient()

    // 1. Distinct Trengo contact ids across all threads (page through the one
    //    cheap column). Dedupe in memory.
    const contactIds = new Set<number>()
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("inbox_events")
        .select("thread_key")
        .eq("source", "trengo")
        .not("thread_key", "is", null)
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as Array<{ thread_key: string | null }>
      for (const r of rows) {
        const id = contactIdFromThreadKey(r.thread_key)
        if (id != null) contactIds.add(id)
      }
      if (rows.length < PAGE) break
    }

    // 2. Which are already named in the registry — skip those.
    const alreadyNamed = new Set<number>()
    // A contact is "fully known" only when it has BOTH a name and a phone: the
    // name kills "Unknown", the PHONE enables the same-number merge. Anything
    // missing a phone still needs a Trengo fetch (phone only comes from the API).
    const idList = Array.from(contactIds)
    const withPhone = new Set<number>()
    for (let i = 0; i < idList.length; i += 500) {
      const chunk = idList.slice(i, i + 500)
      const { data } = await supabase
        .from("trengo_contacts")
        .select("id, name, phone")
        .in("id", chunk)
      for (const r of (data ?? []) as Array<{ id: number; name: string | null; phone: string | null }>) {
        if (r.name && r.name.trim()) alreadyNamed.add(r.id)
        if (r.phone && r.phone.trim()) withPhone.add(r.id)
      }
    }
    const missingName = idList.filter((id) => !alreadyNamed.has(id))

    // 3. Cheap seed: any inbound client row already carries the contact name in
    //    author_name_cached (author_external = the contact id). One pass. Fills
    //    names (kills "Unknown") without an API call; phones still need the fetch.
    const seededFromRows = new Map<number, string>()
    for (let i = 0; i < missingName.length; i += 300) {
      const chunk = missingName.slice(i, i + 300).map(String)
      const { data } = await supabase
        .from("inbox_events")
        .select("author_external, author_name_cached")
        .eq("source", "trengo")
        .eq("author_kind", "client")
        .in("author_external", chunk)
        .not("author_name_cached", "is", null)
      for (const r of (data ?? []) as Array<{ author_external: string | null; author_name_cached: string | null }>) {
        const id = Number(r.author_external)
        const name = r.author_name_cached?.trim()
        if (Number.isFinite(id) && name && !seededFromRows.has(id)) seededFromRows.set(id, name)
      }
    }
    if (seededFromRows.size > 0) {
      await upsertTrengoContacts(
        supabase,
        Array.from(seededFromRows.entries()).map(([id, name]) => ({ id, name })),
      )
    }

    // 4. Trengo fetch for every contact still missing a PHONE (the merge key),
    //    bounded + throttled. Also fills any still-missing name.
    const stillMissing = idList.filter((id) => !withPhone.has(id))
    let fetched = 0
    let namedFromApi = 0
    const deadIds: number[] = []
    for (const id of stillMissing) {
      if (fetched >= fetchCap) break
      fetched += 1
      const { status, contact: c } = await fetchTrengoContactStatus(id)
      if (c && (c.name || c.phone)) {
        await upsertTrengoContacts(supabase, [
          { id, name: c.name ?? c.full_name ?? null, email: c.email, phone: c.phone },
        ])
        if (c.name || c.full_name) namedFromApi += 1
      } else if (status === 404) {
        // Record is gone in Trengo - a candidate for dead-contact auto-relink.
        deadIds.push(id)
      }
      // ~5 req/s ceiling, same as the poll, to stay under Trengo's limit.
      await new Promise((r) => setTimeout(r, 200))
    }

    // 4b. Dead (404) contacts: if one is linked to a client with a single live
    //     number, merge its stale thread onto that number and drop the dead id.
    let deadMerged = 0
    let deadRowsMerged = 0
    for (const id of deadIds) {
      const r = await reconcileDeadContact(supabase, id)
      if (r.merged) {
        deadMerged += 1
        deadRowsMerged += r.rows ?? 0
      }
    }

    // 5. Merge duplicate contacts for the same number: re-key historical
    //    contact-based rows to the canonical phone base. Idempotent — only rows
    //    still on a contact base are touched — so this converges as phones get
    //    learned over successive runs.
    let messagesRekeyed = 0
    let mentionsRekeyed = 0
    const { data: rekey } = await supabase.rpc("rekey_trengo_threads_by_phone")
    const rk = Array.isArray(rekey) ? rekey[0] : rekey
    if (rk) {
      messagesRekeyed = Number(rk.messages_rekeyed ?? 0)
      mentionsRekeyed = Number(rk.mentions_rekeyed ?? 0)
    }

    const metrics = {
      distinctContacts: contactIds.size,
      alreadyNamed: alreadyNamed.size,
      seededFromRows: seededFromRows.size,
      apiFetched: fetched,
      namedFromApi,
      deadContacts: deadIds.length,
      deadMerged,
      deadRowsMerged,
      remaining: Math.max(0, stillMissing.length - fetched),
      messagesRekeyed,
      mentionsRekeyed,
      durationMs: Date.now() - startedAt,
    }
    await tracker.ok(metrics)
    return NextResponse.json({ ok: true, ...metrics })
  } catch (e) {
    await tracker.fail(e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "backfill-trengo-contacts failed" },
      { status: 500 },
    )
  }
}
