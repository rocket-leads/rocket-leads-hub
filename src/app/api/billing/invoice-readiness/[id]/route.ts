import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { readCache } from "@/lib/cache"
import { fetchItemUpdates, type MondayClient } from "@/lib/integrations/monday"
import {
  classifyInvoiceReadiness,
  HARD_TTL_MS,
  readReadinessMap,
  UPDATE_LOOKBACK_DAYS,
  writeReadinessMap,
  type InvoiceReadiness,
} from "@/lib/billing/invoice-readiness"
import type { BillingSummary } from "@/lib/integrations/stripe"

/**
 * Per-client AI verdict on whether finance should send the next invoice today.
 * The heavy lifting (prompt, classify, cache helpers) lives in
 * `lib/billing/invoice-readiness.ts` so the cron pre-warm can reuse it.
 *
 * This route handles the on-demand path: serve from cache when fresh, fall
 * through to a recompute when the latest Monday update is newer than the
 * cached entry, the entry is older than the hard TTL, or `?refresh=1` is set.
 */

export type { InvoiceReadiness }

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const refresh = req.nextUrl.searchParams.get("refresh") === "1"

  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const all = cached ? [...cached.onboarding, ...cached.current] : []
  const client = all.find((c) => c.mondayItemId === mondayItemId)
  if (!client) {
    return NextResponse.json({ error: "Client not in Monday cache" }, { status: 404 })
  }

  const updates = await fetchItemUpdates(mondayItemId, UPDATE_LOOKBACK_DAYS)
  const lastUpdateAt = updates[0]?.createdAt ?? null

  const map = await readReadinessMap()
  const existing = map[mondayItemId]
  const cacheStale =
    !existing ||
    (lastUpdateAt && existing.lastUpdateAt !== lastUpdateAt) ||
    Date.now() - new Date(existing.computedAt).getTime() > HARD_TTL_MS
  if (!refresh && !cacheStale && existing) {
    return NextResponse.json({ ...existing, updates, cached: true })
  }

  const billingCache = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
  const stripe = client.stripeCustomerId ? billingCache[client.stripeCustomerId] ?? null : null

  const result = await classifyInvoiceReadiness({
    client: { name: client.name, status: client.campaignStatus },
    updates,
    stripe,
    cycleStartDate: client.cycleStartDate || null,
    nextInvoiceDate: client.nextInvoiceDate || null,
  })

  const readiness: InvoiceReadiness = {
    ...result,
    updates,
    lastUpdateAt,
    computedAt: new Date().toISOString(),
  }
  map[mondayItemId] = readiness
  await writeReadinessMap(map)

  return NextResponse.json({ ...readiness, cached: false })
}
