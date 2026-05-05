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
      rule: "auto_complete_invoice_tasks"
      clientName: string
      taskId: string
      invoiceId: string
      invoiceCreatedAt: string
    }
  | {
      rule: "dedup_overlapping_tasks"
      clientName: string
      keptTaskId: string
      keptTaskTitle: string
      cancelledTaskIds: string[]
      confidence: number
      reason: string
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

// --- AI drafters (smart-inbox layer) ------------------------------------

/**
 * Detect the client's most-active Trengo channel by counting recent
 * conversations per channel-type. Returns 'email' or 'whatsapp' (the only
 * two we differentiate for now), or null when no Trengo history exists.
 *
 * Heuristic: most recent ~20 conversations weigh equal — channel that owns
 * the majority wins. Ties go to email (more appropriate for finance comms).
 *
 * Failure mode: when Trengo is unreachable we return null so the caller
 * defaults to email-tone — safer for a payment reminder than guessing.
 */
async function detectMostActiveTrengoChannel(
  trengoContactId: string,
): Promise<"email" | "whatsapp" | null> {
  try {
    const all = await fetchConversations(trengoContactId)
    if (all.length === 0) return null
    const recent = all.slice(0, 20)
    let email = 0
    let whatsapp = 0
    for (const c of recent) {
      const type = (c.channel?.type ?? "").toLowerCase()
      if (type.includes("email") || type.includes("mail")) email++
      else if (type.includes("whats") || type.includes("wa_")) whatsapp++
    }
    if (whatsapp > email) return "whatsapp"
    if (email > 0 || whatsapp > 0) return "email"
    return null
  } catch (e) {
    console.error("Channel detection failed for", trengoContactId, e)
    return null
  }
}

/**
 * Generate a short Dutch payment reminder message tailored to the channel.
 *
 * Email tone:
 *   - "Hallo {voornaam}", 3-5 sentences, friendly-but-professional
 *   - Closes with thanks/question, no signature (AM signs via Trengo footer)
 *
 * WhatsApp tone:
 *   - "Hé {voornaam}" or "Hi {voornaam}", 1-3 short sentences
 *   - Punchier, conversational, no formal opener/closer
 *   - Note: outside Trengo's 24h session window, WA needs a template message —
 *     the send-endpoint will guard against that case
 */
async function draftPaymentReminderMessage(input: {
  firstName: string
  invoiceNumber: string
  outstanding: number
  dueDate: string | null
  daysOverdue: number | null
  channel: "email" | "whatsapp"
}): Promise<string> {
  const dueLine = input.dueDate
    ? `Verloopdatum: ${input.dueDate}` + (input.daysOverdue ? ` (${input.daysOverdue} dag${input.daysOverdue === 1 ? "" : "en"} over tijd).` : ".")
    : "Deze factuur staat al even open."

  const isEmail = input.channel === "email"

  const systemPrompt = isEmail
    ? `Je schrijft een korte Nederlandse betalingsherinnering per EMAIL voor een Account Manager bij Rocket Leads.

DOEL: De klant vriendelijk attenderen op een openstaande factuur, met de aanname dat het waarschijnlijk over het hoofd is gezien — niet onwil.

STIJL (email):
- Nederlands
- Vriendelijk en menselijk, maar niet informeel — "Hallo {voornaam}" of "Beste {voornaam}" als opener
- Niet té formeel — het is geen incassobureau-brief
- 3-5 zinnen, max ~80 woorden
- Noem expliciet: factuurnummer, bedrag, hoeveel dagen over tijd (als bekend)
- Frame: "onze administratie zag dat...", "klein checkje even", "is er ergens iets misgegaan?"
- Sluit af met dank/vraag, GEEN handtekening (AM tekent zelf via Trengo)
- Geen "Met vriendelijke groet" — geen formele afsluiting

OUTPUT: Alleen de berichttekst, geen quotes, geen markdown.`
    : `Je schrijft de body van een korte Nederlandse WhatsApp-betalingsherinnering die via een Trengo template verstuurd wordt.

CONTEXT: Het template heeft de structuur "Hey {{1}} Groetjes <AM-naam>". Jouw output gaat in de {{1}}-placeholder. Begin daarom met de voornaam gevolgd door een komma, daarna de boodschap, en eindig met een punt zodat het mooi aansluit op "Groetjes <AM>".

OUTPUT-FORMAT (verplicht): "{voornaam}, {body eindigend op een punt}"

VOORBEELD: "Dietrich, kleine vraag — factuur RL-2026-1234 (€1.250) staat al 4 dagen open. Even checken of er iets is misgegaan?"
→ Resulteert in WhatsApp-bericht: "Hey Dietrich, kleine vraag — factuur RL-2026-1234 (€1.250) staat al 4 dagen open. Even checken of er iets is misgegaan? Groetjes Roel"

STIJL:
- Nederlands, conversationeel — alsof je een appje stuurt
- Begin met de voornaam + komma
- 1-3 korte zinnen, max ~40 woorden
- Noem expliciet: factuurnummer, bedrag, en hoe lang het openstaat (als bekend)
- Frame: "kleine vraag", "zag net dat...", "is er iets misgegaan?"
- Geen "Hé" of "Hi" als opener — de "Hey" zit al in het template
- Geen "Groetjes" of handtekening — die zitten al in het template
- Geen emoji's

OUTPUT: Alleen de body-tekst die in {{1}} komt, geen quotes, geen markdown, geen "Hey" prefix.`

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Klant: ${input.firstName}
Factuurnummer: ${input.invoiceNumber}
Openstaand bedrag: ${fmtEuro(input.outstanding)}
${dueLine}

Schrijf nu de berichttekst.`,
      },
    ],
  })

  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim()
  return text
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
  const dueDateIso = invoice.dueDate
    ? new Date(invoice.dueDate * 1000).toISOString().slice(0, 10)
    : null
  const daysOverdue = invoice.dueDate
    ? Math.max(1, Math.floor((Date.now() - invoice.dueDate * 1000) / (24 * 60 * 60 * 1000)))
    : null

  // Smart-inbox v1: pre-draft a friendly Dutch payment reminder so the AM
  // can review-and-send straight from the task detail dialog. We detect the
  // client's most-active Trengo channel first and tailor tone accordingly —
  // email gets a longer, more formal reminder; WhatsApp gets a punchier
  // "even checken"-appje. Stored alongside `draft_channel` in source_ref so
  // the send-endpoint knows which Trengo channel to target.
  //
  // Failure to draft is non-fatal — the task still lands, just without the
  // pre-filled message; the AM can still close the loop manually.
  let draftMessage: string | null = null
  let draftChannel: "email" | "whatsapp" = "email"
  try {
    const detected = client.trengoContactId
      ? await detectMostActiveTrengoChannel(client.trengoContactId)
      : null
    draftChannel = detected ?? "email"
    draftMessage = await draftPaymentReminderMessage({
      firstName: client.firstName || client.name,
      invoiceNumber: invoice.number ?? invoice.id,
      outstanding,
      dueDate: dueDateIso,
      daysOverdue,
      channel: draftChannel,
    })
  } catch (e) {
    console.error("Payment reminder AI draft failed:", e)
  }

  const titleCore = `Contact ${client.firstName || client.name} about overdue payment — ${fmtEuro(outstanding)}`
  const title = testMode ? `[TEST] ${titleCore}` : titleCore
  const bodyParts = [
    `Stripe invoice ${invoice.number ?? invoice.id} is overdue.`,
    `Outstanding: ${fmtEuro(outstanding)}.`,
    dueDateIso ? `Due date: ${dueDateIso}${daysOverdue ? ` (${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue)` : ""}.` : null,
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
      ...(draftMessage
        ? {
            draft_message: draftMessage,
            draft_channel: draftChannel === "whatsapp" ? "trengo_whatsapp" : "trengo_email",
          }
        : {}),
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

// (Rule 3 — `next_invoice_due_task` — was removed: finance handles invoicing
// fast enough that the task adds noise. The Billing page surfaces overdue
// state via a sidebar dot for the finance user instead. Rule 4 below stays
// to clean up any legacy open tasks once Stripe registers the matching
// invoice.)

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

// --- Rule 5: AI deduplication of overlapping tasks ---------------------

/**
 * Scans recently-created open tasks per client and asks Claude Haiku whether
 * any are semantically duplicates of each other. When the model is confident
 * (≥0.85), the OLDEST task in each duplicate group survives and the rest get
 * cancelled with an audit note + `source_ref.duplicate_of` pointing back at
 * the kept task.
 *
 * Why oldest-survives: the first task usually has the most context (it's the
 * trigger that explains why the work exists). Newer tasks are typically
 * lower-context echoes — a Trengo classification of an existing automation
 * task, a Fathom action item that mentions a known cron job. Cancelling them
 * is reversible: a human can reopen via the Hub if the model got it wrong.
 *
 * Conservative defaults:
 *  - Only looks at tasks created in the last 7 days (older tasks are stable
 *    enough that any overlap was already worked around)
 *  - Only same-client groups (cross-client matches are almost never valid)
 *  - Hard confidence threshold (0.85) to avoid false positives
 *  - Cap of 10 tasks per client per call so the prompt stays small + the
 *    model has a fighting chance of noticing real overlaps
 *
 * Default OFF in DEFAULT_INBOX_AUTOMATION_RULES; admin enables in Settings
 * after reviewing test-mode output.
 */

type DedupCandidate = {
  id: string
  client_id: string
  title: string
  body: string | null
  source: string
  created_at: string
  source_ref: Record<string, unknown> | null
}

async function dedupOverlappingTasks(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  testMode: boolean,
): Promise<CreatedItem[]> {
  const created: CreatedItem[] = []

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: candidates } = await supabase
    .from("inbox_events")
    .select("id, client_id, title, body, source, created_at, source_ref")
    .eq("kind", "task")
    .in("status", ["open", "in_progress"])
    .gte("created_at", sevenDaysAgo)
    .not("client_id", "is", null)
    .neq("client_id", "")
    .order("created_at", { ascending: true })

  if (!candidates || candidates.length < 2) return created

  // Group by client.
  const byClient = new Map<string, DedupCandidate[]>()
  for (const row of candidates as DedupCandidate[]) {
    const list = byClient.get(row.client_id) ?? []
    list.push(row)
    byClient.set(row.client_id, list)
  }

  for (const [clientId, tasks] of byClient.entries()) {
    if (tasks.length < 2) continue

    // Cap per-client tasks sent to AI; if there are >10, look at the most
    // recent 10 (those are most likely to overlap with each other).
    const slice = tasks.length > 10 ? tasks.slice(-10) : tasks

    let groups: Array<{ task_ids: string[]; confidence: number; reason: string }>
    try {
      groups = await classifyDuplicatesWithAi(slice)
    } catch (e) {
      console.error("Dedup AI call failed for client", clientId, e)
      continue
    }
    if (groups.length === 0) continue

    const clientName = await getClientName(supabase, clientId)

    for (const group of groups) {
      if (group.confidence < 0.85 || group.task_ids.length < 2) continue

      // Resolve to actual task rows + sort by created_at to pick the survivor.
      const groupTasks = group.task_ids
        .map((id) => slice.find((t) => t.id === id))
        .filter((t): t is DedupCandidate => !!t)
      if (groupTasks.length < 2) continue
      groupTasks.sort((a, b) => a.created_at.localeCompare(b.created_at))

      const keep = groupTasks[0]
      const drop = groupTasks.slice(1)

      const cancelledIds: string[] = []
      if (testMode) {
        // Don't actually cancel — just record what we would have done.
        cancelledIds.push(...drop.map((d) => d.id))
      } else {
        for (const dup of drop) {
          const note = `\n\n— Auto-cancelled as duplicate of "${keep.title}" (id ${keep.id}). Reason: ${group.reason}`
          const sourceRef = (dup.source_ref ?? {}) as Record<string, unknown>
          const { error } = await supabase
            .from("inbox_events")
            .update({
              status: "cancelled",
              completed_at: new Date().toISOString(),
              body: (dup.body ?? "") + note,
              source_ref: {
                ...sourceRef,
                duplicate_of: keep.id,
                dedup_confidence: group.confidence,
                dedup_reason: group.reason,
                dedup_via: "ai_haiku",
                dedup_at: new Date().toISOString(),
              },
            })
            .eq("id", dup.id)
            .in("status", ["open", "in_progress"])

          if (!error) cancelledIds.push(dup.id)
        }
      }

      if (cancelledIds.length > 0) {
        created.push({
          rule: "dedup_overlapping_tasks",
          clientName: clientName ?? "(unknown)",
          keptTaskId: keep.id,
          keptTaskTitle: keep.title,
          cancelledTaskIds: cancelledIds,
          confidence: group.confidence,
          reason: group.reason,
        })
      }
    }
  }

  return created
}

async function classifyDuplicatesWithAi(
  tasks: DedupCandidate[],
): Promise<Array<{ task_ids: string[]; confidence: number; reason: string }>> {
  const lines = tasks.map((t, i) => {
    const bodyPreview = (t.body ?? "").trim().slice(0, 280).replace(/\s+/g, " ")
    const created = t.created_at.slice(0, 10)
    return `[${t.id}] (${i + 1}/${tasks.length}, source: ${t.source}, created ${created})
Title: ${t.title}
Body: ${bodyPreview || "(no body)"}`
  })

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: `You triage duplicate inbox tasks for a marketing agency Hub.

Return groups of tasks that describe the SAME logical action — i.e. doing one
of them satisfies all of them. Tasks come from different sources (Trengo
ingest, Fathom action items, automation cron, manual creates) and the same
real-world job sometimes shows up multiple times.

Rules:
- Only group tasks that, if a human did the work once, would close out all of
  them. "Send invoice for Vlex" + "Stuur Vlex factuur" = duplicate. "Send
  invoice for Vlex" + "Bel Vlex over inhoud van factuur" = NOT duplicate.
- A Fathom bundle ("Taken uit kick-off call met X") contains multiple
  underlying items — only call it a duplicate if ALL the work in the bundle
  overlaps with the other task. When in doubt, keep them separate.
- Be conservative. Confidence ≥0.85 means "I'm sure"; <0.85 means "skip".
- Output JSON ONLY, no prose. Format:
  {"groups":[{"task_ids":["uuid1","uuid2"],"confidence":0.92,"reason":"both about sending the next invoice"}]}
  Empty array when nothing matches: {"groups":[]}`,
    messages: [
      {
        role: "user",
        content: `Tasks to triage (all for the same client):\n\n${lines.join("\n\n")}`,
      },
    ],
  })

  // Anthropic SDK ContentBlock is a union (text / thinking / tool_use / …);
  // narrow to the text branch via `type` so we can read `.text` safely.
  const text = msg.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim()

  // Extract JSON safely — model occasionally adds a code fence even when told not to.
  const jsonStart = text.indexOf("{")
  const jsonEnd = text.lastIndexOf("}")
  if (jsonStart === -1 || jsonEnd === -1) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
  } catch {
    return []
  }
  const groups = (parsed as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return []

  const valid: Array<{ task_ids: string[]; confidence: number; reason: string }> = []
  for (const g of groups) {
    const ids = Array.isArray((g as { task_ids?: unknown }).task_ids)
      ? ((g as { task_ids: unknown[] }).task_ids.filter((x) => typeof x === "string") as string[])
      : []
    const conf = typeof (g as { confidence?: unknown }).confidence === "number"
      ? (g as { confidence: number }).confidence
      : 0
    const reason = typeof (g as { reason?: unknown }).reason === "string"
      ? (g as { reason: string }).reason
      : ""
    if (ids.length >= 2) valid.push({ task_ids: ids, confidence: conf, reason })
  }
  return valid
}

async function getClientName(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  mondayItemId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("clients")
    .select("name")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle()
  return (data?.name as string | undefined) ?? null
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
    !rules.auto_complete_invoice_tasks &&
    !rules.dedup_overlapping_tasks
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
  if (rules.auto_complete_invoice_tasks) {
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
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  const dailyCache = await readCache<KpiDailyCache>("kpi_daily")

  // Auto-complete any legacy `next_invoice_due_task` items where a fresh Stripe
  // invoice has appeared since the task was scheduled. The creation rule was
  // removed (finance handles invoicing fast enough that the task adds noise),
  // but auto-complete stays so existing open tasks get cleaned up gracefully.
  // Runs in production AND test mode (test mode just won't write back the
  // completion if the task was [TEST] flagged — see ensureAutoCompleteInvoiceTasks).
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

  // AI dedup runs LAST — after every other rule has had a chance to create
  // its tasks for this run. That way if the cron creates a "Send invoice"
  // task that overlaps with a Trengo-classified task from earlier, dedup
  // catches it in the same pass instead of leaving the user with a duplicate
  // for 24h until the next run.
  if (rules.dedup_overlapping_tasks) {
    try {
      const deduped = await dedupOverlappingTasks(supabase, testMode)
      created.push(...deduped)
    } catch (e) {
      skipped.push({
        reason: "dedup_failed",
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
