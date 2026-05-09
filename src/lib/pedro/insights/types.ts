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
  /** 2-3 sentence "what's the current state of this client" summary. Used on
   *  the client detail header, Home action block hover/preview, and as
   *  context-injection for other AI surfaces. Should read like a senior CM's
   *  whisper to an incoming colleague: where the client is, what's working,
   *  what's not. */
  "client_overview",
  /** 1-2 sentence pedro-flavoured optimisation summary. Doesn't replace the
   *  full structured proposals on the client page — that lives in
   *  lib/proposals/generate.ts and stays there. This is the short version,
   *  consumable from the watchlist row, Home, and other surfaces that don't
   *  need the full proposals[] array. */
  "client_optimisation_summary",
  /** 1-2 sentence Pedro verdict on lead quality based on Monday updates +
   *  Trengo conversations. NOT the structured leadAnalysis (that stays in
   *  lib/proposals/generate.ts). This is the short version. */
  "client_lead_quality_summary",
] as const

export type InsightType = (typeof INSIGHT_TYPES)[number]

/** Severity hint for ordering / colour-coding by consumers. */
export type InsightSeverity = "high" | "med" | "low" | "info"
