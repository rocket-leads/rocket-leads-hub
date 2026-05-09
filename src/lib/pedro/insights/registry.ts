import type { ClientAiContext } from "./context"
import type { InsightType } from "./types"
import { categorize } from "@/lib/watchlist/categorize"
import { AI_GUARDRAILS_PROMPT } from "@/lib/ai/guardrails"

/**
 * Per-insight-type prompt + model + version. Adding a new insight surface
 * means adding an entry here — the cron picks it up automatically.
 *
 * Each entry exposes:
 *   - systemPrompt(ctx)  → returns the system prompt for that insight type,
 *                          with the canonical AI_GUARDRAILS_PROMPT spliced in.
 *   - userPrompt(ctx)    → returns the user-message body for the LLM call.
 *   - model              → which Claude model to use (Haiku for short notes,
 *                          Sonnet for full analyses).
 *   - maxTokens          → budget cap; small for one-liners, larger for analyses.
 *   - promptVersion      → bumped whenever the prompt changes; old rows are
 *                          regenerated on the next cron tick.
 *   - shouldGenerate(ctx) → optional gate. e.g. watchlist_action_note skips
 *                          clients in the no-data bucket — no point asking
 *                          Claude what's wrong when there's no signal.
 *
 * Keep the prompt bodies small and DON'T duplicate the guardrails — they
 * live exactly once in lib/ai/guardrails.ts and are spliced in here.
 */

export type InsightRegistryEntry = {
  systemPrompt: (ctx: ClientAiContext) => string
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
  const apptsLine = ctx.sources.mondayUpdates
    ? `appts ${k.appointments} (informational only — CPA is NOT a signal driver)`
    : `appts UNKNOWN — Monday CRM not connected (do NOT claim 0 appointments)`
  return [
    `KPI [WINDOW: last 7d]:`,
    `  spend €${k.adSpend.toFixed(0)} | leads ${k.leads} | CPL €${k.cpl.toFixed(2)} (${cplPct}) | ${apptsLine}`,
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
    `  Monday CRM = ${ctx.sources.mondayUpdates ? "CONNECTED" : "NOT CONNECTED — appointments are UNKNOWN, not zero"}`,
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

/**
 * Skip-generate gate shared by every insight type that needs at least
 * minimal signal to be worth a Claude call. Same gate currently used by
 * `watchlist_action_note`.
 */
function hasMeaningfulSignal(ctx: ClientAiContext): boolean {
  const { category } = categorize(ctx.client, ctx.kpi ?? undefined)
  return category !== "no-data"
}

export const INSIGHT_REGISTRY: Record<InsightType, InsightRegistryEntry> = {
  watchlist_action_note: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 200,
    promptVersion: 1,
    shouldGenerate: hasMeaningfulSignal,
    systemPrompt: () =>
      `You are a senior campaign manager at Rocket Leads. Generate ONE 1-line AI Note for the Watch List row this client occupies.

The note appears NEXT to an "Insight" column the user has already read. The user reads Insight FIRST, then your note. Your note must ADD to the Insight, never repeat it. Answer "OK I see the Insight, but what SPECIFICALLY should I do?"

Be concrete: name specific ads/UTMs/funnel elements when present in MONDAY CRM / TRENGO data. If there are no concrete ads to name, recommend the next investigative step ("audit follow-up timing — 11 leads (14d) marked 'niet bereikbaar'").

Keep under 30 words. Direct, no fluff. Output the line as plain text — no JSON, no leading dashes.

${AI_GUARDRAILS_PROMPT}`,
    userPrompt: (ctx) => {
      const { category, insight } = categorize(ctx.client, ctx.kpi ?? undefined)
      return [
        `CLIENT: ${ctx.client.name} (${ctx.client.mondayItemId})`,
        `WATCHLIST CATEGORY: ${category}`,
        `INSIGHT COLUMN (already visible — DO NOT REPEAT): "${insight}"`,
        ``,
        buildContextBlock(ctx),
        ``,
        `Generate the AI Note line now. One sentence, plain text, no preamble.`,
      ].join("\n")
    },
  },

  client_overview: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 350,
    promptVersion: 1,
    // Generate even for no-data clients — a "client paused, no recent
    // activity" overview is still informative on the client detail header.
    systemPrompt: () =>
      `You are Pedro, the Rocket Leads campaign-manager AI. Generate a 2-3 sentence "current state of the union" overview for this client — the kind of whisper a senior CM gives to a colleague about to step into the relationship.

Surface what's actually happening NOW: are they performing, where's the friction, what's the next thing to watch. Bias toward concrete signals from Monday updates / Trengo / Fathom meetings / inbox events when present, fall back to KPI shape when those are missing.

Tone: factual, slightly conversational, no sales-deck adjectives. Don't pad with platitudes. If the client is genuinely unremarkable, say so concisely.

Output as 2-3 sentences of plain prose, no bullets, no preamble. Under 90 words total.

${AI_GUARDRAILS_PROMPT}`,
    userPrompt: (ctx) => {
      const { category, insight } = categorize(ctx.client, ctx.kpi ?? undefined)
      return [
        `CLIENT: ${ctx.client.name} (${ctx.client.mondayItemId})`,
        `WATCHLIST CATEGORY: ${category}`,
        `WATCHLIST INSIGHT: "${insight}"`,
        ``,
        buildContextBlock(ctx),
        ``,
        `Write the 2-3 sentence overview now. Plain prose, no bullets.`,
      ].join("\n")
    },
  },

  client_optimisation_summary: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 250,
    promptVersion: 1,
    shouldGenerate: hasMeaningfulSignal,
    systemPrompt: () =>
      `You are Pedro, the Rocket Leads optimisation AI. Output a 1-2 sentence concrete optimisation suggestion for this client — the SHORT version that lives in side-rails (Watch List preview, Home dashboard quick-view).

The full structured proposal lives elsewhere — your job is the elevator pitch. Pick the single highest-leverage move from the data: pause a specific ad, iterate on a winning hook, refresh creative on a stale ad set, or test a new angle. Reference ad names / UTMs when present.

If the client has no actionable signal (no spend, no leads, no Monday updates), output exactly: "Insufficient signal — no concrete optimisation yet."

Plain prose, no bullets, no JSON, no preamble. Under 60 words.

${AI_GUARDRAILS_PROMPT}`,
    userPrompt: (ctx) => {
      const { category, insight } = categorize(ctx.client, ctx.kpi ?? undefined)
      return [
        `CLIENT: ${ctx.client.name} (${ctx.client.mondayItemId})`,
        `WATCHLIST CATEGORY: ${category}`,
        `WATCHLIST INSIGHT: "${insight}"`,
        ``,
        buildContextBlock(ctx),
        ``,
        `Write the 1-2 sentence optimisation now.`,
      ].join("\n")
    },
  },

  client_lead_quality_summary: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 250,
    promptVersion: 1,
    shouldGenerate: (ctx) => {
      // Lead quality only makes sense when Monday CRM is connected —
      // otherwise we'd be guessing. Skip without CRM.
      return ctx.sources.mondayUpdates
    },
    systemPrompt: () =>
      `You are Pedro, the Rocket Leads lead-quality AI. Output a 1-2 sentence verdict on the leads currently coming in for this client — based on Monday CRM updates and (when present) Trengo conversations.

Two angles to weigh:
- Quantity efficiency = is CPL / CPA in line with their typical baseline? (KPI block)
- Quality = what do the AM/setter Monday updates actually say? Look for repeated patterns: "geen budget", "niet bereikbaar", "niet geinteresseerd", "afspraak ingepland", "deal closed", etc.

Lead with the dominant pattern. Cite a specific UTM/ad when one stands out. If the lead-quality signal is mixed (good quantity but bad quality, or vice versa), say so plainly.

Plain prose, no bullets, no JSON. Under 60 words.

${AI_GUARDRAILS_PROMPT}`,
    userPrompt: (ctx) => {
      const { category, insight } = categorize(ctx.client, ctx.kpi ?? undefined)
      return [
        `CLIENT: ${ctx.client.name} (${ctx.client.mondayItemId})`,
        `WATCHLIST CATEGORY: ${category}`,
        `WATCHLIST INSIGHT: "${insight}"`,
        ``,
        buildContextBlock(ctx),
        ``,
        `Write the 1-2 sentence lead-quality verdict now.`,
      ].join("\n")
    },
  },
}

/** All registered insight types — used by the cron to fan out. */
export const ALL_INSIGHT_TYPES: InsightType[] = Object.keys(INSIGHT_REGISTRY) as InsightType[]
