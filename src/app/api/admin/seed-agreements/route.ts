import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { syncClientToSupabase } from "@/lib/clients/sync"
import { seedDefaultAgreementIfMissing, type SeedMode } from "@/lib/clients/agreement"
import { createAdminClient } from "@/lib/supabase/server"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * One-shot bulk backfill: seeds a default agreement for every client that
 * doesn't have one yet. Each client gets re-synced to Supabase, which in turn
 * triggers `seedDefaultAgreementIfMissing` — so this also benefits from any
 * Monday-side updates that haven't been picked up yet (new clients, renamed
 * companies, edited service fees, etc.).
 *
 * Idempotent: clients with an existing agreement are skipped. Safe to re-run.
 * Admin-only — pricing data is finance-sensitive.
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

  // Refuse to seed off a stale cache — would silently produce wrong defaults
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
          "Cached Monday data is missing followUpStatus — refusing to seed off stale data. Retry with ?live=1, or wait for the next /api/cron/refresh-cache run.",
      },
      { status: 409 },
    )
  }

  const supabase = await createAdminClient()
  const counts = { inserted: 0, updated: 0, skipped: 0 }
  const failures: Array<{ name: string; error: string }> = []

  // Sequential rather than parallel — keeps Monday API + Supabase load
  // predictable, and the loop finishes well under a minute even with 800+
  // clients. Sync writes to `clients`, then the seed call decides whether to
  // touch `client_agreements` based on the mode.
  for (const client of clients) {
    try {
      await syncClientToSupabase(client)

      // Resolve Supabase clients.id from the Monday item ID for the seed call.
      // syncClientToSupabase already did the upsert so this lookup never misses.
      const { data: row } = await supabase
        .from("clients")
        .select("id")
        .eq("monday_item_id", client.mondayItemId)
        .single()
      if (!row) continue

      const result = await seedDefaultAgreementIfMissing(client, row.id, mode)
      counts[result]++
    } catch (e) {
      failures.push({
        name: client.name,
        error: e instanceof Error ? e.message : String(e),
      })
    }
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
