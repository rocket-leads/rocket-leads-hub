import { createAdminClient } from "@/lib/supabase/server"
import { fetchBothBoards } from "@/lib/integrations/monday"
import { readCache } from "@/lib/cache"
import { fetchBillingData } from "@/lib/integrations/stripe"
import { fetchConversations, fetchMessages } from "@/lib/integrations/trengo"
import Anthropic from "@anthropic-ai/sdk"
import type { MondayClient } from "@/lib/integrations/monday"
import type { InvoiceRow } from "@/lib/integrations/stripe"
import type { TrengoMessage } from "@/lib/integrations/trengo"
import type { KpiDailyCache, KpiDailyClientData } from "@/app/api/kpi-summaries/route"
import {
  DEFAULT_INBOX_AUTOMATION_RULES,
  type InboxAutomationRules,
} from "@/app/(dashboard)/settings/types"

const anthropic = new Anthropic()

export type CreatedItem =
  | {
      rule: "payment_overdue_task"
      clientName: string
      assigneeName: string
      invoiceId: string
      amount: number
    }
  | {
      rule: "positive_client_signal_cpl_drop"
      clientName: string
      assigneeName: string
      period: "7d" | "30d"
      dropPct: number
      currCpl: number
      prevCpl: number
    }
  | {
      rule: "next_invoice_due_task"
      clientName: string
      assigneeName: string
      invoiceDate: string
      mrr: number
    }
  | {
      rule: "auto_complete_invoice_tasks"
      clientName: string
      taskId: string
      invoiceId: string
      invoiceCreatedAt: string
    }

export type SkippedItem = { reason: string; client?: string; detail?: string }

export type AutomationRunResult = {
  ranAt: string
  duration: string
  rules: InboxAutomationRules
  created: CreatedItem[]
  skipped: SkippedItem[]
  skippedTotal: number
  reason?: string
  testMode?: boolean
}

/**
 * Options for the automation runner. The cron passes nothing; the manual
 * Run-now trigger from Settings passes `testMode` so tasks land in the admin's
 * own inbox instead of being fanned out to AMs — useful for QA/preview without
 * spamming the team.
 */
export type RunOptions = {
  testMode?: {
    /** Override task assignee. The would-be AM is still recorded in the body
     *  so the admin can see who *would* have received the task in production. */
    assigneeUserId: string
  }
}

async function loadRules(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<InboxAutomationRules> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "inbox_automation_rules")
    .maybeSingle()
  if (!data?.value) return DEFAULT_INBOX_AUTOMATION_RULES
  return { ...DEFAULT_INBOX_AUTOMATION_RULES, ...(data.value as Partial<InboxAutomationRules>) }
}

/** Pick a deterministic system author for automation-created items. Prefer the
 *  HQ admin seed; fall back to the first admin in the table. */
async function getSystemAuthorId(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<string | null> {
  const { data: hq } = await supabase
    .from("users")
    .select("id")
    .eq("email", "rocketleadshq@gmail.com")
    .maybeSingle()
  if (hq) return hq.id

  const { data: admin } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return admin?.id ?? null
}

async function lookupAccountManagerId(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  mondayPersonName: string,
): Promise<string | null> {
  if (!mondayPersonName) return null
  const { data } = await supabase
    .from("user_column_mappings")
    .select("user_id")
    .eq("monday_column_role", "account_manager")
    .eq("monday_person_name", mondayPersonName)
    .maybeSingle()
  return data?.user_id ?? null
}

function fmtEuro(v: number): string {
  return `€${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// --- Rule 1: payment overdue ---------------------------------------------

async function ensurePaymentOverdueTask(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  client: MondayClient,
  supabaseClientId: string,
  invoice: InvoiceRow,
  authorId: string,
  assigneeId: string,
  testMode: boolean,
): Promise<CreatedItem | null> {
  // Idempotency only matters for real production runs — test runs always
  // recreate so the admin can iterate on the rule output.
  if (!testMode) {
    const { data: existing } = await supabase
      .from("inbox_events")
      .select("id")
      .eq("source", "automation")
      .filter("source_ref->>invoiceId", "eq", invoice.id)
      .filter("source_ref->>testRun", "is", null)
      .maybeSingle()
    if (existing) return null
  }

  const outstanding = invoice.amountDue - invoice.amountPaid
  const today = new Date().toISOString().slice(0, 10)

  const titleCore = `Contact ${client.firstName || client.name} about overdue payment — ${fmtEuro(outstanding)}`
  const title = testMode ? `[TEST] ${titleCore}` : titleCore
  const bodyParts = [
    `Stripe invoice ${invoice.number ?? invoice.id} is overdue.`,
    `Outstanding: ${fmtEuro(outstanding)}.`,
    invoice.dueDate
      ? `Due date: ${new Date(invoice.dueDate * 1000).toISOString().slice(0, 10)}.`
      : null,
    `Contact the client today and confirm next payment step.`,
  ].filter(Boolean) as string[]

  if (testMode) {
    bodyParts.unshift(
      `[TEST RUN] In production this would be assigned to ${client.accountManager || "the AM"}.`,
      "",
    )
  }

  const body = bodyParts.join("\n")

  const { error } = await supabase.from("inbox_events").insert({
    kind: "task",
    client_id: supabaseClientId,
    author_id: authorId,
    assignee_id: assigneeId,
    title,
    body,
    status: "open",
    priority: "high",
    due_date: today,
    source: "automation",
    source_ref: {
      rule: "payment_overdue_task",
      invoiceId: invoice.id,
      mondayItemId: client.mondayItemId,
      ...(testMode ? { testRun: true } : {}),
    },
  })

  if (error) {
    console.error("Payment overdue task insert failed:", error.message)
    return null
  }

  return {
    rule: "payment_overdue_task",
    clientName: client.name,
    assigneeName: client.accountManager,
    invoiceId: invoice.id,
    amount: outstanding,
  }
}

// --- Rule 3: next invoice date arrived ----------------------------------

/**
 * For every client with `next_invoice_date <= today`, create a task in the
 * Hub inbox assigned to the user with `is_finance = true` (first one if
 * multiple). The task tells finance that an invoice should go out today, with
 * the client + total MRR + Stripe customer ID surfaced so they don't have to
 * dig.
 *
 * Idempotency: each task carries `source_ref.invoiceDate = YYYY-MM-DD` plus
 * the client_id, so a re-run on the same day is a no-op even if the cron
 * fires twice (e.g. retry).
 */
async function ensureNextInvoiceDueTask(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  client: MondayClient,
  supabaseClientId: string,
  invoiceDate: string,
  mrr: number,
  authorId: string,
  assigneeId: string,
  testMode: boolean,
): Promise<CreatedItem | null> {
  if (!testMode) {
    const { data: existing } = await supabase
      .from("inbox_events")
      .select("id")
      .eq("source", "automation")
      .filter("source_ref->>rule", "eq", "next_invoice_due_task")
      .filter("source_ref->>clientId", "eq", supabaseClientId)
      .filter("source_ref->>invoiceDate", "eq", invoiceDate)
      .filter("source_ref->>testRun", "is", null)
      .maybeSingle()
    if (existing) return null
  }

  const today = new Date().toISOString().slice(0, 10)
  const titleCore = `Send invoice for ${client.name}`
  const title = testMode ? `[TEST] ${titleCore}` : titleCore
  const stripeBit = client.stripeCustomerId
    ? `Stripe customer: ${client.stripeCustomerId}`
    : `No Stripe customer on file — manual invoice.`
  const dateLabel = invoiceDate === today ? "today" : invoiceDate < today ? `overdue since ${invoiceDate}` : invoiceDate

  const bodyParts = [
    `Next invoice date is ${dateLabel}.`,
    mrr > 0 ? `MRR (per Hub agreement): ${fmtEuro(mrr)}.` : null,
    stripeBit,
    `Send the invoice and update the next-invoice date on the client to schedule the next one.`,
  ].filter(Boolean) as string[]

  if (testMode) {
    bodyParts.unshift(`[TEST RUN] In production this would be assigned to the finance user.`, "")
  }

  const { error } = await supabase.from("inbox_events").insert({
    kind: "task",
    client_id: supabaseClientId,
    author_id: authorId,
    assignee_id: assigneeId,
    title,
    body: bodyParts.join("\n"),
    status: "open",
    priority: "high",
    due_date: today,
    source: "automation",
    source_ref: {
      rule: "next_invoice_due_task",
      clientId: supabaseClientId,
      invoiceDate,
      mondayItemId: client.mondayItemId,
      ...(testMode ? { testRun: true } : {}),
    },
  })

  if (error) {
    console.error("Next invoice task insert failed:", error.message)
    return null
  }

  return {
    rule: "next_invoice_due_task",
    clientName: client.name,
    assigneeName: "Finance",
    invoiceDate,
    mrr,
  }
}

// --- Rule 4: auto-complete invoice tasks ---------------------------------

/**
 * Closes the loop on rule 3: when the Hub creates a "send invoice" task and
 * Arno (or whoever has the Finance role) actually sends the invoice in
 * Stripe, the cron sees a fresh invoice and marks the task as `done` instead
 * of leaving it sitting in finance's inbox. The task body is appended with a
 * note explaining why it was auto-completed, and `source_ref.auto_completed_*`
 * fields record the audit trail.
 *
 * "Fresh" = a non-draft Stripe invoice whose `created` timestamp is at or
 * after the task's `next_invoice_date` minus a 7-day grace window. The grace
 * accounts for finance sending the invoice a few days early — without it,
 * we'd leave the task open even though the work is clearly done.
 */
async function ensureAutoCompleteInvoiceTasks(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  allClients: MondayClient[],
  testMode: boolean,
): Promise<CreatedItem[]> {
  const completed: CreatedItem[] = []

  // Pull every still-open next-invoice task. `kind = task` + `status = open`
  // is the entire universe — we never auto-complete in_progress tasks because
  // that would step on someone actively handling it.
  const { data: openTasks } = await supabase
    .from("inbox_events")
    .select("id, client_id, source_ref, body")
    .eq("kind", "task")
    .eq("status", "open")
    .eq("source", "automation")
    .filter("source_ref->>rule", "eq", "next_invoice_due_task")

  if (!openTasks || openTasks.length === 0) return completed

  // Build a lookup from supabase client_id → MondayClient (for stripeCustomerId).
  const supabaseIds = openTasks
    .map((t) => t.client_id)
    .filter((id): id is string => !!id)
  if (supabaseIds.length === 0) return completed

  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, monday_item_id")
    .in("id", supabaseIds)
  const mondayItemByClientId = new Map<string, string>()
  for (const r of clientRows ?? []) mondayItemByClientId.set(r.id, r.monday_item_id)

  const clientByItemId = new Map<string, MondayClient>()
  for (const c of allClients) clientByItemId.set(c.mondayItemId, c)

  const { fetchBillingData } = await import("@/lib/integrations/stripe")

  for (const task of openTasks) {
    const clientId = task.client_id as string | null
    if (!clientId) continue
    const mondayItemId = mondayItemByClientId.get(clientId)
    if (!mondayItemId) continue
    const client = clientByItemId.get(mondayItemId)
    if (!client?.stripeCustomerId) continue

    const sourceRef = (task.source_ref ?? {}) as Record<string, unknown>
    const invoiceDateStr = typeof sourceRef.invoiceDate === "string" ? sourceRef.invoiceDate : null
    if (!invoiceDateStr) continue

    // 7-day grace before the due date — covers "Arno sent it a few days early".
    const dueMs = new Date(invoiceDateStr).getTime()
    if (Number.isNaN(dueMs)) continue
    const cutoffSec = Math.floor((dueMs - 7 * 24 * 60 * 60 * 1000) / 1000)

    let billing
    try {
      billing = await fetchBillingData(client.stripeCustomerId)
    } catch {
      // If Stripe is down or the customer has no invoices, leave the task
      // alone — it'll get retried tomorrow.
      continue
    }

    const match = billing.invoices
      .filter((inv) => inv.status !== "draft")
      .find((inv) => inv.created >= cutoffSec)
    if (!match) continue

    const invoiceCreatedAt = new Date(match.created * 1000).toISOString()
    const completionNote = `\n\n— Auto-completed: detected Stripe invoice ${match.number ?? match.id} sent ${invoiceCreatedAt.slice(0, 10)}.`

    const updatedBody = (task.body ?? "") + completionNote
    const updatedSourceRef = {
      ...sourceRef,
      auto_completed: true,
      auto_completed_at: new Date().toISOString(),
      auto_completed_invoice_id: match.id,
      auto_completed_invoice_number: match.number ?? null,
    }

    if (testMode) {
      // In test mode we report the would-be auto-completion but don't actually
      // close the row — admin should be able to keep iterating on the rule
      // without losing test tasks.
      completed.push({
        rule: "auto_complete_invoice_tasks",
        clientName: client.name,
        taskId: task.id,
        invoiceId: match.id,
        invoiceCreatedAt,
      })
      continue
    }

    const { error } = await supabase
      .from("inbox_events")
      .update({
        status: "done",
        body: updatedBody,
        source_ref: updatedSourceRef,
        completed_at: new Date().toISOString(),
      })
      .eq("id", task.id)

    if (error) {
      console.error("Auto-complete invoice task update failed:", error.message)
      continue
    }

    completed.push({
      rule: "auto_complete_invoice_tasks",
      clientName: client.name,
      taskId: task.id,
      invoiceId: match.id,
      invoiceCreatedAt,
    })
  }

  return completed
}

// --- Rule 2: positive CPL drop signal -----------------------------------

type Period = {
  name: "7d" | "30d"
  days: number
  labelNL: string
  prevLabelNL: string
}

const PERIODS: Period[] = [
  { name: "7d", days: 7, labelNL: "afgelopen 7 dagen", prevLabelNL: "7 dagen daarvoor" },
  { name: "30d", days: 30, labelNL: "afgelopen 30 dagen", prevLabelNL: "30 dagen daarvoor" },
]

const MIN_SPEND = 200 // both windows; ignore micro-accounts where CPL = noise
const MIN_LEADS = 5
const MIN_CURR_CPL = 1 // anomaly guard: under €1 is almost always a data glitch
const DROP_THRESHOLD = 50
const IDEMPOTENCY_DAYS = 14
const MIN_HISTORY_DAYS = 30 // client must have been running for ≥30 days

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function getDaysSinceFirstSpend(daily: KpiDailyClientData): number {
  // Daily cache is zero-filled across 365d, so length isn't a reliable signal
  // of campaign tenure. Use the first day with non-zero spend instead.
  const firstSpend = [...daily.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .find((d) => d.spend > 0)
  if (!firstSpend) return 0
  const start = new Date(firstSpend.date)
  const now = new Date()
  return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
}

function windowSums(
  daily: KpiDailyClientData,
  startDateStr: string,
  endDateStr: string,
): { spend: number; leads: number } {
  const rows = daily.days.filter((d) => d.date >= startDateStr && d.date <= endDateStr)
  const spend = rows.reduce((s, d) => s + d.spend, 0)
  const monday = rows.reduce((s, d) => s + d.mondayLeads, 0)
  const meta = rows.reduce((s, d) => s + d.metaLeads, 0)
  const leads = daily.mondayCrmConnected && monday > 0 ? monday : meta
  return { spend, leads }
}

type CplComparison = {
  period: Period
  curr: { spend: number; leads: number; cpl: number }
  prev: { spend: number; leads: number; cpl: number }
  dropPct: number
}

function evaluatePeriod(daily: KpiDailyClientData, period: Period): CplComparison | null {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const currEnd = yesterday
  const currStart = new Date(yesterday)
  currStart.setDate(currStart.getDate() - (period.days - 1))
  const prevEnd = new Date(currStart)
  prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd)
  prevStart.setDate(prevStart.getDate() - (period.days - 1))

  const curr = windowSums(daily, isoDate(currStart), isoDate(currEnd))
  const prev = windowSums(daily, isoDate(prevStart), isoDate(prevEnd))

  if (curr.spend < MIN_SPEND || curr.leads < MIN_LEADS) return null
  if (prev.spend < MIN_SPEND || prev.leads < MIN_LEADS) return null

  const currCpl = curr.spend / curr.leads
  const prevCpl = prev.spend / prev.leads

  if (currCpl < MIN_CURR_CPL) return null // data anomaly guard
  if (currCpl >= prevCpl) return null

  const dropPct = ((prevCpl - currCpl) / prevCpl) * 100
  if (dropPct < DROP_THRESHOLD) return null

  return {
    period,
    curr: { ...curr, cpl: currCpl },
    prev: { ...prev, cpl: prevCpl },
    dropPct,
  }
}

async function generatePositiveSignalMessage(args: {
  client: MondayClient
  cmp: CplComparison
}): Promise<string | null> {
  const { client, cmp } = args

  let toneSamples = ""
  if (client.trengoContactId) {
    try {
      const conversations = await fetchConversations(client.trengoContactId)
      const collected: TrengoMessage[] = []
      for (const conv of conversations.slice(0, 3)) {
        try {
          const msgs = await fetchMessages(conv.id)
          collected.push(...msgs)
        } catch {
          // skip individual fetch errors
        }
        if (collected.length >= 30) break
      }
      const fromRL = collected
        .filter((m) => m.author_type === "User" && m.body?.trim())
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 10)
      toneSamples = fromRL.map((m) => m.body.trim()).join("\n---\n")
    } catch {
      // proceed without tone samples
    }
  }

  const firstName = client.firstName || client.name.split(" ")[0]

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `Je bent een Nederlandstalige Account Manager bij Rocket Leads die een kort, informeel WhatsApp-style update-berichtje stuurt naar een klant.

STIJL-REGELS:
- Nederlands
- Informeel maar professioneel — alsof je iemand al even kent
- GEEN emoticons of emoji's
- GEEN formele begroeting of afsluiting (dus geen "Beste X", geen "Met vriendelijke groet", geen handtekening)
- Begin met "Hey {firstName}" of "Hi {firstName}" — kies wat het best aansluit bij de eerdere tone
- Kort en krachtig: 2 tot 4 zinnen, max ~50 woorden
- Concreet: noem de exacte CPL bedragen en het percentage
- Neutraal-trots: "we hebben de cost per lead weten te verlagen" of "lekker bezig" — niet overdreven
- Geen verkooppraatjes, geen call-to-action, geen vraag terug
- Het is een delen-van-de-win update, niet een verkoopbericht
- Gewoon alsof je een appje stuurt`,
      messages: [
        {
          role: "user",
          content: `Schrijf een korte informele update voor klant ${firstName}.

DATA:
- Periode: ${cmp.period.labelNL}
- Cost per Lead nu: €${cmp.curr.cpl.toFixed(2)}
- Cost per Lead vorige periode (${cmp.period.prevLabelNL}): €${cmp.prev.cpl.toFixed(2)}
- Daling: ${cmp.dropPct.toFixed(0)}%

EERDERE BERICHTEN VAN ROCKET LEADS NAAR DEZE KLANT (om tone-of-voice te matchen):
${toneSamples || "(geen eerdere berichten beschikbaar — gebruik standaard informele tone)"}

Output: alleen het berichtje zelf, geen quotes, geen toelichting.`,
        },
      ],
    })

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : ""
    return text.trim() || null
  } catch (e) {
    console.error("Positive signal AI generation failed:", e instanceof Error ? e.message : e)
    return null
  }
}

async function ensurePositiveCplDropTask(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  client: MondayClient,
  supabaseClientId: string,
  daily: KpiDailyClientData,
  authorId: string,
  assigneeId: string,
  testMode: boolean,
): Promise<CreatedItem | null> {
  if (getDaysSinceFirstSpend(daily) < MIN_HISTORY_DAYS) return null

  const candidates: CplComparison[] = []
  for (const period of PERIODS) {
    const cmp = evaluatePeriod(daily, period)
    if (cmp) candidates.push(cmp)
  }
  if (candidates.length === 0) return null

  const cmp = candidates.find((c) => c.period.name === "30d") ?? candidates[0]

  if (!testMode) {
    const idempotencyCutoff = new Date()
    idempotencyCutoff.setDate(idempotencyCutoff.getDate() - IDEMPOTENCY_DAYS)
    const { data: existing } = await supabase
      .from("inbox_events")
      .select("id")
      .eq("source", "automation")
      .filter("source_ref->>rule", "eq", "positive_client_signal_cpl_drop")
      .filter("source_ref->>mondayItemId", "eq", client.mondayItemId)
      .filter("source_ref->>testRun", "is", null)
      .gte("created_at", idempotencyCutoff.toISOString())
      .maybeSingle()
    if (existing) return null
  }

  const message = await generatePositiveSignalMessage({ client, cmp })
  if (!message) return null

  const todayStr = new Date().toISOString().slice(0, 10)
  const dropPctRounded = Math.round(cmp.dropPct)

  const titleCore = `Client update — CPL ${client.name} met ${dropPctRounded}% verlaagd, ${cmp.period.labelNL}`
  const title = testMode ? `[TEST] ${titleCore}` : titleCore

  const bodyParts: string[] = []
  if (testMode) {
    bodyParts.push(
      `[TEST RUN] In production this would be assigned to ${client.accountManager || "the AM"}.`,
      "",
    )
  }
  bodyParts.push(
    message,
    "",
    "— Voorgesteld door automatisering, voel vrij om aan te passen voor je het verstuurt.",
    "",
    `CPL ${cmp.period.labelNL}: €${cmp.curr.cpl.toFixed(2)} (vs €${cmp.prev.cpl.toFixed(2)} ${cmp.period.prevLabelNL})`,
    `Spend: ${fmtEuro(cmp.curr.spend)} · Leads: ${cmp.curr.leads}`,
  )
  const body = bodyParts.join("\n")

  const { error } = await supabase.from("inbox_events").insert({
    kind: "task",
    client_id: supabaseClientId,
    author_id: authorId,
    assignee_id: assigneeId,
    title,
    body,
    status: "open",
    priority: "low",
    due_date: todayStr,
    source: "automation",
    source_ref: {
      rule: "positive_client_signal_cpl_drop",
      mondayItemId: client.mondayItemId,
      period: cmp.period.name,
      dropPct: dropPctRounded,
      currCpl: cmp.curr.cpl,
      prevCpl: cmp.prev.cpl,
      ...(testMode ? { testRun: true } : {}),
    },
  })

  if (error) {
    console.error("Positive signal task insert failed:", error.message)
    return null
  }

  return {
    rule: "positive_client_signal_cpl_drop",
    clientName: client.name,
    assigneeName: client.accountManager,
    period: cmp.period.name,
    dropPct: dropPctRounded,
    currCpl: cmp.curr.cpl,
    prevCpl: cmp.prev.cpl,
  }
}

// --- Run-loop -----------------------------------------------------------

export async function runInboxAutomations(opts?: RunOptions): Promise<AutomationRunResult> {
  const startTime = Date.now()
  const supabase = await createAdminClient()
  const rules = await loadRules(supabase)
  const testMode = !!opts?.testMode

  const skipped: SkippedItem[] = []
  const created: CreatedItem[] = []

  if (
    !rules.payment_overdue_task &&
    !rules.positive_client_signal_cpl_drop &&
    !rules.next_invoice_due_task &&
    !rules.auto_complete_invoice_tasks
  ) {
    return {
      ranAt: new Date().toISOString(),
      duration: "0.0s",
      rules,
      created,
      skipped,
      skippedTotal: 0,
      reason: "All automation rules disabled",
      testMode,
    }
  }

  const authorId = await getSystemAuthorId(supabase)
  if (!authorId) {
    throw new Error("No admin user found to author automation items")
  }

  const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
    "monday_boards",
  )
  const data = cached ?? (await fetchBothBoards())
  const allClients = [...data.onboarding, ...data.current]

  const mondayItemIds = allClients.map((c) => c.mondayItemId)
  const { data: clientRows } = await supabase
    .from("clients")
    .select("id, monday_item_id, next_invoice_date")
    .in("monday_item_id", mondayItemIds)

  const supabaseIdByItem = new Map<string, string>()
  const nextInvoiceByItem = new Map<string, string>()
  for (const row of clientRows ?? []) {
    supabaseIdByItem.set(row.monday_item_id, row.id)
    if (row.next_invoice_date) {
      nextInvoiceByItem.set(row.monday_item_id, row.next_invoice_date)
    }
  }

  // Resolve the finance-role assignee once. In test mode the override wins.
  // In production, if no finance user is configured we skip the rule entirely
  // rather than falling back to admin — the failure mode of "Roy gets every
  // invoice task" is worse than "task didn't fire and someone notices".
  //
  // Finance is now stored as a value of `monday_column_role` (alongside
  // account_manager / campaign_manager / appointment_setter), not a separate
  // boolean — see migration 20240022.
  let financeAssigneeId: string | null = null
  if (rules.next_invoice_due_task || rules.auto_complete_invoice_tasks) {
    if (testMode) {
      financeAssigneeId = opts!.testMode!.assigneeUserId
    } else {
      const { data: financeRows } = await supabase
        .from("user_column_mappings")
        .select("user_id, users!inner(created_at)")
        .eq("monday_column_role", "finance")
        .order("created_at", { foreignTable: "users", ascending: true })
        .limit(1)
      financeAssigneeId = financeRows?.[0]?.user_id ?? null
      if (!financeAssigneeId && rules.next_invoice_due_task) {
        skipped.push({ reason: "no_finance_user_configured" })
      }
    }
  }

  // Fetch all agreements once so we can include MRR in each invoice task
  // without per-client round-trips.
  let mrrByClientId = new Map<string, number>()
  if (rules.next_invoice_due_task && financeAssigneeId) {
    const { data: agreementRows } = await supabase
      .from("client_agreements")
      .select("client_id, campaigns")
    if (agreementRows) {
      const { totalMRR, normalizeCampaigns } = await import("@/lib/clients/agreement")
      mrrByClientId = new Map(
        agreementRows.map((row) => [
          row.client_id as string,
          totalMRR(normalizeCampaigns(row.campaigns)),
        ]),
      )
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  const dailyCache = await readCache<KpiDailyCache>("kpi_daily")

  // The next-invoice rule doesn't require an AM (it goes to finance), so we
  // run it over ALL clients in a separate loop before the AM-gated rules.
  if (rules.next_invoice_due_task && financeAssigneeId) {
    for (const client of allClients) {
      const supabaseClientId = supabaseIdByItem.get(client.mondayItemId)
      if (!supabaseClientId) continue
      const due = nextInvoiceByItem.get(client.mondayItemId)
      if (!due || due > today) continue
      try {
        const result = await ensureNextInvoiceDueTask(
          supabase,
          client,
          supabaseClientId,
          due,
          mrrByClientId.get(supabaseClientId) ?? 0,
          authorId,
          financeAssigneeId,
          testMode,
        )
        if (result) created.push(result)
      } catch (e) {
        skipped.push({
          reason: "next_invoice_failed",
          client: client.name,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  // Auto-complete any open `next_invoice_due_task` items where a fresh Stripe
  // invoice has appeared since the task was scheduled. Runs in production AND
  // test mode (test mode just won't write back the completion if the task was
  // [TEST] flagged — see ensureAutoCompleteInvoiceTasks).
  if (rules.auto_complete_invoice_tasks) {
    try {
      const completed = await ensureAutoCompleteInvoiceTasks(
        supabase,
        allClients,
        testMode,
      )
      created.push(...completed)
    } catch (e) {
      skipped.push({
        reason: "auto_complete_failed",
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const candidates = allClients.filter((c) => c.accountManager)

  for (const client of candidates) {
    const supabaseClientId = supabaseIdByItem.get(client.mondayItemId)
    if (!supabaseClientId) {
      skipped.push({ reason: "client_not_synced", client: client.name })
      continue
    }

    // In test mode the AM mapping isn't strictly required — assignee comes
    // from the override. But we still record the would-be AM in the body for
    // the admin to validate, so we can keep the lookup attempt and let it be
    // null. In real runs, missing AM mapping is a hard skip.
    const realAssigneeId = await lookupAccountManagerId(supabase, client.accountManager)
    if (!realAssigneeId && !testMode) {
      skipped.push({ reason: "no_am_mapping", client: client.name })
      continue
    }
    const assigneeId = testMode
      ? opts!.testMode!.assigneeUserId
      : (realAssigneeId as string)

    if (rules.payment_overdue_task && client.stripeCustomerId) {
      try {
        const billing = await fetchBillingData(client.stripeCustomerId)
        const overdue = billing.invoices.filter((i) => i.status === "overdue")
        for (const invoice of overdue) {
          const result = await ensurePaymentOverdueTask(
            supabase,
            client,
            supabaseClientId,
            invoice,
            authorId,
            assigneeId,
            testMode,
          )
          if (result) created.push(result)
        }
      } catch (e) {
        skipped.push({
          reason: "stripe_fetch_failed",
          client: client.name,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }

    if (rules.positive_client_signal_cpl_drop && client.metaAdAccountId) {
      const daily = dailyCache?.[client.mondayItemId]
      if (!daily) continue
      try {
        const result = await ensurePositiveCplDropTask(
          supabase,
          client,
          supabaseClientId,
          daily,
          authorId,
          assigneeId,
          testMode,
        )
        if (result) created.push(result)
      } catch (e) {
        skipped.push({
          reason: "positive_signal_failed",
          client: client.name,
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  const duration = `${((Date.now() - startTime) / 1000).toFixed(1)}s`
  return {
    ranAt: new Date().toISOString(),
    duration,
    rules,
    created,
    skipped: skipped.slice(0, 50),
    skippedTotal: skipped.length,
    testMode,
  }
}
