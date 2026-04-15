import { createAdminClient } from "@/lib/supabase/server"
import { readCache, writeCache } from "@/lib/cache"
import { fingerprintInsight } from "@/lib/insight-fingerprint"
import Anthropic from "@anthropic-ai/sdk"
import { readFile } from "fs/promises"
import { join } from "path"

// AI proposals are cached for 24h. The first viewer of the day for a given
// client (or the daily cron) populates the cache; everyone else hits it.
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000

const anthropic = new Anthropic()

export type RawInsight = {
  type: "positive" | "warning" | "critical" | "action"
  title: string
  action?: string
  detail?: string
  fingerprint?: string
}

export type LeadAnalysisVerdict = "good" | "neutral" | "concerning"

export type LeadAnalysisSection = {
  verdict: LeadAnalysisVerdict
  headline: string
  detail: string
  patterns?: string[]
}

export type LeadAnalysis = {
  quantity: LeadAnalysisSection
  quality: LeadAnalysisSection
}

export type CachedProposal = {
  insights: RawInsight[]
  leadAnalysis: LeadAnalysis | null
  hasKnowledge: boolean
  generatedAt: string
}

export type LeadFeedbackEntry = {
  utm: string
  totalLeads: number
  updates: Array<{ text: string; leadStatus: string }>
}

export type AdDetailEntry = {
  adName: string
  adsetName: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  body: string
  creativeType: string
}

export type ProposalInput = {
  mondayItemId: string
  clientName: string
  boardType: "onboarding" | "current"
  kpis7d: Record<string, unknown> | null
  kpis14d: Record<string, unknown> | null
  kpis30d: Record<string, unknown> | null
  hasCrm: boolean
  leadFeedback?: LeadFeedbackEntry[]
  adDetails?: AdDetailEntry[]
}

export type ProposalResult = {
  insights: RawInsight[] // already feedback-filtered
  leadAnalysis: LeadAnalysis | null
  hasKnowledge: boolean
  generatedAt: string
  fromCache: boolean
}

export function proposalCacheKey(mondayItemId: string) {
  return `client_proposal:${mondayItemId}`
}

/**
 * Loads the set of fingerprints that should currently be hidden because
 * the manager already resolved them (done / skip / unsnoozed later).
 */
export async function loadActiveFingerprints(clientId: string): Promise<Set<string>> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("proposal_feedback")
    .select("insight_fingerprint, status, snoozed_until")
    .eq("client_id", clientId)

  const now = Date.now()
  const fingerprints = new Set<string>()
  for (const row of data ?? []) {
    const isActive =
      row.status === "done" ||
      row.status === "skip" ||
      (row.status === "later" && row.snoozed_until && new Date(row.snoozed_until).getTime() > now)
    if (isActive) fingerprints.add(row.insight_fingerprint)
  }
  return fingerprints
}

async function loadKnowledgeFile(filename: string): Promise<string> {
  try {
    const path = join(process.cwd(), "knowledge", filename)
    return await readFile(path, "utf-8")
  } catch {
    return ""
  }
}

/**
 * Generate (or read from cache) an AI optimization proposal for a single
 * client. Used by both the on-demand POST route and the daily cron.
 *
 * - On cache hit (within TTL) and `force` is false, returns the cached
 *   insights with the latest feedback filter applied.
 * - Otherwise calls Anthropic, fingerprints the insights, writes the
 *   raw fingerprinted set to the cache, and returns the filtered view.
 */
export async function generateProposalForClient(
  input: ProposalInput,
  options: { force?: boolean } = {},
): Promise<ProposalResult> {
  const { mondayItemId } = input
  const force = options.force === true

  const supabase = await createAdminClient()

  const { data: client } = await supabase
    .from("clients")
    .select("id")
    .eq("monday_item_id", mondayItemId)
    .single()

  // Cache hit path — feedback filter is reapplied at read time so changes
  // to the feedback table take effect immediately.
  if (!force) {
    const cached = await readCache<CachedProposal>(proposalCacheKey(mondayItemId), PROPOSAL_TTL_MS)
    if (cached) {
      const activeFingerprints = client ? await loadActiveFingerprints(client.id) : new Set<string>()
      const insights = cached.insights.filter((i) => !i.fingerprint || !activeFingerprints.has(i.fingerprint))
      return {
        insights,
        leadAnalysis: cached.leadAnalysis ?? null,
        hasKnowledge: cached.hasKnowledge,
        generatedAt: cached.generatedAt,
        fromCache: true,
      }
    }
  }

  // Cache miss / forced regen — load knowledge + feedback history,
  // build the prompt, call Anthropic, fingerprint, cache, return.
  let knowledgeContext = ""
  let feedbackHistoryText = ""
  const activeFingerprints: Set<string> = new Set()

  if (client) {
    const [knowledgeRes, feedbackRes] = await Promise.all([
      supabase
        .from("client_knowledge")
        .select("title, content, source")
        .eq("client_id", client.id),
      supabase
        .from("proposal_feedback")
        .select("insight_fingerprint, insight_type, insight_title, insight_action, status, feedback_note, snoozed_until, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ])

    if (knowledgeRes.data && knowledgeRes.data.length > 0) {
      knowledgeContext = knowledgeRes.data
        .map((k) => `### ${k.title} (source: ${k.source})\n${k.content}`)
        .join("\n\n---\n\n")
    }

    const now = Date.now()
    const historyLines: string[] = []
    for (const row of feedbackRes.data ?? []) {
      const isActive =
        row.status === "done" ||
        row.status === "skip" ||
        (row.status === "later" && row.snoozed_until && new Date(row.snoozed_until).getTime() > now)
      if (isActive) {
        activeFingerprints.add(row.insight_fingerprint)
      }

      const date = row.created_at?.slice(0, 10) ?? ""
      const tag = row.status.toUpperCase()
      const note = row.feedback_note ? ` — note: "${row.feedback_note}"` : ""
      historyLines.push(`- [${tag} ${date}] "${row.insight_title}"${row.insight_action ? ` → ${row.insight_action}` : ""}${note}`)
    }

    if (historyLines.length > 0) {
      feedbackHistoryText = historyLines.join("\n")
    }
  }

  const [campaignsKnowledge, processKnowledge] = await Promise.all([
    loadKnowledgeFile("campaigns.md"),
    loadKnowledgeFile("process.md"),
  ])

  const systemPrompt = `You are a senior performance marketing strategist at Rocket Leads, a Dutch lead generation agency. You produce two things for each client: a Lead Analysis (current state) and an AI Optimisation Proposal (what to do).

## Your role
- **Lead Analysis** — judge how the client is doing right now in two dimensions: lead **quantity** (volume + CPL vs baseline) and lead **quality** (conversion + Monday update sentiment).
- **AI Optimisation Proposal** — generate concrete actionable insights to improve performance.
- Use client-specific context (kick-off notes, ICP, USPs, brand guidelines) to make everything highly personalized.
- Reference Rocket Leads' proven frameworks and marketing angles.

## Output format
Return a SINGLE JSON OBJECT (not an array) with this exact shape:

{
  "leadAnalysis": {
    "quantity": {
      "verdict": "good" | "neutral" | "concerning",
      "headline": "1-line summary with key numbers (max 80 chars)",
      "detail": "1-2 sentences explaining the trend vs baseline (7d vs 14d vs 30d)",
      "patterns": ["optional bullet 1", "optional bullet 2"]
    },
    "quality": {
      "verdict": "good" | "neutral" | "concerning",
      "headline": "1-line summary of lead quality (max 80 chars)",
      "detail": "1-2 sentences about conversion + Monday update patterns",
      "patterns": ["Photo 2 | Pricelist: 5/8 leads said 'geen budget'", "Photo 4: 3 leads progressed to deal"]
    }
  },
  "insights": [
    {
      "type": "positive" | "warning" | "critical" | "action",
      "title": "observation with key numbers (max 60 chars)",
      "action": "one concrete next step (max 60 chars)",
      "detail": "optional 1-2 sentence why/context (hidden by default)"
    }
  ]
}

### Lead Analysis rules

**CRITICAL — Quantity is about COST EFFICIENCY, not volume.**
- NEVER reference raw lead counts, volume drops, or volume increases. These are a function of ad budget — when spend goes down, leads go down. That tells us nothing about performance.
- Volume changes can be caused by: budget reduction, campaign pause, ad pause, weekend/holiday effects, ad account issues. None of these are actionable signals about lead performance.
- **The ONLY metrics that matter for quantity are CPL (cost per lead) and CPA (cost per appointment / booked call).** These normalise for budget and show real efficiency.
- Compare current CPL/CPA (7d) against 14d and 30d baselines to detect efficiency trends.

**CRITICAL — 25% noise threshold for CPL/CPA changes.**
Meta delivers fluctuates week-over-week due to auction dynamics, audience saturation, day-of-week effects, and creative rotation. Small changes are noise, not signal.
- **CPL or CPA change of less than 25% (in either direction) is NORMAL NOISE — never flag as concerning, never generate an action insight about it.** Treat it as stable.
- Only at **+25% or more INCREASE** in CPL or CPA versus the 14d/30d baseline does it become a real signal worth acting on.
- A **−25% or more DECREASE** is a real win — a winning ad/angle worth iterating on.
- This threshold applies to BOTH the Lead Analysis verdict AND the Optimisation Proposal insights. Do not waste a campaign manager's time with insights about ±15% CPL movements.

- **quantity.verdict**:
  - "good" = CPL OR CPA improved by 25%+ vs baseline, OR both stable within ±25% AND in healthy absolute range for the industry
  - "concerning" = CPL OR CPA degraded by 25%+ vs baseline
  - "neutral" = both CPL and CPA within ±25% of baseline (normal Meta noise — no action needed)
- **quantity.headline** must lead with CPL or CPA numbers, not lead counts. Example: "CPL stable at €11.42 (within noise vs €11.30 baseline)"
- **quantity.detail** explains the cost efficiency trend AND explicitly states whether it crosses the 25% threshold. NEVER explain it via volume.
- **quantity.patterns** if used should cite per-ad CPL/CPA where the change crosses ±25%. Skip ads within the noise band.

**Insight (optimisation proposal) implications of the 25% rule:**
- DO NOT generate "CPL trending up" or "CPA worsening" insights unless the change is ≥25%
- DO NOT generate insights about lead volume drops or rises — ever
- DO generate insights when CPL/CPA cross the 25% threshold, AND when Monday update sentiment reveals quality issues regardless of cost trends

**Quality rules:**
- **quality.verdict** = primarily based on Monday update sentiment per UTM. Ignore raw conversion rate if Monday updates tell a different story (e.g. high conversion to appointment but all updates say "geen budget" → concerning). Monday updates are MORE important than the raw conversion %.
- **quality.patterns** should cite the SPECIFIC ad name / UTM and a count or quote from the updates. 2-4 bullets max. This is the most useful part — make every bullet a concrete observation.

**Both sections:**
- Headlines must include numbers or specific entities. No vague statements like "leads are okay".
- Skip "patterns" arrays entirely if there are no meaningful patterns to cite.

### Insights (optimisation proposal) rules
A campaign manager reads this for 100 clients. Be extremely concise. Two scannable lines per insight: what's wrong + what to do. No fluff, no filler, no repeating numbers from the title.

Return 2-4 insights max, only the highest-impact ones. Skip "everything looks fine" insights.

## Important rules
- All currency in EUR (€), dot as decimal separator
- Write in English
- Title = observation with numbers. Action = specific fix. Detail = optional why/context.
- Reference specific marketing angles and ad names when relevant
- Dynamic ads (name contains "Dynamic"/"DYN") have multiple variants — don't flag low ad count
- Consider board type: onboarding clients need different advice than active clients

## CRITICAL — Lead feedback from Monday updates is your most important signal
The "Lead Feedback from Monday Updates" section contains qualitative notes from the account manager / appointment setter about each lead, grouped by ad UTM. This is the ground truth on lead quality — use it as the primary lens for optimization.

You MUST:
- For every ad/UTM with feedback, scan the updates for recurring negative patterns: "geen budget", "niet geïnteresseerd", "verkeerde doelgroep", "geen beslisser", "niet gekwalificeerd", "te duur", no-shows, etc.
- Match ad UTM → ad name → ad performance (CTR, CPC, spend) to identify the SPECIFIC ad that brings bad leads. Name it.
- An ad with low CPL but bad feedback is a LOSER (cheap unqualified leads), not a winner. Pause it or rework the targeting/copy.
- An ad with high CPL but strong feedback (qualified leads, good budget fit, deals) is a WINNER — iterate on it (see below).
- Conversely, scan for positive patterns: "goede lead", "afspraak ingeplant", "interesse", "deal" — those ads should be iterated on.
- Always cite the specific UTM and 1-2 example feedback snippets in the detail field. Don't generalize.

## CRITICAL — How to handle winning ads
When an ad performs well (low CPL + good lead feedback, OR strong CTR + qualified leads), NEVER recommend "keep it running" — that is passive and useless advice. Winners decay due to ad fatigue. The right move is ALWAYS to iterate:
- Recommend creating new iterations / variations of the winning creative for the next refresh
- Same angle, hook, visual style, or AI avatar talking-head — but with fresh executions (new copy variants, new B-roll, new CTAs, new openers)
- The goal is to push more creatives IN THIS WINNING DIRECTION to maintain low CPL and prevent fatigue
- Be specific: "Iterate on [ad name] — same [hook/angle/format], 3-5 new variants for next refresh"

## CRITICAL — Rocket Leads budget reality
- Clients have FIXED, LIMITED ad budgets — typically €1,000–€3,000/month total. This is their ceiling.
- Clients almost NEVER scale budget. Budget is not a flexible lever.
- DO NOT recommend "scale budget", "increase spend", "scale this ad set", "scale up", or any variation.
- The lever is ALWAYS: better creatives, iterations on winners, new angles, refined targeting, better landing pages, improved follow-up — NOT more spend.
- The only time budget can shift is REALLOCATION between ad sets within the same fixed total — never net new spend.

## CRITICAL — Learn from past feedback for this client
The "Past feedback history" section in the user prompt shows previous insights and how the campaign manager handled them:
- **DONE** = the manager actioned this. The advice was good and useful — generate similar high-quality recommendations.
- **LATER** = good advice but wrong timing. The manager will revisit it; don't repeat it now.
- **SKIP** = bad or irrelevant advice. The manager actively rejected it. NEVER generate the same kind of recommendation again. If multiple SKIPs share a pattern (e.g. always rejecting "test new audience" suggestions), avoid that pattern entirely for this client.

Use this history as the most personalized signal you have about what works for THIS specific client. A pattern of SKIPs is a stronger negative signal than any framework rule.

## Rocket Leads Campaign Framework
${campaignsKnowledge.slice(0, 3000)}

## Rocket Leads Process
${processKnowledge.slice(0, 2000)}`

  const userPrompt = `## Client: ${input.clientName}
Board type: ${input.boardType}
Has CRM data: ${input.hasCrm}

## KPI Data

### Last 7 days
${input.kpis7d ? JSON.stringify(input.kpis7d, null, 2) : "No data"}

### Last 14 days
${input.kpis14d ? JSON.stringify(input.kpis14d, null, 2) : "No data"}

### Last 30 days
${input.kpis30d ? JSON.stringify(input.kpis30d, null, 2) : "No data"}

## Meta Ad Details (last 30 days)
${input.adDetails && input.adDetails.length > 0
    ? input.adDetails.map((ad) =>
        `- **${ad.adName}** (${ad.creativeType}) | Ad set: ${ad.adsetName}\n  Spend: €${ad.spend.toFixed(2)} | Impressions: ${ad.impressions} | Clicks: ${ad.clicks} | CTR: ${ad.ctr.toFixed(2)}% | CPC: €${ad.cpc.toFixed(2)}\n  Ad copy: "${ad.body.slice(0, 200)}${ad.body.length > 200 ? "…" : ""}"`
      ).join("\n\n")
    : "No ad details available."}

## Lead Feedback from Monday Updates (qualitative data from client/appointment setters)
${input.leadFeedback && input.leadFeedback.length > 0
    ? input.leadFeedback.map((fb) =>
        `### Ad/UTM: ${fb.utm} (${fb.totalLeads} total leads)\n${fb.updates.slice(0, 10).map((u) => `- [${u.leadStatus}] "${u.text.slice(0, 150)}${u.text.length > 150 ? "…" : ""}"`).join("\n")}`
      ).join("\n\n")
    : "No lead feedback available."}

## Client Knowledge Base
${knowledgeContext || "No client-specific knowledge available yet. Generate insights based on KPI data only."}

## Past feedback history (manager verdicts on previous proposals)
${feedbackHistoryText || "No feedback history yet."}

---

Generate the analysis. Return ONLY the JSON object (with leadAnalysis + insights), no markdown wrapping.`

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  })

  const text = message.content[0].type === "text" ? message.content[0].text : ""

  // The AI returns a JSON object: { leadAnalysis: {...}, insights: [...] }
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error("Failed to parse AI response (no JSON object found)")
  }

  let parsed: {
    leadAnalysis?: LeadAnalysis
    insights?: Array<{
      type: "positive" | "warning" | "critical" | "action"
      title: string
      action?: string
      detail?: string
    }>
  }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (e) {
    throw new Error(`Failed to parse AI response JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  const rawInsights = parsed.insights ?? []
  const leadAnalysis = parsed.leadAnalysis ?? null

  const fingerprinted: RawInsight[] = await Promise.all(
    rawInsights.map(async (i) => ({
      ...i,
      fingerprint: await fingerprintInsight({ type: i.type, title: i.title }),
    })),
  )

  const generatedAt = new Date().toISOString()
  const cachePayload: CachedProposal = {
    insights: fingerprinted,
    leadAnalysis,
    hasKnowledge: !!knowledgeContext,
    generatedAt,
  }
  void writeCache(proposalCacheKey(mondayItemId), cachePayload)

  const insights = fingerprinted.filter((i) => !activeFingerprints.has(i.fingerprint!))

  return {
    insights,
    leadAnalysis,
    hasKnowledge: !!knowledgeContext,
    generatedAt,
    fromCache: false,
  }
}
