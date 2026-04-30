import { auth } from "@/lib/auth"
import { readCache, writeCache } from "@/lib/cache"
import Anthropic from "@anthropic-ai/sdk"
import { NextRequest, NextResponse } from "next/server"

const anthropic = new Anthropic()
const NARRATIVE_TTL_MS = 60 * 60 * 1000 // 1h cache per (scope, day)

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

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = (await req.json()) as NarrativeRequest

  const today = new Date().toISOString().slice(0, 10)
  // v3: shape changed to structured insights+proposals — bump so old prose narratives don't get returned.
  const cacheKey = `watchlist_narrative_v3:${body.scope}:${today}`
  const cached = await readCache<WatchlistNarrativeResponse>(cacheKey, NARRATIVE_TTL_MS)
  if (cached) return NextResponse.json(cached)

  // No clients in scope → no work to do.
  const totalActive = body.totals.action + body.totals.watch + body.totals.good
  if (totalActive === 0) {
    void writeCache(cacheKey, EMPTY)
    return NextResponse.json(EMPTY)
  }

  const newToAction = body.clients.filter((c) => c.category === "action" && c.isNewToday)
  const stuckInAction = body.clients
    .filter((c) => c.category === "action" && (c.daysInBucket ?? 0) >= 5)
    .sort((a, b) => (b.daysInBucket ?? 0) - (a.daysInBucket ?? 0))
  const movedToGood = body.clients.filter(
    (c) => c.category === "good" && c.isNewToday && c.prevCategory && c.prevCategory !== "good"
  )

  // Compact data block for the LLM. Insights truncated to keep prompt size sensible.
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

  let result: WatchlistNarrativeResponse = EMPTY
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
- **warning**: noticeable trend that may become critical if untreated. Examples: rising avg CPL across the book, multiple clients showing CPA drift, recurring "no budget" feedback themes.
- **positive**: meaningful improvers with names and what changed. Examples: client recovering into Good after a specific action.

Tag prefix the most-important pattern as "critical", reserve "positive" for genuine wins.

## Proposals — what to surface
2 to 4 numbered actions, ordered by impact. Each is one sentence (≤24 words) describing a CONCRETE step a campaign manager can take today, grounded in the patterns above.
- Reference specific client names where relevant.
- Suggest a SINGLE next step per proposal — not a checklist within a checklist.
- Bias toward creative/angle changes, audience refinements, follow-up audits — not "talk to the team" filler.

## Hard rules
- Every numeric claim gets an inline window label: (today), (5d), (14d), (all-time).
- Insights and proposals must reference patterns or names visible in the data block. Never invent.
- No emoji. No markdown formatting inside the strings (no asterisks, no backticks).
- Output VALID JSON. No trailing commas. No code fences.`,
      messages: [
        {
          role: "user",
          content: `Generate the structured Watch List analysis for the campaign manager.\n\n${factsBlock}\n\nReturn ONLY the JSON object.`,
        },
      ],
    })
    const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : ""
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as Partial<WatchlistNarrativeResponse>
      const insights = Array.isArray(parsed.insights)
        ? parsed.insights.filter(
            (i): i is WatchlistInsight =>
              i != null &&
              typeof i.text === "string" &&
              ["positive", "warning", "critical"].includes(i.type as string)
          )
        : []
      const proposals = Array.isArray(parsed.proposals)
        ? parsed.proposals.filter((p): p is string => typeof p === "string")
        : []
      result = { insights, proposals }
    }
  } catch (e) {
    console.error("Watchlist narrative failed:", e instanceof Error ? e.message : e)
  }

  void writeCache(cacheKey, result)
  return NextResponse.json(result)
}
