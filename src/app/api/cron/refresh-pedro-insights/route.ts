import { NextRequest, NextResponse } from "next/server"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { readCache } from "@/lib/cache"
import { fetchBothBoards } from "@/lib/integrations/monday"
import type { MondayClient } from "@/lib/integrations/monday"
import { collectClientAiContext } from "@/lib/pedro/insights/context"
import { generateAndPersistInsight } from "@/lib/pedro/insights/generate"
import { ALL_INSIGHT_TYPES } from "@/lib/pedro/insights/registry"
import { getAiLocale } from "@/lib/i18n/server"

/**
 * Pedro insights refresh — the unified AI hub for the Hub.
 *
 * For every Live client, build the canonical context bundle once and
 * generate every insight type registered in INSIGHT_REGISTRY. Each
 * insight upserts into pedro_insights; the next cron tick replaces it.
 *
 * One cron, one Claude pipeline, one cache. v2 collapses the per-client
 * AI surface to a single `client_pedro` insight (JSON body with conclusion
 * + action bullets) consumed by the client detail page, the watchlist row
 * 1-liner, and the home page action notes — no more contradictions between
 * separately-generated voices.
 *
 * Schedule: hourly. KPI freshness only changes daily, but Monday/Trengo/
 * inbox events shift through the day, so an hourly refresh keeps notes
 * relevant without bombing Anthropic — Live client count × insight types
 * is small (<100 calls per tick today; Haiku for the short notes).
 *
 * Concurrency capped at 4 to stay polite with Anthropic rate limits.
 * Time-budgeted at 4.5 min so we always emit a heartbeat before Vercel
 * kills us.
 */

export const maxDuration = 300

const CONCURRENCY = 4
const TIME_BUDGET_MS = 4 * 60 * 1000 + 30_000

export async function GET(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("refresh-pedro-insights")
  const startedAt = Date.now()
  const deadline = startedAt + TIME_BUDGET_MS

  try {
    // Resolve the workspace AI locale once for the whole run. All clients
    // get insights in the same language regardless of who reads — AI cache
    // is workspace-wide.
    const aiLocale = await getAiLocale()

    // Load Live clients from the cron-warmed cache. Live-only — no point
    // generating insights for churned/onboarding clients (no AM uses them).
    const cached = await readCache<{ current: MondayClient[] }>("monday_boards")
    const data = cached ?? (await fetchBothBoards())
    const liveClients = data.current.filter((c) => c.campaignStatus === "Live")

    let processed = 0
    let generated = 0
    let skipped = 0
    let failed = 0
    const errors: Array<{ client: string; type: string; error: string }> = []

    // Build (client, insight_type) tasks once. The fan-out is across this
    // flat list so we keep parallelism without nesting promises.
    const tasks: Array<{ client: MondayClient; type: (typeof ALL_INSIGHT_TYPES)[number] }> =
      []
    for (const client of liveClients) {
      for (const type of ALL_INSIGHT_TYPES) {
        tasks.push({ client, type })
      }
    }

    // Per-client context is expensive (multiple Supabase + integration calls).
    // Cache it so all insight types for the same client share one bundle —
    // common-case is many types per client, doing the work once is the win.
    const contextCache = new Map<string, Awaited<ReturnType<typeof collectClientAiContext>>>()

    async function getCtx(client: MondayClient) {
      const hit = contextCache.get(client.mondayItemId)
      if (hit) return hit
      const fresh = await collectClientAiContext(client)
      contextCache.set(client.mondayItemId, fresh)
      return fresh
    }

    let cursor = 0
    async function worker(): Promise<void> {
      while (cursor < tasks.length) {
        if (Date.now() >= deadline) return
        const idx = cursor++
        const task = tasks[idx]
        try {
          const ctx = await getCtx(task.client)
          const result = await generateAndPersistInsight(task.type, ctx, aiLocale)
          processed++
          if (result.ok) generated++
          else if (result.skippedReason?.startsWith("registry shouldGenerate")) skipped++
          else {
            failed++
            errors.push({
              client: task.client.name,
              type: task.type,
              error: result.skippedReason ?? "unknown",
            })
          }
        } catch (e) {
          processed++
          failed++
          errors.push({
            client: task.client.name,
            type: task.type,
            error: e instanceof Error ? e.message : String(e),
          })
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

    const durationMs = Date.now() - startedAt
    const metrics = {
      durationMs,
      liveClients: liveClients.length,
      tasks: tasks.length,
      processed,
      generated,
      skipped,
      failed,
      deadlineHit: Date.now() >= deadline,
    }

    if (failed > 0) {
      await tracker.partial(`${failed} of ${tasks.length} generations failed`, metrics)
    } else {
      await tracker.ok(metrics)
    }

    return NextResponse.json({
      ok: true,
      ...metrics,
      errors: errors.slice(0, 20),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[refresh-pedro-insights] fatal:", message)
    await tracker.fail(e)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
