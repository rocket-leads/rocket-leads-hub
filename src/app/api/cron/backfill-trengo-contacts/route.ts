import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { fetchTrengoContact } from "@/lib/integrations/trengo"
import { upsertTrengoContacts, contactIdFromThreadKey } from "@/lib/inbox/trengo-contacts"

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
    const idList = Array.from(contactIds)
    for (let i = 0; i < idList.length; i += 500) {
      const chunk = idList.slice(i, i + 500)
      const { data } = await supabase
        .from("trengo_contacts")
        .select("id, name")
        .in("id", chunk)
      for (const r of (data ?? []) as Array<{ id: number; name: string | null }>) {
        if (r.name && r.name.trim()) alreadyNamed.add(r.id)
      }
    }
    const missing = idList.filter((id) => !alreadyNamed.has(id))

    // 3. Cheap seed: any inbound client row already carries the contact name in
    //    author_name_cached (author_external = the contact id). One pass.
    const seededFromRows = new Map<number, string>()
    for (let i = 0; i < missing.length; i += 300) {
      const chunk = missing.slice(i, i + 300).map(String)
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

    // 4. Trengo fetch for the still-unnamed (outbound-only duplicates etc.),
    //    bounded + throttled. Captures phone too (seeds the same-number merge).
    const stillMissing = missing.filter((id) => !seededFromRows.has(id))
    let fetched = 0
    let namedFromApi = 0
    for (const id of stillMissing) {
      if (fetched >= fetchCap) break
      fetched += 1
      const c = await fetchTrengoContact(id)
      if (c && (c.name || c.phone)) {
        await upsertTrengoContacts(supabase, [
          { id, name: c.name ?? c.full_name ?? null, email: c.email, phone: c.phone },
        ])
        if (c.name || c.full_name) namedFromApi += 1
      }
      // ~5 req/s ceiling, same as the poll, to stay under Trengo's limit.
      await new Promise((r) => setTimeout(r, 200))
    }

    const metrics = {
      distinctContacts: contactIds.size,
      alreadyNamed: alreadyNamed.size,
      seededFromRows: seededFromRows.size,
      apiFetched: fetched,
      namedFromApi,
      remaining: Math.max(0, stillMissing.length - fetched),
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
