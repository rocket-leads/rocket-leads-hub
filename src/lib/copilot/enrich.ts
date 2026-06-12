import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { collectClientAiContext } from "@/lib/pedro/insights/context"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * Co-pilot task-body enrichment. Given the user's raw command + the
 * resolved client, pull the full Hub context bundle (KPI + Monday updates
 * + Trengo + Pedro insight + recent meetings + inbox events) and ask
 * Haiku to synthesise a task body that CITES the specific data points
 * justifying the action.
 *
 * The result replaces the title-echo body the v1 parse step produced.
 * Roy's feedback (2026-05-22): the co-pilot should explain WHY the task
 * is needed by quoting numbers, client messages, and Pedro signals - not
 * just paraphrase the input.
 */

export type EnrichResult = {
  /** Enriched task body, ready to drop into the confirmation card. */
  body: string
  /** Source labels actually used in the body (audit + UI hint). */
  sourcesUsed: string[]
  /** True when the enrichment LLM call succeeded; false when we returned the original body. */
  enriched: boolean
}

const anthropic = new Anthropic()

export async function enrichTaskBody(args: {
  userInput: string
  taskTitle: string
  originalBody: string | undefined
  client: MondayClient
  supabase: SupabaseClient
  assigneeName: string | null
  /** "task" = standard delegated task body. "reminder" = self-targeted
   *  scheduled item; prompt nudges the LLM to write a snapshot-now-so-
   *  future-you-has-context body. Defaults to "task". */
  taskKind?: "task" | "reminder"
  /** For reminders: the date the item will surface. Lets the prompt
   *  contrast "today's snapshot" vs "on the reminder day". */
  remindAt?: string | null
}): Promise<EnrichResult> {
  const {
    userInput,
    taskTitle,
    originalBody,
    client,
    supabase,
    assigneeName,
    taskKind = "task",
    remindAt = null,
  } = args

  // Pull the canonical Hub context bundle in parallel with the latest
  // Pedro insight row (which lives in a separate table).
  const [ctx, pedroRow] = await Promise.all([
    collectClientAiContext(client).catch(() => null),
    supabase
      .from("pedro_insights")
      .select("body, generated_at")
      .eq("monday_item_id", client.mondayItemId)
      .eq("insight_type", "client_pedro")
      .maybeSingle<{ body: string; generated_at: string }>(),
  ])

  if (!ctx) {
    return {
      body: originalBody ?? "",
      sourcesUsed: [],
      enriched: false,
    }
  }

  const pedroInsight = pedroRow.data ? parsePedroBody(pedroRow.data.body) : null
  const pedroGeneratedAt = pedroRow.data?.generated_at ?? null

  const contextBlock = renderContextBlock({
    client,
    ctx,
    pedroInsight,
    pedroGeneratedAt,
  })

  const sourcesUsed = listAvailableSources(ctx, pedroInsight !== null)
  if (sourcesUsed.length === 0) {
    // Nothing to cite - keep the original body the user produced.
    return {
      body: originalBody ?? "",
      sourcesUsed: [],
      enriched: false,
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  // Reminder-mode prompt is structurally identical but the framing
  // ("Snapshot vandaag" + "Op de reminder-dag") makes the LLM capture
  // today's state so future-you, opening the surfaced reminder, sees what
  // changed (CPL, invoice balance, lead count) without having to re-pull.
  const isReminder = taskKind === "reminder"
  const surfaceLine = isReminder && remindAt
    ? `Deze reminder verschijnt pas op ${remindAt} - schrijf de body voor toekomstige-jij die 'm op die dag opent.`
    : null

  const sectionHeaders = isReminder
    ? { why: "Snapshot vandaag", next: "Op de reminder-dag" }
    : { why: "Waarom", next: "Volgende stap" }

  const prompt = `Je schrijft de body van een Hub-${isReminder ? "reminder" : "taak"} op basis van een korte instructie van een team member.

Vandaag: ${today}
Klant: ${client.name}
${isReminder ? "Reminder" : "Taak"} titel: "${taskTitle}"
Toegewezen aan: ${assigneeName ?? "(onbekend)"}
${surfaceLine ?? ""}

De gebruiker zei letterlijk:
"${userInput}"

De ${isReminder ? "reminder" : "taak"} titel staat al vast - herhaal die NIET in de body. Schrijf alleen de body.

═══ CLIENT CONTEXT (vandaag opgehaald uit de Hub) ═══

${contextBlock}

═══ INSTRUCTIES ═══

Schrijf een body die scanbaar is in 5 seconden. Gebruik DEZE EXACTE structuur:

${sectionHeaders.why}:
• [${isReminder ? "concreet getal NU - CPL, openstaand factuurbedrag, leads (7d) - met tijdvenster label" : "hoofdreden - concrete getal met tijdvenster label, bijv. \"CPL €38 (7d) vs €23 (prev 7d), +65%\""}]
• [${isReminder ? "tweede datapunt dat over X dagen relevant is om mee te vergelijken" : "ondersteunende observatie uit Pedro / Monday / Trengo - citeer letterlijk met datum"}]
• [evt. derde bullet, max 4 in deze sectie]

${sectionHeaders.next}:
• [${isReminder ? "concreet wat je moet checken + Hub deep-link uit de context hierboven" : "wat de assignee concreet moet doen"}]
• [evt. tweede bullet]

REGELS:
- Gebruik LETTERLIJK de "•" karakter voor bullets (NIET "-", NIET "*", NIET "1.")
- Lege regel tussen "${sectionHeaders.why}:" sectie en "${sectionHeaders.next}:" sectie
- Section labels eindigen met ":" en staan op een eigen regel
- Elk getal MOET een tijdvenster label krijgen: (7d) / (14d) / (30d) / (prev 7d) / (all-time)
- Citeer Pedro / Monday / Trengo / billing letterlijk wanneer relevant, mét datum
- Gebruik ALLEEN cijfers/quotes uit de context hierboven - niets verzinnen
- Houd elke bullet kort: max 20 woorden
${isReminder ? "- Vermeld in 'Op de reminder-dag' minstens één Hub deep-link uit de context (bv. /clients/X?tab=billing) zodat de klik direct in de juiste tab landt" : ""}

VERBODEN:
- Geen markdown headers (#, ##), bold (**), of italic (*)
- Geen budget-verhoging adviezen (klanten zitten op vast budget)
- Geen "Hi [naam]" - dit is een inbox ${isReminder ? "reminder" : "taak"}, geen mail
- Niet de titel herhalen
- Geen "${sectionHeaders.why}:" of "${sectionHeaders.next}:" zonder bullets eronder

Geef ALLEEN de body terug. Geen JSON, geen wrapping, geen preamble.

VOORBEELD output (${isReminder ? "reminder vorm" : "task vorm"} - niet inhoud kopiëren):
${isReminder ? `Snapshot vandaag:
• CPL €23.50 (7d), €28.10 (prev 7d) - dalende trend, €120 spend, 5 leads
• Openstaande factuur: €1.250 (status: open) per ${today}

Op de reminder-dag:
• Check CPL trend op /clients/123?tab=campaigns - blijft 'ie onder €23.50 of niet?
• Check factuur op /clients/123?tab=billing - nog steeds open of betaald?` : `Waarom:
• CPL €38 (7d) vs €23 (prev 7d), +65% - well boven 25% noise threshold
• Pedro AI Note (2026-05-19): "Photo 2 | Pricelist heeft 6/8 'geen budget' replies"
• Monday updates (14d) bevestigen patroon op UTM photo-2-pricelist

Volgende stap:
• Pauzeer Photo 2 | Pricelist en push budget naar Video 3 | Subsidie
• Lanceer 3 nieuwe varianten op subsidie-angle deze week`}`

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    })
    const raw =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : ""
    if (!raw) {
      return { body: originalBody ?? "", sourcesUsed, enriched: false }
    }
    return { body: raw, sourcesUsed, enriched: true }
  } catch (e) {
    console.error("Copilot enrich failed:", e)
    return { body: originalBody ?? "", sourcesUsed, enriched: false }
  }
}

function renderContextBlock(args: {
  client: MondayClient
  ctx: Awaited<ReturnType<typeof collectClientAiContext>>
  pedroInsight: ReturnType<typeof parsePedroBody>
  pedroGeneratedAt: string | null
}): string {
  const { client, ctx, pedroInsight, pedroGeneratedAt } = args
  const lines: string[] = []

  // Hub deep-links - the LLM can drop these into the body so future-you
  // (especially on a scheduled reminder) clicks straight through to the
  // live surface instead of navigating manually. Always emit the
  // client-page link; tab-specific ones only when that integration is
  // wired.
  const clientPath = `/clients/${encodeURIComponent(client.mondayItemId)}`
  lines.push("Hub deep-links:")
  lines.push(`- Client page: ${clientPath}`)
  lines.push(`- Campagnes (KPI's live): ${clientPath}?tab=campaigns`)
  if (client.stripeCustomerId) {
    lines.push(`- Facturatie (Stripe invoices): ${clientPath}?tab=billing`)
  }
  if (client.trengoContactId) {
    lines.push(`- Communicatie (Trengo thread): ${clientPath}?tab=communication`)
  }
  lines.push("")

  // KPI block
  if (ctx.kpi) {
    const k = ctx.kpi
    lines.push("KPI (7d window):")
    lines.push(`- Ad spend: €${k.adSpend.toFixed(0)}`)
    lines.push(`- Leads: ${k.leads}`)
    if (k.cpl > 0) lines.push(`- CPL: €${k.cpl.toFixed(2)} (7d) vs €${k.prevCpl.toFixed(2)} (prev 7d)`)
    if (k.prevCpl > 0 && k.cpl > 0) {
      const delta = ((k.cpl - k.prevCpl) / k.prevCpl) * 100
      lines.push(`- CPL change: ${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`)
    }
    if (ctx.recent) {
      lines.push(
        `- Recent window: CPL €${ctx.recent.recentCpl.toFixed(2)} (last ${ctx.recent.windowDays}d, ${ctx.recent.recentLeads} leads, €${ctx.recent.recentSpend.toFixed(0)} spend)`,
      )
    }
    lines.push("")
  }

  // Billing snapshot - Roy 2026-06-12: reminders about invoices ("check
  // dinsdag of de factuur betaald is") need today's open-balance + status
  // captured in the body so future-you sees what it was AT CREATION and
  // can compare to whatever the Stripe billing tab shows on the day.
  if (ctx.billing) {
    const b = ctx.billing
    lines.push("Billing snapshot (vandaag):")
    lines.push(`- Status: ${b.status}`)
    lines.push(`- Openstaand: €${b.outstanding.toFixed(2)}`)
    lines.push("")
  }
  if (ctx.billingHealth?.hasIssue) {
    lines.push(`Meta billing health: ${ctx.billingHealth.severity}`)
    lines.push(`- ${ctx.billingHealth.label}`)
    lines.push("")
  }

  // Pedro insight (most recent AI take on the client)
  if (pedroInsight && pedroInsight.conclusion) {
    const dateLabel = pedroGeneratedAt ? pedroGeneratedAt.slice(0, 10) : "?"
    lines.push(`Pedro AI Note (laatst gegenereerd ${dateLabel}):`)
    lines.push(`- ${pedroInsight.conclusion}`)
    if (pedroInsight.actions.length > 0) {
      lines.push(`- Voorgestelde acties: ${pedroInsight.actions.join(" · ")}`)
    }
    lines.push("")
  }

  // Monday CRM updates (last 14d, lead status feedback)
  if (ctx.mondayTrengo?.mondayUpdates) {
    lines.push("Monday CRM updates (14d):")
    lines.push(ctx.mondayTrengo.mondayUpdates.slice(0, 1500))
    lines.push("")
  }

  // Trengo conversations (last 14d, client sentiment)
  if (ctx.mondayTrengo?.trengoSummary) {
    lines.push("Trengo conversaties (14d):")
    lines.push(ctx.mondayTrengo.trengoSummary.slice(0, 1000))
    lines.push("")
  }

  // Fathom meetings (last 30d, sales / kickoff / evaluation)
  if (ctx.fathomMeetings.length > 0) {
    lines.push(`Recente meetings (${ctx.fathomMeetings.length}):`)
    for (const m of ctx.fathomMeetings.slice(0, 3)) {
      const date = m.scheduledAt?.slice(0, 10) ?? "?"
      lines.push(`- ${date} ${m.title ?? "(geen titel)"}: ${m.summary?.slice(0, 200) ?? "(geen samenvatting)"}`)
    }
    lines.push("")
  }

  // Inbox events (recent team activity)
  if (ctx.inboxEvents.length > 0) {
    const recent = ctx.inboxEvents.slice(0, 5)
    lines.push(`Recente inbox events (${recent.length}):`)
    for (const e of recent) {
      const date = e.createdAt.slice(0, 10)
      lines.push(`- ${date} [${e.kind}/${e.source}] ${e.title}`)
    }
    lines.push("")
  }

  return lines.length > 0 ? lines.join("\n") : "(geen aanvullende context beschikbaar)"
}

function listAvailableSources(
  ctx: Awaited<ReturnType<typeof collectClientAiContext>>,
  hasPedroInsight: boolean,
): string[] {
  const sources: string[] = []
  if (ctx.sources.kpi) sources.push("KPI (7d)")
  if (ctx.sources.billing) sources.push("Stripe billing")
  if (hasPedroInsight) sources.push("Pedro AI Note")
  if (ctx.sources.mondayUpdates) sources.push("Monday updates (14d)")
  if (ctx.sources.trengoSummary) sources.push("Trengo (14d)")
  if (ctx.sources.fathomMeetings) sources.push(`${ctx.fathomMeetings.length} meeting${ctx.fathomMeetings.length === 1 ? "" : "s"}`)
  if (ctx.sources.inboxEvents) sources.push(`${ctx.inboxEvents.length} inbox events`)
  return sources
}
