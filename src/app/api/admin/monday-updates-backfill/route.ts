import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import {
  fetchAllItemUpdates,
  fetchBothBoards,
  type ItemUpdateFull,
  type MondayClient,
} from "@/lib/integrations/monday"
import { mondayStatusToHub } from "@/lib/clients/status"
import { stripHtml } from "@/lib/html"

export const maxDuration = 300

/**
 * POST /api/admin/monday-updates-backfill
 *
 * One-shot historical ingest of EVERY Monday update on every active client
 * into `inbox_events`. Each row lands as a timeline-only entry — kind="chat"
 * + thread_key=null + assignee=system + status="read" — so it surfaces in
 * the per-client timeline (api/clients/[id]/timeline) without polluting the
 * Inbox tabs or sidebar badges.
 *
 * Why this exists: the Monday webhook only writes rows ingested while it has
 * been running, and only @-mentioned non-chat updates get promoted to Tasks/
 * Updates. Everything else — the bulk of Monday's CRM-side activity log —
 * was historically dropped. AMs and finance want the full client history
 * available from the Hub without bouncing back to Monday, so this backfills
 * the gap. Forward path: the refactored webhook now also writes timeline-
 * only rows on every Monday update, so this script only needs to run once.
 *
 * Idempotency:
 *   - Per-update dedupe via `source_msg_id = monday:update:{itemId}:{updateId}`.
 *   - Belt-and-suspenders: also skip when an inbox_events row already exists
 *     with (client_id, source='monday', created_at_src=update.createdAt) so
 *     legacy webhook entries (which used a different source_msg_id format)
 *     don't get duplicated by the backfill.
 *
 * Scope: all clients on the onboarding + current-clients boards whose Hub
 * status resolves to live | onboarding | on_hold. Churned clients are
 * skipped — backfilling their timeline doesn't help, and they often have
 * hundreds of stale updates that would just burn API quota.
 *
 * Cost model:
 *   - No Anthropic spend — the backfill never classifies. Promotion to
 *     Tasks/Updates is webhook-only (forward-looking).
 *   - Monday API: ~1 query per page of 100 updates per client. A client with
 *     500 updates = 5 queries. With 50+ active clients this is the dominant
 *     cost — concurrency capped at 4 to stay polite to Monday's rate limit.
 *
 * Re-runnable: every step is idempotent. Click again to pick up where a
 * previous run hit the deadline or to ingest updates created between runs.
 */

const CONCURRENCY = 4
const TIME_BUDGET_MS = 4 * 60 * 1000 // leave headroom under maxDuration

type ClientResult = {
  mondayItemId: string
  name: string
  fetched: number
  inserted: number
  skippedDedupe: number
  errors: number
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS

  const supabase = await createAdminClient()

  // System HQ user — author + (for timeline-only rows) assignee FK target.
  // Same pattern as the live webhook.
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (!hq?.id) {
    return NextResponse.json(
      { ok: false, error: "System HQ user not found (rocketleadshq@gmail.com)" },
      { status: 500 },
    )
  }
  const systemUserId = hq.id as string

  // Source of truth for "which clients to backfill" — same cache the rest
  // of the app uses, with a live fallback so a missing cache doesn't block
  // the operation.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const boards = cached ?? (await fetchBothBoards().catch(() => ({ onboarding: [], current: [] })))
  const allClients = [...boards.onboarding, ...boards.current]

  // Skip Churned — their timeline isn't load-bearing and they often have
  // long-stale histories that would dominate Monday API spend.
  const targets = allClients.filter((c) => {
    const status = mondayStatusToHub(c.campaignStatus, c.boardType)
    return status === "live" || status === "onboarding" || status === "on_hold"
  })

  // Optional caller scoping — e.g. ?onlyClientId=12345 lets finance backfill
  // a single client without burning the whole budget on the rest.
  const onlyClientId = req.nextUrl.searchParams.get("onlyClientId")
  const scoped = onlyClientId
    ? targets.filter((c) => c.mondayItemId === onlyClientId)
    : targets

  const results: ClientResult[] = []
  let deadlineHit = false

  await processInBatches(
    scoped,
    CONCURRENCY,
    async (client) => {
      const r = await backfillOne(supabase, systemUserId, client)
      results.push(r)
    },
    () => {
      const hit = Date.now() >= deadline
      if (hit) deadlineHit = true
      return hit
    },
  )

  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      skippedDedupe: acc.skippedDedupe + r.skippedDedupe,
      errors: acc.errors + r.errors,
    }),
    { fetched: 0, inserted: 0, skippedDedupe: 0, errors: 0 },
  )

  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    clientsProcessed: results.length,
    clientsRemaining: scoped.length - results.length,
    deadlineHit,
    totals,
    perClient: results,
  })
}

async function backfillOne(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  systemUserId: string,
  client: MondayClient,
): Promise<ClientResult> {
  const result: ClientResult = {
    mondayItemId: client.mondayItemId,
    name: client.name,
    fetched: 0,
    inserted: 0,
    skippedDedupe: 0,
    errors: 0,
  }

  let updates: ItemUpdateFull[]
  try {
    updates = await fetchAllItemUpdates(client.mondayItemId)
  } catch (e) {
    console.error(
      `[monday-updates-backfill] fetch failed for ${client.mondayItemId}:`,
      e instanceof Error ? e.message : e,
    )
    result.errors++
    return result
  }
  result.fetched = updates.length
  if (updates.length === 0) return result

  // Bulk pre-fetch existing source_msg_ids for this client so dedupe is one
  // query, not N. Same trick for the created_at_src timestamps (catches
  // legacy webhook entries written under the old source_msg_id shape).
  const candidateMsgIds = updates.map((u) => `monday:update:${client.mondayItemId}:${u.id}`)
  const candidateTimestamps = updates.map((u) => u.createdAt).filter(Boolean)

  const [byMsgIdRes, byTsRes] = await Promise.all([
    supabase
      .from("inbox_events")
      .select("source_msg_id")
      .eq("source", "monday")
      .eq("client_id", client.mondayItemId)
      .in("source_msg_id", candidateMsgIds),
    supabase
      .from("inbox_events")
      .select("created_at_src")
      .eq("source", "monday")
      .eq("client_id", client.mondayItemId)
      .in("created_at_src", candidateTimestamps),
  ])

  const seenMsgIds = new Set((byMsgIdRes.data ?? []).map((r) => r.source_msg_id as string))
  const seenTimestamps = new Set(
    (byTsRes.data ?? []).map((r) => (r.created_at_src as string | null) ?? ""),
  )

  const rowsToInsert: Array<Record<string, unknown>> = []
  for (const u of updates) {
    const sourceMsgId = `monday:update:${client.mondayItemId}:${u.id}`
    if (seenMsgIds.has(sourceMsgId)) {
      result.skippedDedupe++
      continue
    }
    if (u.createdAt && seenTimestamps.has(u.createdAt)) {
      // Same Monday update already exists under the legacy webhook
      // source_msg_id format — don't double-write.
      result.skippedDedupe++
      continue
    }

    const text = u.text || stripHtml(u.body).trim()
    if (!text) {
      // Pure-attachment update with no text body. Skip — there's nothing
      // meaningful to render in the timeline and the row would be confusing.
      continue
    }
    const titlePreview = text.length > 100 ? text.slice(0, 100) + "…" : text
    const bodyFull = text.length > 100 ? text : null

    rowsToInsert.push({
      kind: "chat",
      client_id: client.mondayItemId,
      author_id: systemUserId,
      assignee_id: systemUserId, // timeline-only — no real assignee
      title: titlePreview || `Monday update from ${u.creatorName || "Monday user"}`,
      body: bodyFull,
      status: "read", // never bumps badges
      priority: null,
      source: "monday",
      source_thread: `monday:item:${client.mondayItemId}`,
      source_msg_id: sourceMsgId,
      thread_key: null, // not in chat substrate
      scope: null,
      author_kind: "rl_team",
      author_external: u.creatorId || null,
      author_name_cached: u.creatorName || null,
      // No classifier spend on backfill — the historical bulk would be
      // expensive and these are timeline-only by definition. The webhook
      // handles forward-looking promotion.
      classify_conf: null,
      classify_method: null,
      created_at_src: u.createdAt || null,
    })
  }

  if (rowsToInsert.length === 0) return result

  // Single batched insert per client to minimize roundtrips. Postgres will
  // happily ingest a few hundred rows per call.
  const { error } = await supabase.from("inbox_events").insert(rowsToInsert)
  if (error) {
    console.error(
      `[monday-updates-backfill] insert failed for ${client.mondayItemId}:`,
      error.message,
    )
    result.errors += rowsToInsert.length
    return result
  }
  result.inserted = rowsToInsert.length
  return result
}

/**
 * Bounded-concurrency worker pool — same shape as the cron's pre-warm helper.
 * Cooperative cancellation via `shouldStop()` so an over-budget run returns
 * partial progress instead of blowing past `maxDuration`.
 */
async function processInBatches<T>(
  items: T[],
  workerCount: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
): Promise<void> {
  let cursor = 0
  async function next(): Promise<void> {
    while (cursor < items.length) {
      if (shouldStop()) return
      const idx = cursor++
      try {
        await worker(items[idx])
      } catch (e) {
        console.error(
          "[monday-updates-backfill] worker failed:",
          e instanceof Error ? e.message : e,
        )
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => next()))
}
