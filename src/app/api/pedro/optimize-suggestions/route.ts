import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { filterClientsByUser } from "@/lib/clients/filter"
import { mondayStatusToHub } from "@/lib/clients/status"
import {
  categorize,
  severityScore,
  type WatchCategory,
} from "@/lib/watchlist/categorize"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { BillingHealthVerdict } from "@/lib/clients/billing-health"

/**
 * Pedro Optimize — Action Needed client suggestions for the strip at the
 * top of the Optimize page. Returns the current user's accessible clients
 * that are currently in the Watch List Action bucket, ranked by severity
 * (most urgent first), capped at MAX_SUGGESTIONS.
 *
 * Why per-user scope (not global): a Campaign Manager only optimises the
 * clients they own. Suggesting Vlex to Stefan when Mike runs Vlex would
 * push him into someone else's lane. Admin + finance see all (consistent
 * with how `filterClientsByUser` treats them everywhere else).
 *
 * Why severity-ranked (not alphabetical, not days-in-bucket): severity
 * already prioritises billing errors > live-but-dark > big-spend CPL
 * spikes > small-spend CPL spikes — the exact order a CM would tackle
 * them in. See `severityScore` in [watchlist/categorize.ts] for the
 * formula + floors.
 *
 * Why we re-run categorize() instead of reading `watchlist_client_state`:
 * the state table only stores the category enum, not the insight string
 * or severity. The cron-warmed caches we read here (kpi_summaries,
 * meta_billing_health, monday_boards) are the same inputs that wrote the
 * state table; running categorize() on top is cheap and keeps the
 * strip's text identical to the Watch List row's text. No staleness skew.
 */

const MAX_SUGGESTIONS = 8

export type OptimizeSuggestion = {
  clientId: string
  name: string
  insight: string
  severity: number
  /** Which underlying signal is driving this — used to pick the right icon
   *  in the UI (billing chip vs CPL chip vs dark chip). Mirrors the
   *  branches in categorize() roughly; UI shouldn't need to know the
   *  thresholds. */
  signalKind: "billing" | "live_but_dark" | "no_leads" | "cpl_spike" | "other"
  /** Days the client has been in the Action bucket. Derived from
   *  `watchlist_client_state.since_date`. Null when the state table has
   *  no row yet (very first cron tick or new client). */
  daysInBucket: number | null
  /** Drives the "Onboarding" vs "Live" pill on the chip. Mirrors what
   *  Optimize already shows next to the picker. */
  boardType: "onboarding" | "current"
}

export type OptimizeSuggestionsResponse = {
  suggestions: OptimizeSuggestion[]
  /** Hub-canonical user id this was computed for — handy for client-side
   *  cache invalidation when the session user changes. */
  userId: string
}

/** Pick the signal kind from the insight string. categorize() emits
 *  English insights by default (locale="en" path); we string-match on
 *  the stable phrase fragments rather than re-running the rule logic. */
function inferSignalKind(insight: string): OptimizeSuggestion["signalKind"] {
  const lc = insight.toLowerCase()
  if (lc.startsWith("billing error") || lc.startsWith("severe underspend")) return "billing"
  if (lc.includes("live but no spend")) return "live_but_dark"
  if (lc.includes("0 leads")) return "no_leads"
  if (lc.includes("cpl up") || lc.includes("cpl rising")) return "cpl_spike"
  return "other"
}

function daysBetween(fromDate: string, today: string): number {
  const a = new Date(fromDate + "T00:00:00Z").getTime()
  const b = new Date(today + "T00:00:00Z").getTime()
  return Math.max(0, Math.floor((b - a) / 86_400_000))
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = await createAdminClient()

    // Read the cron-warmed caches in parallel. Each fall back to an empty
    // object — categorize() handles null/undefined KPI gracefully, and the
    // strip simply omits clients we can't categorize.
    const [boards, kpiCache, billingHealthCache, stateRows] = await Promise.all([
      readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards"),
      readCache<Record<string, KpiSummary>>("kpi_summaries"),
      readCache<Record<string, BillingHealthVerdict>>("meta_billing_health"),
      supabase
        .from("watchlist_client_state")
        .select("monday_item_id, category, since_date")
        .eq("category", "action")
        .then((r) => r.data ?? []),
    ])

    if (!boards) {
      // Cold cache (very first deploy / cache wiped). Return empty
      // gracefully — the strip just shows the empty state until the next
      // refresh-cache cron tick warms the boards.
      return NextResponse.json<OptimizeSuggestionsResponse>({
        suggestions: [],
        userId: session.user.id,
      })
    }

    const allClients = [...boards.onboarding, ...boards.current]

    // Filter to clients this user can actually optimise. Admin + finance
    // skip the filter inside loadUserMappingsContext; everyone else gets
    // their AM/CM/Setter-mapped clients only.
    const userClients = await filterClientsByUser(
      allClients,
      session.user.id,
      session.user.role,
    )

    // Action state map keyed by mondayItemId for O(1) lookups in the loop.
    type StateRow = { monday_item_id: string; category: string; since_date: string }
    const actionStateById = new Map<string, StateRow>()
    for (const row of (stateRows ?? []) as StateRow[]) {
      actionStateById.set(row.monday_item_id, row)
    }

    const today = new Date().toISOString().slice(0, 10)

    // For each accessible client, re-categorize with the same inputs the
    // state-table cron used so the insight string here matches the Watch
    // List row 1:1. Skip everything that isn't currently Action.
    const candidates: OptimizeSuggestion[] = []
    for (const client of userClients) {
      // Pre-filter on the state table — saves running categorize() on
      // ~95% of clients that aren't in Action right now.
      const state = actionStateById.get(client.mondayItemId)
      if (!state) continue

      const kpi = kpiCache?.[client.mondayItemId]
      const billingHealth = billingHealthCache?.[client.mondayItemId] ?? null
      const clientStatus = mondayStatusToHub(client.campaignStatus, client.boardType)

      const { category, insight }: { category: WatchCategory; insight: string } = categorize(
        client,
        kpi,
        "en",
        { clientStatus, billingHealth },
      )
      // The state table can lag a tick — if categorize() now says
      // something other than action, trust the live verdict (skip).
      if (category !== "action") continue

      const severity = kpi ? severityScore(kpi, { clientStatus, billingHealth }) : 0

      candidates.push({
        clientId: client.mondayItemId,
        name: client.companyName || client.name,
        insight,
        severity,
        signalKind: inferSignalKind(insight),
        daysInBucket: state.since_date ? daysBetween(state.since_date, today) : null,
        boardType: client.boardType,
      })
    }

    candidates.sort((a, b) => {
      // Severity descending; tiebreak on days-in-bucket descending so the
      // "been red longer" client floats above the fresh spike at the same
      // score. Mirrors `sortByImpact` in watchlist-dashboard.
      if (b.severity !== a.severity) return b.severity - a.severity
      return (b.daysInBucket ?? 0) - (a.daysInBucket ?? 0)
    })

    return NextResponse.json<OptimizeSuggestionsResponse>(
      {
        suggestions: candidates.slice(0, MAX_SUGGESTIONS),
        userId: session.user.id,
      },
      { headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=120" } },
    )
  } catch (e) {
    console.error(
      "[pedro/optimize-suggestions] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load suggestions" },
      { status: 500 },
    )
  }
}
