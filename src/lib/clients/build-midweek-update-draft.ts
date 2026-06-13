import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchClientById, type MondayClient } from "@/lib/integrations/monday"
import {
  fetchOverdueInvoices,
  type OverdueInvoice,
} from "@/lib/integrations/stripe"
import { parsePedroBody } from "@/lib/pedro/insights/types"
import {
  fetchKpisForWindow,
  type KpiSummary,
} from "@/app/api/kpi-summaries/route"
import {
  resolveWeeklyUpdateTemplate,
  type WaTemplateResolution,
} from "@/lib/clients/resolve-wa-template"
import { resolveClientSendChannel } from "@/lib/clients/send-channel"
import {
  buildOverdueBlock,
  type OverdueInvoiceForBlock,
} from "@/lib/clients/client-update-template"
import {
  detectChannel,
  resolveAmUserIdForClient,
  type WeeklyUpdateDraftResult,
} from "./build-weekly-update-draft"

/**
 * Mid-week ad-hoc update composer.
 *
 * Different from the Monday-morning `buildWeeklyUpdateDraft`:
 *  - The Monday digest is a STRUCTURED report (KPI block + trend +
 *    pre-defined sections). Same shape every week so AMs can scan 51 of
 *    them in 20 minutes.
 *  - Mid-week is CONVERSATIONAL — when an AM asks the Co-pilot for an
 *    update on Thursday, the client should not get the same skeleton
 *    they got Monday. Tone is varied per-send, structure is freer, and
 *    the context window is wider (7d vs prev, 14d vs prev, 30d vs prev,
 *    Pedro recent moves, last contact moment, overdue invoices).
 *
 * Composition: Claude generates the editable parts directly using the
 * EditableParts schema as a tool, so the dialog can still render +
 * edit + send through the same code path as the weekly. A randomisation
 * seed is woven into the prompt so two clients on the same day don't
 * get the same phrasing, and so the same client across mid-weeks reads
 * naturally instead of formulaic.
 */

const anthropic = new Anthropic()

const MIDWEEK_VARIANT_SEED_POOL = 32

type Locale = "nl" | "en"

type MidweekContext = {
  client: MondayClient
  amFirstName: string
  channel: "whatsapp" | "email"
  kpi7d: KpiSummary | null
  kpi14d: KpiSummary | null
  kpi30d: KpiSummary | null
  pedroConclusion: string | null
  pedroActions: string[]
  overdueInvoices: OverdueInvoice[]
  /** ISO date of the most recent inbox_event (any direction) involving
   *  this client. Null when we have nothing on file. Drives the "we
   *  hebben elkaar X dagen niet gesproken" framing. */
  lastContactAt: string | null
  variantSeed: number
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysAgo(now: Date, isoDay: string): number {
  const ms = now.getTime() - new Date(`${isoDay}T00:00:00Z`).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

/** Inclusive window of N days ending today (UTC). For N=7 with today
 *  = 2026-06-18 → { startDate: 2026-06-12, endDate: 2026-06-18 }. */
function rollingWindow(now: Date, days: number): { startDate: string; endDate: string } {
  const end = new Date(now)
  const start = new Date(now)
  start.setUTCDate(end.getUTCDate() - (days - 1))
  return { startDate: isoDate(start), endDate: isoDate(end) }
}

async function loadPedroBody(mondayItemId: string) {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("pedro_insights")
    .select("body")
    .eq("monday_item_id", mondayItemId)
    .eq("insight_type", "client_pedro")
    .maybeSingle()
  return parsePedroBody(data?.body ?? null)
}

async function loadHubUserName(userId: string): Promise<{ name: string | null } | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle<{ name: string | null }>()
  return data
}

/** Most recent inbox_event involving this client — any direction, any
 *  kind. Drives the "we hebben elkaar X dagen niet gesproken" framing
 *  the AI uses as a casual opener for clients that have gone quiet. */
async function loadLastContactAt(supabaseClientId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("inbox_events")
    .select("created_at")
    .eq("client_id", supabaseClientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>()
  return data?.created_at ?? null
}

/** Per-client Supabase id lookup. The cron's `weekly_update_drafts` FK
 *  needs the UUID, not the Monday item id. */
async function loadClientUuid(mondayItemId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

type ComposedMidweekParts = {
  opener: string
  intro: string
  kpiBlock: string
  trendSentence: string
  note: string
  conclusion: string
  actionsHeader: string
  actions: string[]
  subject: string
  signOff: string
  overdueBlock: string
}

const PARTS_TOOL: Anthropic.Tool = {
  name: "emit_midweek_update",
  description:
    "Emit the editable parts of a mid-week client update message in Dutch. Casual + varied + AM-voice. Channel-aware: WhatsApp wraps via the rl_universal_<voornaam> template (no greeting prefix, no signoff); Email is freeform with subject + greeting + signoff.",
  input_schema: {
    type: "object",
    properties: {
      opener: {
        type: "string",
        description:
          "First-name line. WhatsApp: '<FirstName>!' (template adds 'Hey ' prefix). Email: 'Hé <FirstName>,' (full greeting). VARY the opener interjection per send — 'Hey', 'Yo', 'Hoi', 'Hee', 'Hai' are all fine for email.",
      },
      intro: {
        type: "string",
        description:
          "1-2 sentence casual check-in. Should reference the actual context: 'wilde even kort updaten over X', 'zag dat we de afgelopen week …', etc. Reference last contact moment naturally when it's been a while. Vary phrasings — do NOT use the same opener structure as the Monday weekly digest ('Even een korte update over je campagne …').",
      },
      kpiBlock: {
        type: "string",
        description:
          "Free-text trend paragraph comparing recent windows to their priors. Do NOT use a fixed KPI block format — write it like an AM would type ('CPL de afgelopen 7 dagen €X vs €Y in de week daarvoor, ofwel Z% lager/hoger'). Pick the most newsworthy comparison (7d vs prev-7d when there's a clear move, otherwise 30d vs prev-30d). When KPI is absent/0-leads, skip numbers entirely and say something honest like 'lopen de cijfers nog niet, we kijken er deze week strak naartoe'.",
      },
      trendSentence: {
        type: "string",
        description:
          "One qualitative sentence framing the trend — what the AM thinks is driving it. Reference Pedro recent moves if relevant ('nieuwe creatives sinds vorige week zijn goed gevallen'). Empty string is OK when there's nothing to add.",
      },
      conclusion: {
        type: "string",
        description:
          "Forward-looking sentence: what we're doing next. Do not promise specifics that aren't backed by Pedro actions — keep it framed as 'komende dagen kijk ik …' / 'we testen verder …'.",
      },
      actionsHeader: {
        type: "string",
        description:
          "Header above action bullets. Default empty (the conversational structure usually doesn't need a labelled bullet list). Only fill when there genuinely are 2+ next steps worth listing.",
      },
      actions: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 3 concrete next-step bullets. Empty array is preferred for a 'how is it going' check-in — bullets read formal. Only fill when there's real news the AM wants to commit to.",
      },
      subject: {
        type: "string",
        description:
          "Email subject line. Empty string for WhatsApp. Casual + specific — 'Korte update <client>', 'Hoe staat het?', 'Even bijpraten over de campagne'. Vary per send.",
      },
      signOff: {
        type: "string",
        description:
          "Email-only closing line. WhatsApp leaves empty (template adds sign-off). Default 'Groetjes,' or similar single line — do NOT include the AM's name (Trengo email-from header already shows it).",
      },
    },
    required: [
      "opener",
      "intro",
      "kpiBlock",
      "trendSentence",
      "conclusion",
      "actionsHeader",
      "actions",
      "subject",
      "signOff",
    ],
  },
}

function describeKpi(label: string, kpi: KpiSummary | null): string {
  if (!kpi) return `${label}: geen data`
  const lines = [
    `${label}:`,
    `  spend €${kpi.adSpend.toFixed(0)}`,
    `  leads ${kpi.leads}`,
    `  CPL ${kpi.cpl > 0 ? `€${kpi.cpl.toFixed(2)}` : "n.v.t."}`,
  ]
  if (kpi.prevPeriodReliable !== false && kpi.prevCpl > 0) {
    const pct = ((kpi.cpl - kpi.prevCpl) / kpi.prevCpl) * 100
    lines.push(
      `  prev CPL €${kpi.prevCpl.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`,
    )
  } else {
    lines.push(`  prev period: niet betrouwbaar of geen data`)
  }
  return lines.join("\n")
}

function buildSystemPrompt(ctx: MidweekContext, locale: Locale): string {
  const today = isoDate(new Date())
  const lastContactNote = ctx.lastContactAt
    ? `Laatst contact via Trengo of Hub: ${ctx.lastContactAt.slice(0, 10)} (${daysAgo(new Date(), ctx.lastContactAt.slice(0, 10))} dagen geleden).`
    : "Geen recent contact in de Hub gevonden — voorzichtige opening die niet aanneemt dat er recente uitwisseling was."

  return `Je bent een account manager bij Rocket Leads die een korte, persoonlijke MID-WEEK update schrijft aan een klant. Dit is een ad-hoc check-in, NIET de wekelijkse maandag-digest.

Vandaag is ${today}. Klant: ${ctx.client.companyName || ctx.client.name}, voornaam contactpersoon: ${ctx.client.firstName || "(onbekend)"}. AM: ${ctx.amFirstName}. Kanaal: ${ctx.channel}.

ABSOLUTE REGELS:
1. NEDERLANDS, casual & persoonlijk. Geen agency-jargon, geen "ad sets", geen "frequency", geen "CTR".
2. NOOIT dezelfde opening als de wekelijkse digest ("Even een korte update over je campagne van de afgelopen week"). Vary phrasings actief.
3. NIET een vaste sectionele structuur — geen "Hier de KPI's:" met bullets. Schrijf als een AM die WhatsApp typt of een mailtje stuurt.
4. NOOIT cijfers verzinnen. Als ${ctx.client.firstName} weinig leads heeft, zeg dat eerlijk i.p.v. een nul invullen.
5. NOOIT de Monday weekly skeleton imiteren. Dit is een andere boodschap.

Variation seed: ${ctx.variantSeed} of 0-${MIDWEEK_VARIANT_SEED_POOL - 1}. Gebruik deze seed als hint voor woordkeuze + structuur — twee updates met verschillende seeds moeten merkbaar anders lezen.

CONTEXT:
${lastContactNote}

Performance vergelijkingen (gebruik alleen wat relevant is — verzin niets):
${describeKpi("Last 7d", ctx.kpi7d)}
${describeKpi("Last 14d", ctx.kpi14d)}
${describeKpi("Last 30d", ctx.kpi30d)}

Pedro (analyse van wat de Hub recent ziet op deze klant):
- Conclusion: ${ctx.pedroConclusion ?? "(niet beschikbaar)"}
${ctx.pedroActions.length > 0 ? `- Recent actiepunten:\n${ctx.pedroActions.map((a) => `  • ${a}`).join("\n")}` : "- Geen recente actiepunten."}

Overdue invoices (alleen vermelden als relevant — niet altijd noemen, klant kan zich aangevallen voelen):
${
  ctx.overdueInvoices.length > 0
    ? ctx.overdueInvoices
        .map((inv) => `- ${inv.number ?? inv.hostedUrl}: €${(inv.amountDue / 100).toFixed(2)} openstaand`)
        .join("\n")
    : "- Geen openstaande facturen."
}

LOCALE: ${locale}.

Roep emit_midweek_update aan met de finale parts. Hou per veld de toon casual en gevarieerd. Lege string of leeg array waar 'm leeg hoort.`
}

export async function buildMidweekUpdateDraft(args: {
  userId: string
  mondayItemId: string
  client?: MondayClient
}): Promise<WeeklyUpdateDraftResult | null> {
  const client = args.client ?? (await fetchClientById(args.mondayItemId))
  if (!client) return null

  const channel = detectChannel(client.contactChannel)
  const isEmail = channel === "email"
  // Mid-week falls back to whatsapp when the client has no preferred
  // channel set — phone is the more common contact route + the WhatsApp
  // template always exists.
  const effectiveChannel: "whatsapp" | "email" = isEmail ? "email" : "whatsapp"

  const amUserId = (await resolveAmUserIdForClient(client)) ?? args.userId

  // Three rolling windows ending today. fetchKpisForWindow auto-derives
  // the matching previous window for each call — that gives us 7d vs
  // prev-7d, 14d vs prev-14d, 30d vs prev-30d for free.
  const now = new Date()
  const w7 = rollingWindow(now, 7)
  const w14 = rollingWindow(now, 14)
  const w30 = rollingWindow(now, 30)
  const kpiInput = [
    {
      mondayItemId: client.mondayItemId,
      metaAdAccountId: client.metaAdAccountId || null,
      clientBoardId: client.clientBoardId || null,
    },
  ]
  const kpiPromise = async (range: { startDate: string; endDate: string }) =>
    fetchKpisForWindow({ clients: kpiInput, startDate: range.startDate, endDate: range.endDate })
      .then((map) => map[client.mondayItemId] ?? null)
      .catch(() => null)

  const supabaseClientUuid = await loadClientUuid(client.mondayItemId)

  const [kpi7d, kpi14d, kpi30d, pedro, waTemplate, hubUser, overdueInvoices, lastContactAt] =
    await Promise.all([
      kpiPromise(w7),
      kpiPromise(w14),
      kpiPromise(w30),
      loadPedroBody(args.mondayItemId),
      isEmail
        ? Promise.resolve({ name: null as string | null, source: "none" as const })
        : resolveWeeklyUpdateTemplate({ userId: amUserId, mondayItemId: args.mondayItemId }),
      loadHubUserName(amUserId),
      client.stripeCustomerId
        ? fetchOverdueInvoices(client.stripeCustomerId).catch(() => [] as OverdueInvoice[])
        : Promise.resolve([] as OverdueInvoice[]),
      supabaseClientUuid
        ? loadLastContactAt(supabaseClientUuid)
        : Promise.resolve(null as string | null),
    ])

  const amFirstName = (hubUser?.name?.split(/\s+/)[0] || "Roel").toString()
  const variantSeed = Math.floor(Math.random() * MIDWEEK_VARIANT_SEED_POOL)

  const ctx: MidweekContext = {
    client,
    amFirstName,
    channel: effectiveChannel,
    kpi7d,
    kpi14d,
    kpi30d,
    pedroConclusion: pedro?.conclusion ?? null,
    pedroActions: pedro?.actions ?? [],
    overdueInvoices,
    lastContactAt,
    variantSeed,
  }

  const systemPrompt = buildSystemPrompt(ctx, "nl")

  let parts: ComposedMidweekParts
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      // Mid-temperature randomness: enough to vary phrasings per send,
      // not so much that we hallucinate numbers. The variantSeed in the
      // system prompt gives an additional steering signal that survives
      // even when Anthropic dedupes identical prompts at temp 0.
      temperature: 0.7,
      system: systemPrompt,
      tools: [PARTS_TOOL],
      tool_choice: { type: "tool", name: "emit_midweek_update" },
      messages: [
        {
          role: "user",
          content: "Schrijf nu de mid-week update parts.",
        },
      ],
    })
    const toolUse = message.content.find((c) => c.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      return null
    }
    parts = toolUse.input as ComposedMidweekParts
  } catch (e) {
    console.error("[midweek-update] Claude call failed:", e instanceof Error ? e.message : e)
    return null
  }

  // Build the overdue block deterministically — Claude is told to
  // OPTIONALLY mention overdues in the body, but the payment link block
  // (with the Stripe-hosted URL) is appended here so it never gets
  // mis-pasted by the model.
  const overdueBlock = buildOverdueBlock(
    overdueInvoices.map<OverdueInvoiceForBlock>((inv) => ({
      amountDue: inv.amountDue,
      hostedUrl: inv.hostedUrl,
      number: inv.number,
    })),
  )

  const resolvedChannel = resolveClientSendChannel(client)
  const recipientPhone =
    resolvedChannel.ok && resolvedChannel.channel.kind === "whatsapp"
      ? resolvedChannel.channel.phone
      : client.phone || null
  const recipientEmail =
    resolvedChannel.ok && resolvedChannel.channel.kind === "email"
      ? resolvedChannel.channel.email
      : client.email || null

  return {
    parts: {
      opener: parts.opener,
      intro: parts.intro,
      kpiBlock: parts.kpiBlock,
      trendSentence: parts.trendSentence,
      note: "",
      conclusion: parts.conclusion,
      actionsHeader: parts.actionsHeader,
      actions: parts.actions,
      subject: parts.subject,
      signOff: parts.signOff,
      overdueBlock,
    },
    channel: effectiveChannel,
    channelLabel: client.contactChannel,
    trengoContactLinked: resolvedChannel.ok,
    whatsappTemplateName: waTemplate.name,
    whatsappTemplateSource: waTemplate.source as WaTemplateResolution["source"],
    recipientEmail,
    recipientPhone,
  }
}
