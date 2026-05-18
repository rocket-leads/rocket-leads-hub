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
 * Robust parser for `client_pedro` body. Falls back to a plain-text
 * conclusion if the model returned non-JSON — keeps the UI working
 * while a malformed prompt is being fixed.
 */
export function parsePedroBody(body: string | null | undefined): PedroInsightBody | null {
  if (!body) return null
  const trimmed = body.trim()
  if (!trimmed) return null
  // Try strict JSON first
  try {
    const parsed = JSON.parse(trimmed) as Partial<PedroInsightBody>
    if (typeof parsed.conclusion === "string") {
      return {
        conclusion: parsed.conclusion.trim(),
        actions: Array.isArray(parsed.actions)
          ? parsed.actions.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim())
          : [],
      }
    }
  } catch {
    // Fall through to plain-text fallback
  }
  // Plain text fallback: first line/paragraph = conclusion, no actions
  return { conclusion: trimmed, actions: [] }
}
