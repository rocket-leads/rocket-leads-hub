import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { seedDefaultAgreementIfMissing, type SeedMode } from "@/lib/clients/agreement"
import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * One-shot bulk backfill: seeds a default agreement for every client that
 * doesn't have one yet (or, with `mode=if-untouched`, also re-seeds rows
 * that were auto-seeded but never edited via the UI). Pulls live data from
 * Monday so newly-added MondayClient fields are picked up.
 *
 * Idempotent: rows with `updated_by` set are always skipped, so manual edits
 * are never overwritten. Admin-only - pricing data is finance-sensitive.
 *
 * Does NOT re-sync clients to Supabase - assumes the regular sync (running
 * on every client-page open + the cache cron) keeps `clients` rows fresh.
 * Skipping the sync keeps the loop fast enough to finish in Vercel's time
 * budget for ~800 clients.
 *
 * Both GET and POST are accepted so an admin can trigger this from the
 * browser address bar; the operation is idempotent and admin-gated, so the
 * usual "GET shouldn't mutate" concern doesn't apply meaningfully here.
 */
async function runBackfill(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // `mode=if-untouched` → also re-seed agreements that exist but were never
  // edited via the UI (used to refresh stale defaults after the seed logic
  // itself improves). Default `if-missing` is non-destructive.
  // `live=1` → bypass the cron cache and read live from Monday; needed when
  // the cache hasn't yet been repopulated with newly-added MondayClient
  // fields (e.g. right after a deploy). Slower but guaranteed fresh.
  const url = new URL(req.url)
  const modeParam = url.searchParams.get("mode")
  const mode: SeedMode = modeParam === "if-untouched" ? "if-untouched" : "if-missing"
  const live = url.searchParams.get("live") === "1"

  let clients: MondayClient[]
  let source: "live" | "cache"
  try {
    if (live) {
      const data = await fetchBothBoards()
      clients = [...data.onboarding, ...data.current]
      source = "live"
    } else {
      const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards")
      if (cached) {
        clients = [...cached.onboarding, ...cached.current]
        source = "cache"
      } else {
        const data = await fetchBothBoards()
        clients = [...data.onboarding, ...data.current]
        source = "live"
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load Monday clients" },
      { status: 500 },
    )
  }

  // Refuse to seed off a stale cache - would silently produce wrong defaults
  // for hundreds of clients (followUpStatus would be undefined → toggle off
  // for everyone). Caller can retry with ?live=1.
  const cacheStale =
    source === "cache" &&
    clients.length > 0 &&
    !Object.prototype.hasOwnProperty.call(clients[0], "followUpStatus")
  if (cacheStale) {
    return NextResponse.json(
      {
        error:
          "Cached Monday data is missing followUpStatus - refusing to seed off stale data. Retry with ?live=1, or wait for the next /api/cron/refresh-cache run.",
      },
      { status: 409 },
    )
  }

  const supabase = await createAdminClient()
  const counts = { inserted: 0, updated: 0, skipped: 0, missing: 0 }
  const failures: Array<{ name: string; error: string }> = []

  // Pre-load the monday_item_id → clients.id map in one query so the per-row
  // loop doesn't pay a roundtrip per client. Clients with no mapping yet are
  // skipped (they need a normal client-page open to trigger sync first).
  const { data: rows } = await supabase
    .from("clients")
    .select("id, monday_item_id")
  const idByMondayId = new Map<string, string>()
  for (const r of rows ?? []) idByMondayId.set(r.monday_item_id, r.id)

  // Bounded concurrency - running all seeds in parallel hammers Supabase and
  // risks rate limits; running them sequentially blows the Vercel time budget
  // at ~800 clients. 20-at-a-time gets the full backfill done in a few seconds.
  const CONCURRENCY = 20
  for (let i = 0; i < clients.length; i += CONCURRENCY) {
    const batch = clients.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (client) => {
        const id = idByMondayId.get(client.mondayItemId)
        if (!id) {
          counts.missing++
          return
        }
        try {
          const result = await seedDefaultAgreementIfMissing(client, id, mode)
          counts[result]++
        } catch (e) {
          failures.push({
            name: client.name,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }),
    )
  }

  return NextResponse.json({
    mode,
    source,
    total: clients.length,
    ...counts,
    failed: failures.length,
    failures,
  })
}

export const GET = runBackfill
export const POST = runBackfill

// Vercel/Next.js default for serverless API routes is 10s; bumping to 60s
// gives the sequential loop room to finish for ~150 clients without timing
// out. Local dev is unaffected.
export const maxDuration = 60
