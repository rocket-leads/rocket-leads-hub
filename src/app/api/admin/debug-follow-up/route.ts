import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * Throwaway diagnostic — dumps every unique value of the `followUpStatus`
 * column across all clients, with counts and sample client names. Used to
 * audit what the actual labels in Monday look like so the seed matcher can
 * be built against real data instead of guesses.
 *
 * Admin-only. Safe to delete once the matcher is correct.
 */
async function run(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  // Cache by default (fast, ~instant). Use `?live=1` to bypass and read live
  // from Monday — slower (5-15s for ~750 items) but guaranteed fresh, e.g.
  // right after a deploy that adds a new MondayClient field where the cron
  // hasn't yet repopulated `monday_boards`. The endpoint flags `cacheStale`
  // when the cached payload is missing `followUpStatus` so the caller knows
  // to retry with `?live=1` or wait for the next cron run.
  const url = new URL(req.url)
  const live = url.searchParams.get("live") === "1"

  let clients: MondayClient[]
  let source: "live" | "cache"
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

  const cacheStale =
    source === "cache" &&
    clients.length > 0 &&
    !Object.prototype.hasOwnProperty.call(clients[0], "followUpStatus")

  const buckets = new Map<string, { count: number; samples: string[] }>()
  for (const c of clients) {
    const key = c.followUpStatus || "(empty)"
    const bucket = buckets.get(key) ?? { count: 0, samples: [] }
    bucket.count++
    if (bucket.samples.length < 3) bucket.samples.push(c.name)
    buckets.set(key, bucket)
  }

  const summary = Array.from(buckets.entries())
    .map(([label, { count, samples }]) => ({ label, count, samples }))
    .sort((a, b) => b.count - a.count)

  // Also surface the specific client Roy mentioned so we can see exactly what
  // got read from Monday vs what the matcher decided.
  const varel = clients.find((c) => /varel/i.test(c.name))

  return NextResponse.json({
    source,
    cacheStale,
    cacheStaleHint: cacheStale
      ? "Cached data is missing followUpStatus — re-run with ?live=1 or wait for the next /api/cron/refresh-cache run."
      : undefined,
    totalClients: clients.length,
    uniqueLabels: summary,
    varelDebug: varel
      ? {
          name: varel.name,
          followUpStatus: varel.followUpStatus,
          followUpFee: varel.followUpFee,
          serviceFee: varel.serviceFee,
          adBudget: varel.adBudget,
        }
      : null,
  })
}

export const GET = run
export const POST = run
export const maxDuration = 60
