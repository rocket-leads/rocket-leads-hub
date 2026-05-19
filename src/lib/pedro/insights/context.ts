import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { BillingSummary } from "@/lib/integrations/stripe"
import type { ClientContext as MondayTrengoContext } from "@/lib/watchlist/collect-context"
import { collectClientContext } from "@/lib/watchlist/collect-context"
import { agreementMonthly, normalizeAgreement, type Agreement } from "@/lib/clients/agreement"
import { getRecentSignal, type RecentSignal } from "@/lib/watchlist/categorize"

/**
 * Single canonical context bundle for ALL Hub AI insights. Replaces the
 * fragmented per-endpoint collectors that each pulled their own subset of
 * data — now there's exactly one shape every prompt sees, exactly one
 * collector to maintain, exactly one sources_used audit trail.
 *
 * Designed to be permissive: missing source = empty/null, never throws.
 * Each prompt picks what it needs from the bundle and the corresponding
 * `sources` flag tells downstream guardrails what's actually available.
 *
 * Add new sources here as we wire up Phase E (internal Slack/team chat),
 * Fathom action items, etc — every consumer benefits without touching
 * its own code.
 */

export type AiContextSources = {
  /** True when KPI cache had a row for this client. */
  kpi: boolean
  /** True when the daily trend (sparkline) was present, enabling recent-window logic. */
  recentWindow: boolean
  /** True when Monday board fetch returned items (CRM linked + working). */
  mondayUpdates: boolean
  /** True when Trengo conversations returned at least one message. */
  trengoSummary: boolean
  /** True when at least one Fathom meeting (linked to this client) was found. */
  fathomMeetings: boolean
  /** True when at least one inbox event (task or update) tied to this client was found. */
  inboxEvents: boolean
  /** True when an agreement row exists in client_agreements. */
  agreement: boolean
  /** True when a billing summary exists for the client's Stripe customer. */
  billing: boolean
}

export type FathomMeetingContext = {
  meetingId: string
  /** sales / kick_off / evaluation / internal / other */
  meetingType: string | null
  scheduledAt: string | null
  title: string | null
  /** First ~600 chars of the AI summary — full transcript is too big for prompts. */
  summary: string | null
  /** Up to 5 action items as { description, completed, assignee_email }. */
  actionItems: Array<{ description: string; completed: boolean; assignee_email?: string }>
}

export type InboxEventContext = {
  id: string
  kind: "task" | "update" | "chat"
  title: string
  body: string | null
  status: string
  source: string
  authorName: string
  assigneeName: string | null
  createdAt: string
}

export type ClientAiContext = {
  /** Hub-canonical client identifier. */
  clientId: string
  client: MondayClient
  /** 7d KPI summary — cpl, prevCpl, leads, deals, etc. Null when missing. */
  kpi: KpiSummary | null
  /** Recent-window CPL signal (1d/2d/3d) — nullable. */
  recent: RecentSignal | null
  /** Monday + Trengo qualitative summary — already-rendered strings. */
  mondayTrengo: MondayTrengoContext | null
  /** Last 5 Fathom meetings linked to this client (newest first). */
  fathomMeetings: FathomMeetingContext[]
  /** Last 10 inbox events for this client (tasks/updates/chat, newest first). */
  inboxEvents: InboxEventContext[]
  /** Monthly recurring revenue per the agreement. 0 when no agreement. */
  agreement: { agreement: Agreement; monthly: number } | null
  /** Stripe payment state. Null when no Stripe customer or cache miss. */
  billing: BillingSummary | null
  /** Which sources actually contributed — drives the sources_used audit on pedro_insights. */
  sources: AiContextSources
  /** ISO timestamp the bundle was assembled (so debug surfaces can show "as of X"). */
  collectedAt: string
}

const FATHOM_LIMIT = 5
const INBOX_LIMIT = 10

/**
 * Build the full context bundle for one client. Pulls every source in
 * parallel so a slow Fathom query doesn't block the rest. Each source
 * has its own try/catch and falls back to its empty shape — the prompt
 * either uses what's available or falls through to fewer angles.
 */
export async function collectClientAiContext(
  client: MondayClient,
): Promise<ClientAiContext> {
  const supabase = await createAdminClient()
  const collectedAt = new Date().toISOString()

  // Pull KPI + billing from existing caches in parallel — they're already
  // cron-warmed so this is a single fast Supabase round-trip each.
  const [
    kpiCache,
    billingCache,
    mondayTrengo,
    fathomMeetings,
    inboxEvents,
    agreementBundle,
  ] = await Promise.all([
    readCache<Record<string, KpiSummary>>("kpi_summaries").then((c) => c ?? {}),
    readCache<Record<string, BillingSummary>>("billing_summaries").then((c) => c ?? {}),
    safe(() => collectClientContext(client), null as MondayTrengoContext | null),
    safe(() => fetchFathomMeetingsForClient(supabase, client.mondayItemId), []),
    safe(() => fetchInboxEventsForClient(supabase, client.mondayItemId), []),
    safe(() => fetchAgreementForClient(supabase, client.mondayItemId), null as { agreement: Agreement; monthly: number } | null),
  ])

  const kpi = kpiCache[client.mondayItemId] ?? null
  const billing = client.stripeCustomerId ? billingCache[client.stripeCustomerId] ?? null : null
  const recent = kpi ? getRecentSignal(kpi) : null

  const sources: AiContextSources = {
    kpi: kpi !== null,
    recentWindow: recent !== null,
    mondayUpdates: !!mondayTrengo?.mondayUpdates,
    trengoSummary: !!mondayTrengo?.trengoSummary,
    fathomMeetings: fathomMeetings.length > 0,
    inboxEvents: inboxEvents.length > 0,
    agreement: agreementBundle !== null,
    billing: billing !== null,
  }

  return {
    clientId: client.mondayItemId,
    client,
    kpi,
    recent,
    mondayTrengo,
    fathomMeetings,
    inboxEvents,
    agreement: agreementBundle,
    billing,
    sources,
    collectedAt,
  }
}

// ─── Source-specific fetchers (private) ──────────────────────────────────

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    console.error(
      "[pedro/context] source fetch failed:",
      e instanceof Error ? e.message : e,
    )
    return fallback
  }
}

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

async function fetchFathomMeetingsForClient(
  supabase: Supabase,
  mondayItemId: string,
): Promise<FathomMeetingContext[]> {
  const { data } = await supabase
    .from("meetings")
    .select("id, meeting_type, scheduled_at, title, summary, action_items")
    .eq("client_id", mondayItemId)
    .eq("link_status", "linked")
    .order("scheduled_at", { ascending: false })
    .limit(FATHOM_LIMIT)

  type Row = {
    id: string
    meeting_type: string | null
    scheduled_at: string | null
    title: string | null
    summary: string | null
    action_items: unknown
  }

  return ((data ?? []) as Row[]).map((row) => ({
    meetingId: row.id,
    meetingType: row.meeting_type,
    scheduledAt: row.scheduled_at,
    title: row.title,
    // Trim heavy summaries — full text would blow past prompt budgets.
    summary: row.summary ? row.summary.slice(0, 600) : null,
    actionItems: Array.isArray(row.action_items)
      ? (row.action_items as Array<Record<string, unknown>>)
          .slice(0, 5)
          .map((a) => ({
            description: typeof a.description === "string" ? a.description : "",
            completed: a.completed === true,
            assignee_email: typeof a.assignee_email === "string" ? a.assignee_email : undefined,
          }))
          .filter((a) => a.description)
      : [],
  }))
}

async function fetchInboxEventsForClient(
  supabase: Supabase,
  mondayItemId: string,
): Promise<InboxEventContext[]> {
  const { data } = await supabase
    .from("inbox_events")
    .select(`
      id, kind, title, body, status, source, created_at,
      author:users!inbox_items_author_id_fkey(name, email),
      assignee:users!inbox_items_assignee_id_fkey(name, email)
    `)
    .eq("client_id", mondayItemId)
    .order("created_at", { ascending: false })
    .limit(INBOX_LIMIT)

  type Row = {
    id: string
    kind: "task" | "update" | "chat"
    title: string
    body: string | null
    status: string
    source: string
    created_at: string
    author: { name: string | null; email: string } | null
    assignee: { name: string | null; email: string } | null
  }

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body ? r.body.slice(0, 300) : null,
    status: r.status,
    source: r.source,
    authorName: r.author?.name ?? r.author?.email ?? "Unknown",
    assigneeName: r.assignee?.name ?? r.assignee?.email ?? null,
    createdAt: r.created_at,
  }))
}

async function fetchAgreementForClient(
  supabase: Supabase,
  mondayItemId: string,
): Promise<{ agreement: Agreement; monthly: number } | null> {
  const { data: clientRow } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  if (!clientRow?.id) return null

  const { data: agreementRow } = await supabase
    .from("client_agreements")
    .select("ad_budget, platforms, platform_fees, follow_up, follow_up_fee, notes")
    .eq("client_id", clientRow.id)
    .maybeSingle()
  if (!agreementRow) return null

  const agreement = normalizeAgreement(agreementRow)
  return { agreement, monthly: agreementMonthly(agreement) }
}
