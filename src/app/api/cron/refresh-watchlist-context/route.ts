import { NextRequest, NextResponse } from "next/server"
import { readCache, writeCache } from "@/lib/cache"
import { collectClientContext, type ClientContext } from "@/lib/watchlist/collect-context"
import type { MondayClient } from "@/lib/integrations/monday"

export const maxDuration = 300 // 5 minutes max

export async function GET(req: NextRequest) {
  const startTime = Date.now()

  // Auth: Vercel cron or manual trigger with secret
  const authHeader = req.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get Live clients from cached boards
  const boards = await readCache<{ current: MondayClient[] }>("monday_boards")
  if (!boards?.current) {
    return NextResponse.json({ error: "No board cache available" }, { status: 503 })
  }

  const liveClients = boards.current.filter((c) => c.campaignStatus === "Live")

  // Load existing context cache to preserve data for clients we skip
  const existing = await readCache<Record<string, ClientContext>>("watchlist_context") ?? {}

  const results: Record<string, ClientContext> = { ...existing }
  let processed = 0
  let errors = 0

  // Process in batches of 3 to respect Monday + Trengo rate limits
  const BATCH_SIZE = 3
  for (let i = 0; i < liveClients.length; i += BATCH_SIZE) {
    const batch = liveClients.slice(i, i + BATCH_SIZE)

    const settled = await Promise.allSettled(
      batch.map((client) => collectClientContext(client))
    )

    for (let j = 0; j < settled.length; j++) {
      const result = settled[j]
      const client = batch[j]
      if (result.status === "fulfilled") {
        const ctx = result.value
        // Only store if we got any content
        if (ctx.mondayUpdates || ctx.trengoSummary) {
          results[client.mondayItemId] = ctx
          processed++
        }
      } else {
        errors++
        console.error(`Context error for ${client.name}:`, result.reason)
      }
    }

    // Small delay between batches to be kind to APIs
    if (i + BATCH_SIZE < liveClients.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  // Write all results to cache
  await writeCache("watchlist_context", results)

  const duration = ((Date.now() - startTime) / 1000).toFixed(1)
  return NextResponse.json({
    ok: true,
    duration: `${duration}s`,
    liveClients: liveClients.length,
    enriched: processed,
    errors,
  })
}
