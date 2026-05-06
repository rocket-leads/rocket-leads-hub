import { NextRequest, NextResponse } from "next/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { mondayStatusToHub } from "@/lib/clients/status"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import {
  computeReadinessForClient,
  HARD_TTL_MS,
  readReadinessMap,
  writeReadinessMap,
} from "@/lib/billing/invoice-readiness"

export const maxDuration = 300

/**
 * Pre-warm the AI invoice-readiness cache for every client that's eligible
 * for the /billing page (status Live or On Hold + a valid invoice date).
 * Runs every 6h via Vercel cron — same logic as the on-demand recompute,
 * just batched and time-budgeted so finance doesn't have to click "Run AI
 * check" on each row to populate verdicts.
 *
 * Skip rules per client:
 *   - already has a cached entry younger than HARD_TTL_MS (24h) → skip.
 *     We don't compare lastUpdateAt here because that requires an extra
 *     Monday API call per row; the on-demand route handles update-driven
 *     refresh when finance opens a row.
 *   - Otherwise compute fresh (Monday updates + Stripe + classify).
 *
 * Concurrency capped to 4 parallel computes — Claude tolerates higher rates
 * but Monday's API rate-limits aggressively, so we keep it gentle.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CONCURRENCY = 4
const TIME_BUDGET_MS = 4 * 60 * 1000 // leave headroom under maxDuration

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
        console.error("[refresh-invoice-readiness] worker failed:", e instanceof Error ? e.message : e)
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => next()))
}

async function handler(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS
  const force = req.nextUrl.searchParams.get("force") === "1"

  // Pull the universe of clients from the Monday cache. Falls back to a live
  // fetch if the cache is missing — the readiness pre-warm shouldn't be
  // blocked by a stale-cache state.
  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const boards = cached ?? (await fetchBothBoards().catch(() => ({ onboarding: [], current: [] })))
  const allClients = [...boards.onboarding, ...boards.current]

  // Same eligibility filter as /billing/page.tsx — Live + On Hold with a
  // valid invoice date. Onboarding/Churned don't appear there, so warming
  // them would just burn API quota.
  const eligible = allClients.filter((c) => {
    if (!DATE_RE.test(c.nextInvoiceDate)) return false
    const status = mondayStatusToHub(c.campaignStatus, c.boardType)
    return status === "live" || status === "on_hold"
  })

  const map = await readReadinessMap()

  const targets = eligible.filter((c) => {
    if (force) return true
    const existing = map[c.mondayItemId]
    if (!existing) return true
    const ageMs = Date.now() - new Date(existing.computedAt).getTime()
    return ageMs > HARD_TTL_MS
  })

  let computed = 0
  let failed = 0

  await processInBatches(
    targets,
    CONCURRENCY,
    async (client) => {
      const readiness = await computeReadinessForClient(client)
      map[client.mondayItemId] = readiness
      computed++
    },
    () => Date.now() >= deadline,
  )

  // Persist the merged map — best-effort writes during the loop would race
  // across concurrent workers, so we batch one final write at the end.
  try {
    await writeReadinessMap(map)
  } catch (e) {
    console.error("[refresh-invoice-readiness] writeMap failed:", e instanceof Error ? e.message : e)
    failed = computed
    computed = 0
  }

  const remaining = targets.length - computed - failed
  return NextResponse.json({
    ok: true,
    durationMs: Date.now() - startedAt,
    eligible: eligible.length,
    targets: targets.length,
    computed,
    failed,
    remaining,
    deadlineHit: Date.now() >= deadline,
  })
}

export const GET = handler
export const POST = handler
