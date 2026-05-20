import { NextRequest, NextResponse } from "next/server"
import { readCache, writeCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import {
  fetchAllRecentInvoices,
  refreshBillingSummaries,
  type BillingSummary,
} from "@/lib/integrations/stripe"
import { authorizeCronOrAdmin } from "@/lib/slack/cron-auth"
import { startCronRun } from "@/lib/observability/cron-runs"
import { mondayStatusToHub } from "@/lib/clients/status"
import { reconcileAdministrationForClient } from "@/lib/clients/administration-sync"

/** How many days of past invoices to keep cached. Wider window = more data
 *  for the past-invoices tab, more API quota per refresh. 180d covers
 *  finance's typical reference range (chase old overdue, audit Q1, etc.) */
const PAST_INVOICES_DAYS = 180

export const maxDuration = 300

/**
 * Hourly cron — refreshes the `billing_summaries` cache (Stripe payment state
 * per customer) so the /billing page never shows payment state older than an
 * hour. Finance opens this page constantly and lots of state changes through
 * the day (invoices going out, payments coming in). The full refresh-cache
 * cron at 5:30 AM also touches this cache, but daily isn't enough.
 *
 * Strategy: fetch all clients with a Stripe customer id from the Monday cache,
 * pull each customer's billing summary in parallel (concurrency 5 — see
 * stripe.ts), merge into the existing cached map, write back. We MERGE
 * instead of replace so a Stripe API hiccup on one customer doesn't wipe its
 * previous summary.
 */
async function handler(req: NextRequest) {
  const authz = await authorizeCronOrAdmin(req)
  if (!authz.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tracker = startCronRun("refresh-billing-summaries")
  const startedAt = Date.now()

  try {
    const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
    )
    const boards = cached ?? (await fetchBothBoards().catch(() => ({ onboarding: [], current: [] })))
    const allClients = [...boards.onboarding, ...boards.current]

    const customerIds = Array.from(
      new Set(allClients.map((c) => c.stripeCustomerId).filter((id): id is string => !!id)),
    )

    if (customerIds.length === 0) {
      await tracker.ok({ refreshed: 0, failed: 0, customers: 0 })
      return NextResponse.json({ ok: true, durationMs: Date.now() - startedAt, refreshed: 0, failed: 0 })
    }

    const [summaryRes, pastInvoices] = await Promise.all([
      refreshBillingSummaries(customerIds),
      fetchAllRecentInvoices(PAST_INVOICES_DAYS).catch((e) => {
        console.error("[refresh-billing] past invoices fetch failed:", e instanceof Error ? e.message : e)
        return null
      }),
    ])

    const existing = (await readCache<Record<string, BillingSummary>>("billing_summaries")) ?? {}
    const merged = { ...existing, ...summaryRes.summaries }
    await writeCache("billing_summaries", merged)

    if (pastInvoices) {
      await writeCache("past_invoices", pastInvoices)
    }

    await writeCache("billing_refreshed_at", new Date().toISOString())

    // Reconcile Monday's "Administration" column against the freshly-pulled
    // Stripe state + cycle date. Bounded concurrency so we don't hammer Monday
    // when 50+ rows need a write at once; per-row errors are swallowed inside
    // `reconcileAdministrationForClient` so one bad client doesn't kill the
    // whole pass. Skip Onboarding/Churned — those statuses don't get invoiced
    // anyway so an admin label there would just be noise.
    const today = new Date().toISOString().slice(0, 10)
    const adminTargets = allClients.filter((c) => {
      const status = mondayStatusToHub(c.campaignStatus, c.boardType)
      return status === "live" || status === "on_hold"
    })

    let adminWritten = 0
    const ADMIN_CONCURRENCY = 5
    let cursor = 0
    async function nextWorker(): Promise<void> {
      while (cursor < adminTargets.length) {
        const client = adminTargets[cursor++]
        const summary = client.stripeCustomerId ? merged[client.stripeCustomerId] ?? null : null
        const wrote = await reconcileAdministrationForClient(client.mondayItemId, {
          campaignStatus: mondayStatusToHub(client.campaignStatus, client.boardType),
          stripe: summary,
          nextInvoiceDate: client.nextInvoiceDate || null,
          currentAdministration: client.administration,
          today,
        })
        if (wrote) adminWritten++
      }
    }
    await Promise.all(Array.from({ length: ADMIN_CONCURRENCY }, () => nextWorker()))

    const metrics = {
      customers: customerIds.length,
      refreshed: Object.keys(summaryRes.summaries).length,
      failed: summaryRes.failed,
      pastInvoices: pastInvoices?.length ?? null,
      adminWritten,
    }
    if (summaryRes.failed > 0) {
      await tracker.partial(`${summaryRes.failed} customer summaries failed`, metrics)
    } else {
      await tracker.ok(metrics)
    }

    return NextResponse.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      ...metrics,
    })
  } catch (e) {
    await tracker.fail(e)
    throw e
  }
}

export const GET = handler
export const POST = handler
