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
  /** 1-line note rendered next to the Insight column on each watchlist row. */
  "watchlist_action_note",
] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/** Severity hint for ordering / colour-coding by consumers. */
export type InsightSeverity = "high" | "med" | "low" | "info"
