import type { ClientAiContext } from "./context"
import type { InsightType } from "./types"
import { categorize } from "@/lib/watchlist/categorize"
import { AI_GUARDRAILS_PROMPT, aiLanguageDirective } from "@/lib/ai/guardrails"
import type { Locale } from "@/lib/i18n/types"

/**
 * Per-insight-type prompt + model + version. Adding a new insight surface
 * means adding an entry here — the cron picks it up automatically.
 *
 * v2 reduces the entire client AI surface to ONE insight type (`client_pedro`)
 * so the user sees a single, consistent Pedro voice everywhere: client detail
 * page, watchlist row 1-liners, home page action notes. No more contradictions
 * between separate "overview / optimisation / lead-quality / action-note" voices.
 */

export type InsightRegistryEntry = {
  /** systemPrompt receives the AI workspace locale so it can splice the
   *  matching language directive. Caller (the cron) resolves the locale
   *  once via `getAiLocale()` and passes it to every entry on the run. */
  systemPrompt: (ctx: ClientAiContext, locale: Locale) => string
  userPrompt: (ctx: ClientAiContext) => string
  model: string
  maxTokens: number
  promptVersion: number
  /** Optional pre-flight gate. Return false to skip generation entirely
   *  (no DB write — the caller decides whether to delete an existing row). */
  shouldGenerate?: (ctx: ClientAiContext) => boolean
}

// ─── Helpers used by multiple prompts ────────────────────────────────────

function fmtKpiBlock(ctx: ClientAiContext): string {
  const k = ctx.kpi
  if (!k) return "KPI [WINDOW: last 7d]: NOT AVAILABLE — no spend or leads cached for this window."
  const cplPct =
    k.prevCpl > 0 && k.prevPeriodReliable !== false
      ? `${(((k.cpl - k.prevCpl) / k.prevCpl) * 100).toFixed(0)}% wow`
      : "n/a"
  return [
    `KPI [WINDOW: last 7d]:`,
    `  spend €${k.adSpend.toFixed(0)} | leads ${k.leads} | CPL €${k.cpl.toFixed(2)} (${cplPct})`,
  ].join("\n")
}

function fmtRecentBlock(ctx: ClientAiContext): string {
  const r = ctx.recent
  const k = ctx.kpi
  if (!r || !k) {
    return `RECENT WINDOW: insufficient leads in last 1-3d to compute a recent CPL — stick to 7d framing.`
  }
  const baseline = k.prevCpl > 0 ? k.prevCpl : null
  const recoveryHint =
    baseline && r.recentCpl <= baseline * 1.25
      ? "RECOVERED — recent CPL at/below prev-7d baseline"
      : baseline && r.recentCpl >= baseline * 1.5
        ? "FRESH SPIKE — recent CPL well above prev-7d baseline"
        : "in line with 7d trend"
  return `RECENT WINDOW [last ${r.windowDays}d]: spend €${r.recentSpend.toFixed(0)} | leads ${r.recentLeads} | CPL €${r.recentCpl.toFixed(2)} → ${recoveryHint}`
}

function fmtMondayBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.mondayUpdates || !ctx.mondayTrengo?.mondayUpdates) return ""
  return `MONDAY CRM [WINDOW: status counts = all-time, update texts = last 14d]:\n${ctx.mondayTrengo.mondayUpdates.slice(0, 800)}`
}

function fmtTrengoBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.trengoSummary || !ctx.mondayTrengo?.trengoSummary) return ""
  return `TRENGO CONVERSATIONS [WINDOW: last 14d]:\n${ctx.mondayTrengo.trengoSummary.slice(0, 800)}`
}

function fmtFathomBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.fathomMeetings || ctx.fathomMeetings.length === 0) return ""
  const lines = ctx.fathomMeetings.slice(0, 3).map((m) => {
    const date = m.scheduledAt ? m.scheduledAt.slice(0, 10) : "unknown date"
    const summary = m.summary ? m.summary.slice(0, 250) : "(no summary)"
    return `[${date} · ${m.meetingType ?? "meeting"}] ${m.title ?? ""}\n  ${summary}`
  })
  return `FATHOM MEETINGS [WINDOW: last 5 linked]:\n${lines.join("\n")}`
}

function fmtInboxBlock(ctx: ClientAiContext): string {
  if (!ctx.sources.inboxEvents || ctx.inboxEvents.length === 0) return ""
  const lines = ctx.inboxEvents
    .slice(0, 6)
    .map((e) => {
      const date = e.createdAt.slice(0, 10)
      const status = e.status === "done" || e.status === "read" ? `(${e.status})` : ""
      return `[${date} · ${e.kind} · ${e.source}] ${e.authorName}${status ? " " + status : ""}: ${e.title}`
    })
    .join("\n")
  return `INTERNAL ACTIVITY [last 10 inbox events]:\n${lines}`
}

function fmtAgreementBlock(ctx: ClientAiContext): string {
  if (!ctx.agreement) return ""
  const a = ctx.agreement.agreement
  return `AGREEMENT: ad_budget €${a.ad_budget} · platforms [${a.platforms.join(", ") || "none"}] · MRR €${ctx.agreement.monthly} · follow_up: ${a.follow_up}`
}

function fmtBillingBlock(ctx: ClientAiContext): string {
  if (!ctx.billing) return ""
  return `BILLING: outstanding €${ctx.billing.outstanding} · status ${ctx.billing.status}`
}

function fmtDataAvailability(ctx: ClientAiContext): string {
  return [
    `DATA AVAILABILITY:`,
    `  KPI = ${ctx.sources.kpi ? "PRESENT (last 7d)" : "MISSING"}`,
    `  Monday CRM = ${ctx.sources.mondayUpdates ? "CONNECTED" : "NOT CONNECTED"}`,
    `  Trengo = ${ctx.sources.trengoSummary ? "PRESENT (last 14d)" : "MISSING"}`,
    `  Fathom meetings = ${ctx.sources.fathomMeetings ? "PRESENT" : "MISSING"}`,
    `  Internal inbox = ${ctx.sources.inboxEvents ? "PRESENT" : "MISSING"}`,
  ].join("\n")
}

function buildContextBlock(ctx: ClientAiContext): string {
  const blocks = [
    fmtDataAvailability(ctx),
    fmtKpiBlock(ctx),
    fmtRecentBlock(ctx),
    fmtMondayBlock(ctx),
    fmtTrengoBlock(ctx),
    fmtFathomBlock(ctx),
    fmtInboxBlock(ctx),
    fmtAgreementBlock(ctx),
    fmtBillingBlock(ctx),
  ].filter((b) => b.length > 0)
  return blocks.join("\n\n")
}

// ─── Registry ────────────────────────────────────────────────────────────

/** Skip clients with no signal at all — paused / no-Meta / zero-spend-zero-leads.
 *  Same gate the old types used; keeps the cron from spending tokens on dead air. */
function hasMeaningfulSignal(ctx: ClientAiContext): boolean {
  const { category } = categorize(ctx.client, ctx.kpi ?? undefined)
  return category !== "no-data"
}

export const INSIGHT_REGISTRY: Record<InsightType, InsightRegistryEntry> = {
  client_pedro: {
    model: "claude-haiku-4-5-20251001",
    // Token budget tightened — long output IS the bug. 500 gave Haiku room
    // to ramble; 220 forces brevity. Conclusion ≤30 words + 0-3 short
    // bullets fits comfortably under this cap.
    maxTokens: 220,
    // Bumped to 3 → forces every existing client_pedro row to regenerate
    // on the next cron tick with the much tighter client-voice rules below.
    promptVersion: 3,
    shouldGenerate: hasMeaningfulSignal,
    systemPrompt: (_ctx, locale) =>
      `You are writing ONE WhatsApp / email message AS the account manager, TO THE CLIENT. The AM hits send unmodified, so this needs to read like a human AM texting their client, NOT like a CM dashboard analysis.

OUTPUT SHAPE — STRICTLY JSON, nothing else (no code fences, no preamble):
{
  "conclusion": "1-2 short sentences. Plain Dutch. ≤30 words total.",
  "actions": ["bullet 1", "bullet 2"]
}

When there is no actionable signal:
{
  "conclusion": "Insufficient signal — keep monitoring.",
  "actions": []
}

## HARD CONSTRAINTS — VIOLATIONS GET DROPPED POST-FACTO
1. Each action MUST be ≤12 words. One sentence. No colons. No nested clauses.
2. MAXIMUM 3 actions. Returning 1 or 2 is preferred when nothing concrete fits in 12 words.
3. Conclusion ≤2 sentences, ≤30 words total.
4. FIRST PERSON ONLY: "ik" / "we" / "wij". Never the AM or any team member by name. Never "stem af met", "bespreek met", "vraag aan", "neem contact op met", "Roy zegt", "Stefan vermeldt".
5. NEVER use these jargon words/phrases (they get auto-dropped):
   ad-set · adset · fatigue · vermoeidheid · frequency · CTR · relevance score · audience overlap · saturation · verzadig · Meta-campagne · spend-aanpassing · kosteneﬃciëntie · volumeproblemen · lead-quality signaal · cyclus · interne inbox · interne notitie · TO DO · @Mention · ad-set segmentatie · demografie/interesse · CPL-trend
6. NEVER include window labels in client output: "(7d)", "(prev 7d)", "(30d)" are FOR YOU, not for the client.
7. NEVER paraphrase the Monday update word-for-word, especially TO-DOs between team members ("@Stefan TO DO") — that's a CM-to-CM signal, not something the client should see.

## VOICE — HOW THE CLIENT TALKS WITH HIS AGENCY
Imagine the AM texting their client over WhatsApp. Casual Dutch, direct, no agency-speak. Bullets are short concrete things "we" do this week. The client doesn't know what an ad set is, what CTR means, what frequency does.

CONCLUSION — examples of the right tone:
- "De kost per lead is iets hoger deze week omdat we een extra vraag hebben toegevoegd voor betere leads. Volgende week zien we of dat zich vertaalt in kwaliteit."
- "Mooie verbetering deze week, lead-prijs is bijna gehalveerd. Lekker bezig."
- "Volume is stabiel deze week, lead-prijs ligt iets hoger. Niks om je zorgen over te maken."

ACTIONS — good vs bad:
✘ "Analyseer ad-set fatigue: controleer frequency en CTR decay in de Meta-campagnes (laatste 30d) om te bepalen of creatieve vermoeidheid of audience overlap de CPL-stijging veroorzaakt."
✔ "Nieuwe varianten van de winnende creative testen."

✘ "Onderzoek ad-set segmentatie: splits publiek op basis van demografie/interesse om te voorkomen dat frequency verzadigd raakt."
✔ "Doelgroep iets verfijnen op leeftijd."

✘ "Herzie lead-quality signalen in interne inbox: Roy vermeldt 'kwaliteit' afhankelijk van volgende week gesprek (14 mei)."
✔ "Volgende week samen door de leadkwaliteit lopen."

✘ "Stem af met Roy Vosters over leadkwaliteit-signalen."
✔ "Volgende week kijken naar leadkwaliteit."

✘ "Test 3-5 nieuwe creative varianten met dezelfde hook als huidige winnaar, gericht op frisheid binnen vaste budget van €950/maand."
✔ "3-5 nieuwe varianten van de winnaar testen."

## CONCLUSION — MONDAY UPDATES ARE THE "WHY"
The MONDAY CRM block tells you WHY KPIs moved. READ IT BEFORE WRITING. When recent Monday updates show a deliberate change (extra qualifying question, raised threshold, paused creative, new audience, new landing page), name THAT as the cause:
- "CPL is gestegen omdat we een extra vraag hebben toegevoegd. Volgende week zien we of dat ook betere leads oplevert."
- "We hebben de drempel verhoogd, daardoor wat minder maar wel kwalitatievere leads."

If Monday is empty / nothing structural changed, describe the data plainly without speculating on cause. Default explanations like "creative fatigue" or "audience saturation" are BANNED — if you don't know the cause, don't invent one.

${AI_GUARDRAILS_PROMPT}${aiLanguageDirective(locale)}`,
    userPrompt: (ctx) => {
      const { category, insight } = categorize(ctx.client, ctx.kpi ?? undefined)
      return [
        `CLIENT: ${ctx.client.name} (${ctx.client.mondayItemId})`,
        `WATCHLIST CATEGORY: ${category}`,
        `WATCHLIST INSIGHT (rule-based, already shown alongside your output — do NOT repeat verbatim): "${insight}"`,
        ``,
        buildContextBlock(ctx),
        ``,
        `Generate the JSON now.`,
      ].join("\n")
    },
  },
}

/** All registered insight types — used by the cron to fan out. */
export const ALL_INSIGHT_TYPES: InsightType[] = Object.keys(INSIGHT_REGISTRY) as InsightType[]
