import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { categorize, severityScore } from "@/lib/watchlist/categorize"
import { listInboxItems } from "@/lib/inbox/fetchers"
import { createAdminClient } from "@/lib/supabase/server"
import { agreementMonthly, normalizeAgreement } from "@/lib/clients/agreement"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import { formatDate, formatTimeAgo } from "@/lib/i18n/format"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { WatchlistClientState } from "@/app/api/watchlist/state/route"
import type { InboxItem } from "@/types/inbox"
import { Skeleton } from "@/components/ui/skeleton"
import { ActionBlock } from "./_components/action-block"
import { InboxBlock } from "./_components/inbox-block"
import { BillingBlock } from "./_components/billing-block"
import { PedroBlock, type PedroProposal } from "./_components/pedro-block"
import { KpiStrip } from "./_components/kpi-strip"
import { WeeklyUpdateDraftsBanner } from "@/app/(dashboard)/clients/_components/weekly-update-drafts-banner"

function HomeLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[110px] rounded-lg" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[280px] rounded-lg" />)}
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <div>
      <Suspense fallback={<HomeLoading />}>
        <HomeData />
      </Suspense>
    </div>
  )
}

async function HomeData() {
  const session = await auth()
  if (!session) return null

  const userId = session.user.id ?? ""
  const role = session.user.role ?? "member"
  const isAdmin = role === "admin"
  const userName = session.user.name ?? session.user.email ?? "there"
  const firstName = userName.split(" ")[0] ?? userName
  const locale = await getUserLocale(userId)

  // Pull everything in parallel — every block has its own bail-out so a
  // single source going down doesn't take the dashboard with it.
  const [
    boards,
    kpiCache,
    notesCache,
    stateRows,
    billingCache,
    agreementsByMondayId,
    myInboxItems,
    pedroProposals,
    lastKpiRefreshAt,
  ] = await Promise.all([
    readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>("monday_boards").then(
      (c) => c ?? fetchBothBoards().catch(() => ({ onboarding: [], current: [] })),
    ),
    readCache<Record<string, KpiSummary>>("kpi_summaries").then((c) => c ?? {}),
    fetchActionNotes(),
    fetchWatchlistState(),
    readCache<Record<string, BillingSummary>>("billing_summaries").then((c) => c ?? {}),
    fetchAgreementsByMondayId(),
    fetchMyInbox(userId, role),
    isAdmin ? fetchPendingPedroProposals() : Promise.resolve<PedroProposal[]>([]),
    fetchLastKpiRefreshAt(),
  ])

  const allCurrent = boards?.current ?? []
  const visibleClients = await filterClientsByUser(allCurrent, userId, role)
  const liveClients = visibleClients.filter((c) => c.campaignStatus === "Live")

  // Categorize each visible Live client using the same logic the watchlist uses
  // so the home page numbers line up exactly with /watchlist when filtered to
  // the same scope.
  const today = new Date().toISOString().slice(0, 10)
  const categorized = liveClients.map((client) => {
    const kpi = kpiCache[client.mondayItemId]
    const { category, insight } = categorize(client, kpi)
    const severity = kpi ? severityScore(kpi) : 0
    const state = stateRows[client.mondayItemId]
    const isNewToday = state?.category === category && state.sinceDate === today
    return { client, category, insight, kpi, severity, isNewToday, state }
  })

  const action = categorized.filter((c) => c.category === "action")
  const watch = categorized.filter((c) => c.category === "watch")
  const good = categorized.filter((c) => c.category === "good")

  // Health score = good / (action + watch + good). Same formula as the Watch
  // List header. Excludes no-data so a setup gap doesn't water down the score.
  const healthDenominator = action.length + watch.length + good.length
  const healthScore =
    healthDenominator > 0 ? Math.round((good.length / healthDenominator) * 100) : null

  // Team MRR — sum agreementMonthly across the user's visible clients (any
  // status). Drives the "what is this team currently running" KPI. Admins
  // see the org-wide total since filterClientsByUser returns everything for
  // them. CMs/AMs see only their own team.
  const teamMrr = visibleClients.reduce((sum, c) => {
    const mrr = agreementsByMondayId[c.mondayItemId] ?? 0
    return sum + mrr
  }, 0)
  const teamMrrClientCount = visibleClients.reduce((n, c) => {
    const mrr = agreementsByMondayId[c.mondayItemId] ?? 0
    return mrr > 0 ? n + 1 : n
  }, 0)

  // Yesterday counts so the KPI strip can show day-over-day deltas. The cron
  // updates `watchlist_client_state` once per day, so for a client that
  // transitioned today, prev_category is what they were yesterday; otherwise
  // their current category was their bucket yesterday too.
  const yesterdayActionCount = (() => {
    let n = 0
    for (const c of categorized) {
      const yCat = c.state?.sinceDate === today ? c.state?.prevCategory : c.state?.category
      if (yCat === "action") n++
    }
    return n
  })()

  // Top action clients — sorted by severity desc (same ranking as watchlist).
  const topAction = [...action].sort((a, b) => b.severity - a.severity).slice(0, 5)

  // Overdue / open billing — clients with non-zero outstanding, sorted by
  // amount desc. Filtered to user-visible clients.
  const overdueClients = visibleClients
    .map((client) => {
      if (!client.stripeCustomerId) return null
      const summary = billingCache[client.stripeCustomerId]
      if (!summary || summary.outstanding <= 0) return null
      return { client, summary }
    })
    .filter((x): x is { client: MondayClient; summary: BillingSummary } => x !== null)
    .sort((a, b) => b.summary.outstanding - a.summary.outstanding)

  const totalOutstanding = overdueClients.reduce((s, x) => s + x.summary.outstanding, 0)
  const topOverdue = overdueClients.slice(0, 5)

  // Inbox — counts already capped server-side; take top 5 by created_at desc.
  const topInbox = myInboxItems.slice(0, 5)
  const unreadInboxCount = myInboxItems.length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">
            {t("home.greeting.morning", locale, { name: firstName })}
          </h1>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {formatDate(new Date().toISOString(), locale)}
          </p>
        </div>
        {lastKpiRefreshAt && (
          <span
            className="text-[11px] text-muted-foreground/40 mt-2 tabular-nums shrink-0"
            title={new Date(lastKpiRefreshAt).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB")}
          >
            {t("home.updated_prefix", locale, { ago: formatTimeAgo(lastKpiRefreshAt, locale) })}
          </span>
        )}
      </div>

      {/* Weekly update drafts banner — self-hides when count is zero, so on
          most days this is invisible. Mondays after 06:00 UTC it shows
          everyone's pending drafts and opens the split-pane queue sheet. */}
      <WeeklyUpdateDraftsBanner />

      {/* KPI strip */}
      <KpiStrip
        actionCount={action.length}
        actionDelta={action.length - yesterdayActionCount}
        unreadInboxCount={unreadInboxCount}
        healthScore={healthScore}
        teamMrr={teamMrr}
        teamMrrClientCount={teamMrrClientCount}
        locale={locale}
      />

      {/* 2x2 grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ActionBlock
          items={topAction.map((c) => ({
            mondayItemId: c.client.mondayItemId,
            name: c.client.name,
            insight: c.insight,
            aiNote: notesCache[c.client.mondayItemId] ?? null,
            isNewToday: c.isNewToday,
            spend: c.kpi?.adSpend ?? 0,
            leads: c.kpi?.leads ?? 0,
            cpl: c.kpi?.cpl ?? 0,
          }))}
          totalCount={action.length}
          locale={locale}
        />

        <InboxBlock
          items={topInbox}
          totalCount={unreadInboxCount}
          locale={locale}
        />

        <BillingBlock
          items={topOverdue.map((x) => ({
            mondayItemId: x.client.mondayItemId,
            name: x.client.name,
            outstanding: x.summary.outstanding,
            status: x.summary.status,
          }))}
          totalCount={overdueClients.length}
          totalOutstanding={totalOutstanding}
          locale={locale}
        />

        {isAdmin && (
          <PedroBlock
            items={pedroProposals.slice(0, 3)}
            totalCount={pedroProposals.length}
            locale={locale}
          />
        )}
      </div>
    </div>
  )
}

async function fetchWatchlistState(): Promise<Record<string, WatchlistClientState>> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("watchlist_client_state")
      .select("monday_item_id, category, prev_category, since_date")
    const out: Record<string, WatchlistClientState> = {}
    for (const row of data ?? []) {
      out[row.monday_item_id] = {
        category: row.category,
        prevCategory: row.prev_category ?? null,
        sinceDate: row.since_date,
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Tasks open/in_progress + Updates unread, both assigned to the current user.
 * Snoozed tasks are excluded — same rules the inbox badge uses.
 */
async function fetchMyInbox(userId: string, role: string): Promise<InboxItem[]> {
  if (!userId) return []
  try {
    const [tasks, updates] = await Promise.all([
      listInboxItems(userId, role, { kind: "task", assignedToMe: true, snoozed: "active" }),
      listInboxItems(userId, role, { kind: "update", assignedToMe: true }),
    ])
    return [...tasks, ...updates].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  } catch {
    return []
  }
}

/**
 * Per-client MRR keyed by monday_item_id. Same data the Clients overview
 * pulls via `/api/clients/agreements-summary` — we read the table directly
 * here so the home page renders in one server pass.
 */
async function fetchAgreementsByMondayId(): Promise<Record<string, number>> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("client_agreements")
      .select(
        "ad_budget, platforms, platform_fees, follow_up, follow_up_fee, clients!inner(monday_item_id)",
      )

    const out: Record<string, number> = {}
    for (const row of data ?? []) {
      const joined = row.clients as
        | { monday_item_id: string }
        | { monday_item_id: string }[]
        | null
      const mondayItemId = Array.isArray(joined)
        ? joined[0]?.monday_item_id
        : joined?.monday_item_id
      if (!mondayItemId) continue
      const agreement = normalizeAgreement(row)
      out[mondayItemId] = agreementMonthly(agreement)
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Per-client action notes — reads the `client_pedro` JSON insight and returns
 * just the conclusion sentence as the 1-liner. Same source the client detail
 * page renders, so the home preview and the deep dive can't disagree.
 */
async function fetchActionNotes(): Promise<Record<string, string>> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("pedro_insights")
      .select("monday_item_id, body")
      .eq("insight_type", "client_pedro")
    const { parsePedroBody } = await import("@/lib/pedro/insights/types")
    const out: Record<string, string> = {}
    for (const row of data ?? []) {
      const parsed = parsePedroBody(row.body)
      if (parsed?.conclusion) out[row.monday_item_id] = parsed.conclusion
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Last successful refresh-kpi cron run — drives the "Updated Xm ago" stamp
 * in the page header. Falls back to null on any failure (no row, schema
 * miss, Supabase blip) so the header gracefully omits the stamp instead of
 * crashing the page render.
 */
async function fetchLastKpiRefreshAt(): Promise<string | null> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("cron_runs")
      .select("started_at")
      .eq("cron_name", "refresh-kpi")
      .eq("status", "ok")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.started_at ?? null
  } catch {
    return null
  }
}

async function fetchPendingPedroProposals(): Promise<PedroProposal[]> {
  try {
    const supabase = await createAdminClient()
    const { data } = await supabase
      .from("pedro_knowledge_proposals")
      .select("id, title, proposal_body, vertical, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(20)
    return (data ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      vertical: r.vertical,
      // Just the first line — the body is full markdown and would blow up the row.
      summary: typeof r.proposal_body === "string"
        ? r.proposal_body.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "") ?? null
        : null,
      created_at: r.created_at,
    }))
  } catch {
    return []
  }
}
