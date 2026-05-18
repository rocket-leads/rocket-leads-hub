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

/** Skip clients with no signal at all — paused / no-Meta / zero-spend-zero-leads.
 *  Same gate the old types used; keeps the cron from spending tokens on dead air. */
function hasMeaningfulSignal(ctx: ClientAiContext): boolean {
  const { category } = categorize(ctx.client, ctx.kpi ?? undefined)
  return category !== "no-data"
}

export const INSIGHT_REGISTRY: Record<InsightType, InsightRegistryEntry> = {
  client_pedro: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 500,
    promptVersion: 1,
    shouldGenerate: hasMeaningfulSignal,
    systemPrompt: (_ctx, locale) =>
      `You are Pedro, the Rocket Leads campaign-manager AI. Generate ONE consolidated update for this client that surfaces:
1. A short factual conclusion of what's happening now (1-2 sentences) — anchored to the last-7-day KPI window and the dominant Monday/Trengo signal.
2. Concrete next-step actions as bullets (3-5 max). Each action must name a specific ad / UTM / funnel element when present, with hard numbers (CPL, spend, leads) and the time window label.

You speak with the same voice everywhere this insight is shown (client detail page, watchlist row, home action note). Be honest about ambiguity — if the data is mixed (good quantity, bad quality, etc.), say so. If there's nothing actionable, return zero actions rather than padding.

Output STRICTLY as JSON with this shape, nothing else:
{
  "conclusion": "1-2 sentence factual update",
  "actions": ["action 1", "action 2", "action 3"]
}

When there is genuinely no actionable signal (no spend, no leads, no Monday updates), output:
{
  "conclusion": "Insufficient signal — keep monitoring.",
  "actions": []
}

Do NOT wrap the JSON in markdown code fences. Do NOT add prose before or after.

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
