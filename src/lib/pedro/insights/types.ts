/**
 * Insight type taxonomy. Adding a new surface = adding an entry to
 * INSIGHT_TYPES, defining its prompt + model in registry.ts, and the
 * cron + facade endpoints fan out to it without further wiring.
 *
 * Conventions:
 *   - watchlist_*  — surfaces on the Watch List page
 *   - client_*     — surfaces on a specific client page
 *
 * Bumping prompt_version in the registry expires every existing row of
 * that type on the next cron tick — use for prompt changes that should
 * regenerate everywhere.
 */
export const INSIGHT_TYPES = [
  /** The one Pedro insight per client. Body is JSON: `{ conclusion, actions[] }`.
   *  Rendered everywhere AI text used to appear (client detail header, watchlist
   *  row 1-liners, home page action notes) so the user sees a single, consistent
   *  Pedro voice — no contradictions between surfaces. */
  "client_pedro",
] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/** Severity hint for ordering / colour-coding by consumers. */
export type InsightSeverity = "high" | "med" | "low" | "info"

/**
 * Parsed shape of `client_pedro.body`. Stored as JSON text in the
 * `pedro_insights.body` column — consumers parse it on read.
 */
export type PedroInsightBody = {
  /** 1-2 sentence factual update of the current campaign state. */
  conclusion: string
  /** Concrete next-step bullets (3-5 max). Empty array = no actionable
   *  signal right now (e.g. paused campaigns, no recent spend). */
  actions: string[]
}

/**
 * Words / phrases that turn a "client update" into an "internal CM note" or
 * agency-speak. When an action contains any of these the AM looks bad
 * forwarding it to the client, so we drop the bullet on read — even for
 * rows generated under the old prompt version (existing data gets cleaner
 * without waiting for the cron). Patterns are case-insensitive.
 *
 * Keep this in lockstep with the BANNED list in the system prompt
 * (lib/pedro/insights/registry.ts → client_pedro): the prompt is the first
 * line of defence, this is the runtime backstop.
 */
const BANNED_ACTION_PATTERNS: RegExp[] = [
  /\bad[\s-]?sets?\b/i,
  /\bfatigue/i,
  /vermoeidheid/i,
  /\bfrequency\b/i,
  /\bctr\b/i,
  /relevance\s*score/i,
  /audience\s*(?:overlap|saturation)/i,
  /verzadig/i,
  /meta[\s-]?campagne/i,
  /spend[\s-]aanpassing/i,
  /kosten?eﬃciëntie|kosten?efficientie/i,
  /volumeproblemen/i,
  /lead[\s-]quality\s*signal/i,
  /interne\s+(?:inbox|notitie)/i,
  /\bto\s*do\b/i,
  /@[A-Z]\w/, // @Mentions
  /\bcyclus\b/i,
  /\bstem\s+af\s+met\b/i,
  /\bbespreek\s+met\b/i,
  /\bvraag\s+aan\s+\w+\s+(?:over|of)\b/i,
  /\bneem\s+contact\s+op\s+met\b/i,
  /demografie\/interesse/i,
]

/** Capitalised first names of team members we've seen Pedro quote back from
 *  Monday @mentions. The list is small + stable; matching is whole-word so
 *  "danny" inside a longer word doesn't trip. */
const TEAM_FIRST_NAMES = ["Roy", "Stefan", "Danny", "Scott", "Roel"]
const TEAM_NAMES_RE = new RegExp(`\\b(?:${TEAM_FIRST_NAMES.join("|")})\\b`)

/** True when an action looks like internal CM speech rather than a client
 *  message: too long, has agency jargon, mentions a team member by name, or
 *  starts with a CM-imperative verb like "Analyseer" / "Onderzoek" / "Herzie". */
function isInternalAction(action: string): boolean {
  const trimmed = action.trim()
  if (!trimmed) return true
  // Hard length cap. Pedro's worst cases hit 30+ words, the prompt asks for
  // ≤12, we sanitise anything above 18 to leave a small safety buffer.
  const wordCount = trimmed.split(/\s+/).length
  if (wordCount > 18) return true
  for (const re of BANNED_ACTION_PATTERNS) {
    if (re.test(trimmed)) return true
  }
  if (TEAM_NAMES_RE.test(trimmed)) return true
  // CM-imperative openers — these are how the AI talks to itself, not how
  // the AM talks to the client. Drop them; the prompt asks for first-person
  // alternatives ("We testen …" instead of "Analyseer …").
  if (/^(?:Analyseer|Onderzoek|Herzie|Controleer|Optimaliseer|Audit)\b/i.test(trimmed)) {
    return true
  }
  return false
}

/**
 * Robust parser for `client_pedro` body. Falls back to a plain-text
 * conclusion if the model returned non-JSON — keeps the UI working
 * while a malformed prompt is being fixed.
 *
 * Models routinely wrap structured output in markdown code fences (```json
 * {...} ```) or insert a stray "json" language tag even when the prompt
 * explicitly forbids it. We strip those defensively before parsing AND fall
 * back to first-brace / last-brace slicing so a preamble like "Here is the
 * update:\n{...}" still parses cleanly.
 *
 * After parsing, we ALSO run each action through `isInternalAction` and drop
 * the ones that read as internal CM speech. This fires both for legacy v1/v2
 * rows still sitting in pedro_insights AND for any v3 generation that
 * happens to violate the prompt despite the explicit ban list.
 */
export function parsePedroBody(body: string | null | undefined): PedroInsightBody | null {
  if (!body) return null
  const cleaned = unwrapFences(body)
  if (!cleaned) return null

  const tryParse = (s: string): PedroInsightBody | null => {
    try {
      const parsed = JSON.parse(s) as Partial<PedroInsightBody>
      if (typeof parsed.conclusion === "string") {
        const rawActions = Array.isArray(parsed.actions)
          ? parsed.actions
              .filter((a): a is string => typeof a === "string" && a.trim().length > 0)
              .map((a) => a.trim())
          : []
        // Filter out anything that reads as internal CM speech — see the
        // function comment above for the rules. Cap at 3 (the prompt asks
        // for max 3; this enforces it even when the model overshoots).
        const cleanActions = rawActions.filter((a) => !isInternalAction(a)).slice(0, 3)
        return {
          conclusion: parsed.conclusion.trim(),
          actions: cleanActions,
        }
      }
    } catch {
      // fall through
    }
    return null
  }

  // 1. Strict parse of the whole (post-unwrap) string.
  const direct = tryParse(cleaned)
  if (direct) return direct

  // 2. Substring parse — pick from the first `{` through the last `}`. Covers
  //    "Here is the JSON:\n{...}" / leading `json\n{...}` shapes that survived
  //    fence stripping.
  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first >= 0 && last > first) {
    const substrParsed = tryParse(cleaned.slice(first, last + 1))
    if (substrParsed) return substrParsed
  }

  // 3. Last resort — treat as plain prose. Keeps the UI alive while the prompt
  //    is being fixed; the AM sees a (probably ugly) conclusion line but at
  //    least it's not a render failure.
  return { conclusion: cleaned, actions: [] }
}

/** Strip the common AI-output wrappers that break JSON.parse:
 *   - Markdown code fences:  ```json ... ```  or  ``` ... ```
 *   - Leftover language tags after the backticks were stripped: `json\n{...}`
 *   - Stray quotes / backticks at start/end. */
function unwrapFences(raw: string): string {
  let s = raw.trim()
  if (!s) return s
  // Full triple-backtick fence with optional language tag, on one or both sides.
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, "")
  s = s.replace(/\n?```\s*$/, "")
  // Leading language tag without backticks (sanitiser earlier stripped them).
  s = s.replace(/^(?:json|JSON)\s*\n+/, "")
  return s.trim()
}
