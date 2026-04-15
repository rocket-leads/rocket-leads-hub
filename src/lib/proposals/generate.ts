import { createAdminClient } from "@/lib/supabase/server"
import { readCache, writeCache } from "@/lib/cache"
import Anthropic from "@anthropic-ai/sdk"
import { readFile } from "fs/promises"
import { join } from "path"

// AI proposals are cached for 24h. The first viewer of the day for a given
// client (or the daily cron) populates the cache; everyone else hits it.
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000

const anthropic = new Anthropic()

export type ProposalCategory = "creative" | "pause" | "angle" | "funnel" | "other"

export type RawInsight = {
  category: ProposalCategory
  title: string
  detail?: string
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
  proposals: RawInsight[]
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
  proposals: RawInsight[]
  leadAnalysis: LeadAnalysis | null
  hasKnowledge: boolean
  generatedAt: string
  fromCache: boolean
}

export function proposalCacheKey(mondayItemId: string) {
  return `client_proposal:${mondayItemId}`
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

  // Cache hit path
  if (!force) {
    const cached = await readCache<CachedProposal>(proposalCacheKey(mondayItemId), PROPOSAL_TTL_MS)
    if (cached) {
      return {
        proposals: cached.proposals,
        leadAnalysis: cached.leadAnalysis ?? null,
        hasKnowledge: cached.hasKnowledge,
        generatedAt: cached.generatedAt,
        fromCache: true,
      }
    }
  }

  // Cache miss / forced regen — load knowledge, build prompt, call Anthropic
  let knowledgeContext = ""

  if (client) {
    const knowledgeRes = await supabase
      .from("client_knowledge")
      .select("title, content, source")
      .eq("client_id", client.id)

    if (knowledgeRes.data && knowledgeRes.data.length > 0) {
      knowledgeContext = knowledgeRes.data
        .map((k) => `### ${k.title} (source: ${k.source})\n${k.content}`)
        .join("\n\n---\n\n")
    }
  }

  const [campaignsKnowledge, processKnowledge] = await Promise.all([
    loadKnowledgeFile("campaigns.md"),
    loadKnowledgeFile("process.md"),
  ])

  const systemPrompt = `You are a senior performance marketing strategist at Rocket Leads, a Dutch lead generation agency. You produce two things:

1. **Lead Analysis** — what is happening right now (observations only, no action items)
2. **Optimisation Proposals** — concrete, specific actions a campaign manager can execute immediately

These two sections must NEVER overlap. The Lead Analysis is the diagnosis. The Proposals are the prescription.

## Output format
Return a SINGLE JSON OBJECT with this exact shape:

{
  "leadAnalysis": {
    "quantity": {
      "verdict": "good" | "neutral" | "concerning",
      "headline": "1-line summary with key numbers (max 80 chars)",
      "detail": "1-2 sentences explaining the trend vs baseline (7d vs 14d vs 30d)",
      "patterns": ["optional bullet citing specific ad name + metric", "..."]
    },
    "quality": {
      "verdict": "good" | "neutral" | "concerning",
      "headline": "1-line summary of lead quality (max 80 chars)",
      "detail": "1-2 sentences about conversion + Monday update patterns",
      "patterns": ["Photo 2 | Pricelist: 5/8 leads said 'geen budget'", "..."]
    }
  },
  "proposals": [
    {
      "category": "creative" | "pause" | "angle" | "funnel" | "other",
      "title": "Concrete action the CM must do — reference specific ad names, UTMs, or funnel elements (max 100 chars)",
      "detail": "1-2 sentences with DATA backing: cite actual numbers (leads, appointments, CPL, CTR, spend, timeframe). Example: '14d data: 12 leads, 6 appointments (50% conversion). This hook converts effectively — create variants with same angle, fresh execution.'"
    }
  ]
}

### Proposal categories
- **"creative"** = create new ad variants, refresh creatives, iterate on a winner. Examples: "Create 3-5 new variants of [ad name]", "Refresh creative on [ad name] — ad fatigue"
- **"pause"** = pause or turn off specific ads. Examples: "Pause [ad name] — €120 spent, 0 leads"
- **"angle"** = test a new marketing angle or direction. Examples: "Test subsidie-angle for next refresh", "Try different ICP targeting"
- **"funnel"** = change the funnel: leadform questions, landing page, follow-up sequence. Examples: "Add budget question to leadform", "Switch from leadform to landing page"
- **"other"** = anything that doesn't fit the above (reallocation, targeting changes, etc.)

## Lead Analysis rules

**Quantity = COST EFFICIENCY, not volume.**
- NEVER reference raw lead counts or volume changes — those are a function of ad budget.
- The ONLY metrics that matter: CPL (cost per lead) and CPA (cost per appointment).
- Compare current CPL/CPA (7d) against 14d and 30d baselines.
- ±25% change is normal Meta noise. Only flag changes ≥25%.
- quantity.headline must lead with CPL/CPA numbers, not lead counts.

**Quality = Monday update sentiment + conversion data.**
- quality.verdict is primarily based on Monday update sentiment per UTM.
- quality.patterns should cite SPECIFIC ad name / UTM with counts or quotes from updates.

**Lead Analysis patterns should surface observations like:**
- "Creative fatigue on [ad name] — top spender (€X, 30d) with CTR declining from X% to Y%"
- "[Ad name] via UTM [X]: 5/8 leads said 'geen budget'"
- "[Ad name] is the 30d winner: lowest CPL at €X with positive feedback"

## Optimisation Proposals rules

**CRITICAL — Proposals are CONCRETE ACTIONS, not observations.**
A campaign manager should be able to read each proposal and know EXACTLY what to do, without any additional context.

**Every proposal MUST reference specific entities:**
- Which ad(s) to pause → by name, with spend + leads data
- Which ad(s) to iterate on → by name, explaining WHY (winner based on what metric/feedback)
- Which creative direction to take → "same hook/angle as [ad name], 3-5 new variants"
- Which funnel element to change → "add budget qualification question to leadform" or "switch from leadform to landing page"

**Types of valid proposals:**
1. **Pause specific ads (category: "pause"):** "Pause [ad name] — €X spent, 0 leads in 7d" or "Pause [ad name] — cheap leads but 4/6 'niet geïnteresseerd'"
2. **Iterate on winners (category: "creative"):** "Create 3-5 new variants of [ad name] — winning hook with €X CPL over 30d"
3. **Refresh fatigued ads (category: "creative"):** "Refresh [ad name] — top spender (€X/30d) but CTR dropped from X% to Y%"
4. **Funnel changes (category: "funnel"):** "Add budget question to leadform — 40% of leads via [UTM] have no budget"
5. **New angle (category: "angle"):** "Test [specific angle] for next refresh — current [hook type] exhausted across 3 creatives"
6. **Reallocate budget (category: "other"):** "Shift budget from [ad X] to [ad Y] — Y has 3x better CPL"

**Detail field MUST include supporting data:**
- Always cite the actual numbers: "14d: 8 leads, 4 appointments (50% rate). 30d: €280 spend, €35 CPL."
- For winners: cite the timeframe, leads, appointments/deals, CPL
- For losers: cite spend vs leads, negative feedback quotes
- For creative fatigue: cite CTR trend with actual numbers and timeframe

**NEVER generate:**
- Vague proposals like "pause underperforming ads" (WHICH ads?)
- "Test new creatives" without saying what direction
- "Improve lead quality" without saying HOW
- Anything that restates the Lead Analysis without adding an action
- Budget increase recommendations (clients have fixed €1k-3k/month budgets)
- "Keep running" or "maintain current approach" — winners decay, always iterate

Return 2-4 proposals max (NEVER more than 4). Each one must be executable without further research.

## CRITICAL — Time awareness for client context
Client knowledge base entries and Monday updates may contain information from months ago. Apply these time rules:
- **Client REQUESTS (e.g. "client wants X direction", "client asked for Y"):** Only act on requests from the LAST 30 DAYS. Older requests are stale — a client's priorities change. If you reference an older request, explicitly note the date and that it may no longer be current.
- **General insights about lead quality, ICP, market dynamics:** Valid within 90 days. Older than that, treat as background context only.
- **Performance data and KPIs:** Only use the data from the KPI sections (7d/14d/30d). Never cite old performance numbers from knowledge base entries.
- **When citing any context from knowledge/updates, ALWAYS include the date** so the CM can judge recency. Say "per April 2 update:" not just "client mentioned".

## Data priority
1. **Ad-level performance data** — which specific ads are spending, performing, or underperforming
2. **Monday update feedback per UTM** — ground truth on lead quality per ad
3. **KPI trends** (7d vs 14d vs 30d) — supporting context for cost efficiency

## Monday update feedback
Scan updates for patterns per UTM:
- Negative: "geen budget", "niet geïnteresseerd", "verkeerde doelgroep", "geen beslisser", "te duur", no-shows
- Positive: "goede lead", "afspraak ingeplant", "interesse", "deal"
- Match UTM → ad name → performance to identify which specific ad brings good/bad leads

## Rocket Leads budget reality
- Fixed budgets: €1,000–€3,000/month. NEVER recommend more spend.
- Lever is ALWAYS: better creatives, new angles, funnel changes — NOT more budget.
- Budget can only be REALLOCATED within the same total.

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
${knowledgeContext || "No client-specific knowledge available yet. Generate proposals based on KPI + ad data only."}

---

Generate the analysis and proposals. Return ONLY the JSON object (with leadAnalysis + proposals), no markdown wrapping.`

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
    proposals?: Array<{
      category?: string
      title: string
      detail?: string
    }>
  }
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (e) {
    throw new Error(`Failed to parse AI response JSON: ${e instanceof Error ? e.message : String(e)}`)
  }

  const validCategories = new Set(["creative", "pause", "angle", "funnel", "other"])
  const proposals: RawInsight[] = (parsed.proposals ?? []).slice(0, 4).map((p) => ({
    category: (validCategories.has(p.category ?? "") ? p.category : "other") as ProposalCategory,
    title: p.title,
    detail: p.detail,
  }))
  const leadAnalysis = parsed.leadAnalysis ?? null

  const generatedAt = new Date().toISOString()
  const cachePayload: CachedProposal = {
    proposals,
    leadAnalysis,
    hasKnowledge: !!knowledgeContext,
    generatedAt,
  }
  void writeCache(proposalCacheKey(mondayItemId), cachePayload)

  return {
    proposals,
    leadAnalysis,
    hasKnowledge: !!knowledgeContext,
    generatedAt,
    fromCache: false,
  }
}
