import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"
import { AI_GUARDRAILS_PROMPT, aiLanguageDirective, validateAiOutput, stripAiTells } from "@/lib/ai/guardrails"
import { getAiLocale } from "@/lib/i18n/server"

/**
 * Watch List portfolio narrative — the "Key Insights" + "Optimisation
 * Proposal" cards at the top of the Watch List, scoped per CM filter.
 *
 * Pre-Pedro-unification: stored in the cache_store under
 * `watchlist_narrative_v3:{scope}:{date}`. Now lives in pedro_insights as
 * a row keyed by:
 *   - monday_item_id = `_portfolio:{scope}` (sentinel — portfolio-level
 *     rows ride alongside per-client rows in the same table; the prefix
 *     keeps them filterable and avoids a schema extension)
 *   - insight_type   = "watchlist_narrative"
 *
 * The body is JSON-stringified `{insights, proposals}`. 1h freshness gate
 * matches the original cache TTL — well-trafficked scopes (All / each
 * CM) regenerate on demand when the row stales out.
 *
 * Splices AI_GUARDRAILS_PROMPT and post-validates output (logs only —
 * structured-JSON output predates the conventions, hard ban would block
 * legitimate output mid-migration).
 */

const anthropic = new Anthropic()
const NARRATIVE_TTL_MS = 60 * 60 * 1000
const PORTFOLIO_INSIGHT_TYPE = "watchlist_narrative"

type ClientLite = {
  id: string
  name: string
  category: "action" | "watch" | "good" | "no-data"
  insight: string
  daysInBucket: number | null
  isNewToday: boolean
  prevCategory: "action" | "watch" | "good" | "no-data" | null
}

type NarrativeRequest = {
  scope: string
  totals: { action: number; watch: number; good: number; noData: number }
  totalsYesterday: { action: number; watch: number; good: number; noData: number }
  clients: ClientLite[]
}

export type WatchlistInsight = {
  type: "positive" | "warning" | "critical"
  text: string
}

export type WatchlistNarrativeResponse = {
  insights: WatchlistInsight[]
  proposals: string[]
}

const EMPTY: WatchlistNarrativeResponse = { insights: [], proposals: [] }

/** Sentinel ID for portfolio-level pedro_insights rows. Keeps them out of
 *  per-client lookups (which never match a `_portfolio:` prefix). */
function portfolioId(scope: string): string {
  return `_portfolio:${scope}`
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as NarrativeRequest
  const supabase = await createAdminClient()
  const subjectId = portfolioId(body.scope)

  // Cache hit path — pedro_insights row younger than 1h.
  const { data: cachedRow } = await supabase
    .from("pedro_insights")
    .select("body, generated_at")
    .eq("monday_item_id", subjectId)
    .eq("insight_type", PORTFOLIO_INSIGHT_TYPE)
    .maybeSingle()

  if (cachedRow?.body) {
    const ageMs = Date.now() - new Date(cachedRow.generated_at).getTime()
    if (ageMs < NARRATIVE_TTL_MS) {
      try {
        const parsed = JSON.parse(cachedRow.body) as WatchlistNarrativeResponse
        return NextResponse.json(parsed)
      } catch {
        // Corrupt row → fall through to regen.
      }
    }
  }

  // No clients in scope → no Anthropic call. Persist the empty shape so
  // subsequent requests for this scope don't re-flap until something
  // changes.
  const totalActive = body.totals.action + body.totals.watch + body.totals.good
  if (totalActive === 0) {
    await persistNarrative(supabase, subjectId, EMPTY, [])
    return NextResponse.json(EMPTY)
  }

  const newToAction = body.clients.filter((c) => c.category === "action" && c.isNewToday)
  const stuckInAction = body.clients
    .filter((c) => c.category === "action" && (c.daysInBucket ?? 0) >= 5)
    .sort((a, b) => (b.daysInBucket ?? 0) - (a.daysInBucket ?? 0))
  const movedToGood = body.clients.filter(
    (c) => c.category === "good" && c.isNewToday && c.prevCategory && c.prevCategory !== "good",
  )

  const factsBlock = [
    `Filter scope: ${body.scope}`,
    `Today: ${body.totals.action} Action, ${body.totals.watch} Watch, ${body.totals.good} Good (no-data: ${body.totals.noData})`,
    `Yesterday: ${body.totalsYesterday.action} Action, ${body.totalsYesterday.watch} Watch, ${body.totalsYesterday.good} Good`,
    "",
    `--- Per-client snapshot (today) ---`,
    body.clients
      .slice(0, 60)
      .map((c) => `[${c.category.toUpperCase()}${c.daysInBucket != null ? ` ${c.daysInBucket}d` : ""}${c.isNewToday ? " NEW" : ""}] ${c.name} — ${c.insight}`)
      .join("\n"),
    "",
    `--- Today's transitions ---`,
    `New to Action (${newToAction.length}): ${newToAction.map((c) => c.name).join(", ") || "none"}`,
    `Stuck in Action ≥5d (${stuckInAction.length}): ${stuckInAction.slice(0, 8).map((c) => `${c.name} (${c.daysInBucket}d)`).join(", ") || "none"}`,
    `Moved into Good today (${movedToGood.length}): ${movedToGood.map((c) => `${c.name} (was ${c.prevCategory})`).join(", ") || "none"}`,
  ].join("\n")

  const aiLocale = await getAiLocale()

  let result: WatchlistNarrativeResponse = EMPTY
  let rawText = ""
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 900,
      system: `You are the Watch List portfolio analyst at Rocket Leads. Produce two structured outputs that surface NEW information beyond what the campaign manager already sees on screen.

## Output schema (return ONLY JSON, no preamble)
{
  "insights": [
    { "type": "critical" | "warning" | "positive", "text": "..." }
  ],
  "proposals": [
    "..."
  ]
}

## What's already visible — DO NOT REPEAT
The user already sees, on the same page:
- A "Health score" KPI card with the % and zone (red <50 / amber 50-74 / green 75+)
- A "Healthy clients" KPI card showing "X of Y healthy"
- A bucket chip bar with totals per category
- A row per client with insight text + AI note + the days-in-bucket pill

So your output MUST NOT contain:
- Score readouts: "Health is at 43%", "Score improved 4pp", "X% of clients healthy"
- Bucket counts: "16 in Action, 5 in Watch", "X clients in Action"
- Per-bucket totals or % statements about the portfolio
- Generic praise ("portfolio is performing well") — useless filler

## Insights — what to surface
3 to 5 entries. Each is one sentence (≤22 words) tagged by severity.
- **critical**: an urgent pattern requiring this-week action. Examples: 5+ clients with CPL spiking >40% sharing a common cause; 3+ clients stuck in Action 5+ days with the same insight pattern; rising no-leads count.
- **warning**: noticeable trend that may become critical if untreated. Examples: rising avg CPL across the book, multiple clients showing "no budget" feedback themes.
- **positive**: meaningful improvers with names and what changed. Examples: client recovering into Good after a specific action.

Tag prefix the most-important pattern as "critical", reserve "positive" for genuine wins.

## Proposals — what to surface
2 to 4 numbered actions, ordered by impact. Each is one sentence (≤24 words) describing a CONCRETE step a campaign manager can take today, grounded in the patterns above.
- Reference specific client names where relevant.
- Suggest a SINGLE next step per proposal — not a checklist within a checklist.
- Bias toward creative/angle changes, audience refinements, follow-up audits — not "talk to the team" filler.

## Output rules
- No emoji. No markdown inside the strings (no asterisks, no backticks).
- Output VALID JSON. No trailing commas. No code fences.

${AI_GUARDRAILS_PROMPT}${aiLanguageDirective(aiLocale)}`,
      messages: [
        {
          role: "user",
          content: `Generate the structured Watch List analysis for the campaign manager.\n\n${factsBlock}\n\nReturn ONLY the JSON object.`,
        },
      ],
    })
    rawText = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
    const match = rawText.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Partial<WatchlistNarrativeResponse>
      // Strip AI-tell em-dashes from each rendered string before we persist
      // or return — the prompt rule is the first line of defence, this is
      // the backstop in case the model still emits one through.
      const insights = Array.isArray(parsed.insights)
        ? parsed.insights
            .filter(
              (i): i is WatchlistInsight =>
                i != null &&
                typeof i.text === "string" &&
                ["positive", "warning", "critical"].includes(i.type as string),
            )
            .map((i) => ({ ...i, text: stripAiTells(i.text) }))
        : []
      const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals
            .filter((p): p is string => typeof p === "string")
            .map((p) => stripAiTells(p))
        : []
      result = { insights, proposals }
    }
  } catch (e) {
    console.error("Watchlist narrative failed:", e instanceof Error ? e.message : e)
  }

  // Run guardrails over the raw text (not the parsed JSON, which has the
  // numbers nested) — soft-fail, log only.
  const violations = rawText
    ? validateAiOutput(rawText, { mondayCrmConnected: true })
    : []
  if (violations.length > 0) {
    console.warn(
      `[watchlist-narrative] ${violations.length} guardrail violations for scope ${body.scope}:`,
      violations.map((v) => v.rule).join(", "),
    )
  }

  await persistNarrative(supabase, subjectId, result, violations)
  return NextResponse.json(result)
}

async function persistNarrative(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  subjectId: string,
  result: WatchlistNarrativeResponse,
  violations: ReturnType<typeof validateAiOutput>,
): Promise<void> {
  try {
    await supabase.from("pedro_insights").upsert(
      {
        monday_item_id: subjectId,
        insight_type: PORTFOLIO_INSIGHT_TYPE,
        body: JSON.stringify(result),
        severity: null,
        sources_used: { watchlistNarrative: true },
        guardrail_violations: violations as unknown as Record<string, unknown>[],
        prompt_version: 4, // bumped on the unification migration; old cache_store entries are ignored
        model: "claude-haiku-4-5-20251001",
        generated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + NARRATIVE_TTL_MS).toISOString(),
      },
      { onConflict: "monday_item_id,insight_type" },
    )
  } catch (e) {
    console.error(
      "[watchlist-narrative] pedro_insights upsert failed:",
      e instanceof Error ? e.message : e,
    )
  }
}
