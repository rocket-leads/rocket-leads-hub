import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { filterClientsByUser } from "@/lib/clients/filter"
import { categorize, severityScore } from "@/lib/watchlist/categorize"
import { listInboxItems, getInboxBadgeCounts, listChatThreads, type ChatThreadSummary } from "@/lib/inbox/fetchers"
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
import { PageHeader } from "@/components/ui/page-header"
import { ActionBlock } from "./_components/action-block"
import { InboxBlock } from "./_components/inbox-block"
import { ChannelsBlock } from "./_components/channels-block"
import { BillingBlock } from "./_components/billing-block"
import { safeFetch } from "@/lib/safe-fetch"

function HomeLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-72" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[280px] rounded-lg" />)}
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
  const userName = session.user.name ?? session.user.email ?? "there"
  const firstName = userName.split(" ")[0] ?? userName
  const locale = await getUserLocale(userId)

  // Pull everything in parallel - every block has its own bail-out so a
  // single source going down doesn't take the dashboard with it.
  const [
    boards,
    kpiCache,
    notesCache,
    stateRows,
    billingCache,
    agreementsByMondayId,
    myInboxItems,
    inboxBadgeCounts,
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
    userId
      ? getInboxBadgeCounts(userId, role === "admin" ? "admin" : "member").catch(() => ({
          unreadUpdates: 0,
          openTasks: 0,
          unreadChats: 0,
        }))
      : Promise.resolve({ unreadUpdates: 0, openTasks: 0, unreadChats: 0 }),
    fetchLastKpiRefreshAt(),
  ])

  const allCurrent = boards?.current ?? []
  const visibleClients = await filterClientsByUser(allCurrent, userId, role)
  const liveClients = visibleClients.filter((c) => c.campaignStatus === "Live")

  // Categorize each visible Live client to surface the Action items - the
  // home page still leads with "what's on fire" via ActionBlock. Health
  // score / KPI strip were removed 2026-06-11; severity is the only signal
  // we still need.
  const today = new Date().toISOString().slice(0, 10)
  const categorized = liveClients.map((client) => {
    const kpi = kpiCache[client.mondayItemId]
    const { category, insight } = categorize(client, kpi)
    const severity = kpi ? severityScore(kpi) : 0
    const state = stateRows[client.mondayItemId]
    const isNewToday = state?.category === category && state.sinceDate === today
    return { client, category, insight, kpi, severity, isNewToday }
  })

  const action = categorized.filter((c) => c.category === "action")

  // Team MRR (this month) - sum agreementMonthly across only those clients
  // whose billing cycle starts in the current calendar month. Now lives on
  // the BillingBlock alongside the open-invoice total (Roy 2026-06-11
  // collapsed the 4-tile KPI strip into the billing block).
  const thisMonthPrefix = new Date().toISOString().slice(0, 7) // "YYYY-MM"
  const thisMonthMrrClients = visibleClients.filter((c) =>
    c.cycleStartDate.startsWith(thisMonthPrefix),
  )
  const teamMrr = thisMonthMrrClients.reduce((sum, c) => {
    const mrr = agreementsByMondayId[c.mondayItemId] ?? 0
    return sum + mrr
  }, 0)
  const teamMrrClientCount = thisMonthMrrClients.reduce((n, c) => {
    const mrr = agreementsByMondayId[c.mondayItemId] ?? 0
    return mrr > 0 ? n + 1 : n
  }, 0)

  // Top action clients - sorted by severity desc (same ranking as watchlist).
  const topAction = [...action].sort((a, b) => b.severity - a.severity).slice(0, 5)

  // Overdue / open billing - clients with non-zero outstanding, sorted by
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

  // Inbox preview = Tasks + Updates only. Chat threads live in their own
  // ChannelsBlock (Roy 2026-06-12: "client gesprekken horen onder Channels,
  // niet bij Updates"). The block count mirrors that split so "Your Inbox"
  // doesn't claim chat unreads it isn't actually showing.
  const taskUpdateItems = myInboxItems.filter((it) => it.kind !== "chat")
  const chatItems = myInboxItems.filter((it) => it.kind === "chat")
  const topInbox = taskUpdateItems.slice(0, 5)
  const topChannels = chatItems.slice(0, 5)
  const unreadInboxCount = inboxBadgeCounts.unreadUpdates + inboxBadgeCounts.openTasks
  const unreadChannelsCount = inboxBadgeCounts.unreadChats

  return (
    <div className="space-y-6">
      {/* Header - /home is the "Today" landing. Greeting as the page title,
          today's date on the right (subtitle removed 2026-06-11 to cut
          repeating copy). */}
      <PageHeader
        title={t("home.greeting.morning", locale, { name: firstName })}
        subtitle={formatDate(new Date().toISOString(), locale)}
        actions={
          lastKpiRefreshAt ? (
            <span
              className="text-xs text-muted-foreground tabular-nums"
              title={new Date(lastKpiRefreshAt).toLocaleString(locale === "nl" ? "nl-NL" : "en-GB")}
            >
              {t("home.updated_prefix", locale, { ago: formatTimeAgo(lastKpiRefreshAt, locale) })}
            </span>
          ) : null
        }
      />

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
          teamMrr={teamMrr}
          teamMrrClientCount={teamMrrClientCount}
          locale={locale}
        />

        <ChannelsBlock
          items={topChannels}
          totalCount={unreadChannelsCount}
          locale={locale}
        />
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
 * Tasks open/in_progress + Updates unread + unread chat threads (Trengo +
 * Slack), shown as a single chronological preview list in the home Inbox
 * Block. Tasks/Updates are assignee-scoped; chat threads use the same
 * visibility rules as the Client Inbox / Team Inbox tabs (channel
 * subscription + client access + participant fallback). Snoozed tasks
 * excluded - same rules the inbox badge uses.
 *
 * Chat threads are mapped to the InboxItem shape so the existing render
 * path in inbox-block.tsx works unchanged. Fields the block doesn't read
 * are filled with safe defaults; the discriminator is `kind === "chat"`.
 */
async function fetchMyInbox(
  userId: string,
  role: string,
): Promise<InboxItem[]> {
  if (!userId) return []
  try {
    const roleArg = role === "admin" ? "admin" : "member"
    const [tasks, updates, externalThreads, internalThreads] = await Promise.all([
      listInboxItems(userId, role, { kind: "task", assignedToMe: true, snoozed: "active" }),
      listInboxItems(userId, role, { kind: "update", assignedToMe: true }),
      safeFetch("home:chat_threads_external", () => listChatThreads(userId, roleArg, "external"), [] as ChatThreadSummary[]),
      safeFetch("home:chat_threads_internal", () => listChatThreads(userId, roleArg, "internal"), [] as ChatThreadSummary[]),
    ])
    const chats = [...externalThreads, ...internalThreads]
      .filter((t) => t.unreadCount > 0)
      .map((t): InboxItem => ({
        id: `chat:${t.threadKey}`,
        kind: "chat",
        clientId: "",
        clientName: t.clientName ?? "",
        authorId: "",
        authorName: t.primaryName,
        authorExternal: null,
        assigneeId: "",
        assigneeName: "",
        title: t.channelName ? `${t.primaryName} · ${t.channelName}` : t.primaryName,
        body: t.latestPreview || null,
        status: "unread",
        priority: null,
        dueDate: null,
        source: t.source,
        channelKind:
          t.channelKind === "whatsapp" || t.channelKind === "email"
            ? t.channelKind
            : t.channelKind == null
              ? null
              : "other",
        sourceRef: { threadKey: t.threadKey, scope: t.scope },
        mondayUpdateId: null,
        isUnlinked: false,
        snoozedUntil: null,
        createdAt: t.latestAt,
        updatedAt: t.latestAt,
        completedAt: null,
        commentCount: t.unreadCount,
      }))
    return [...tasks, ...updates, ...chats].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  } catch {
    return []
  }
}

/**
 * Per-client MRR keyed by monday_item_id. Same data the Clients overview
 * pulls via `/api/clients/agreements-summary` - we read the table directly
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
 * Per-client action notes - reads the `client_pedro` JSON insight and returns
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
 * Last successful refresh-kpi cron run - drives the "Updated Xm ago" stamp
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

