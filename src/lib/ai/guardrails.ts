/**
 * Shared AI guardrails,single source of truth for the rules every Hub
 * AI prompt has to follow. Today the rules live duplicated across 5+
 * system prompts (watchlist-summaries, narrative, optimization-proposal,
 * ai-optimization-proposal, lead-feedback, Pedro chains) and drift over
 * time. When that drift produces a hallucinated "0 appointments" or a
 * bare number with no time-window label, we add another bullet to one of
 * the prompts and hope the others catch up.
 *
 * This module gives every AI caller two things:
 *   1. `AI_GUARDRAILS_PROMPT`,the canonical rules block to splice into
 *      a system prompt. Includes the Roy-flagged rules: time-window labels
 *      mandatory, data-availability awareness, Signal Bar (no padding /
 *      duplicates / vague references), CPA off-limits as cost driver.
 *   2. `validateAiOutput()`,programmatic post-validation. Detects bare
 *      numbers without window labels, prohibited "0 appointments" claims
 *      when CRM is missing, and CPA-as-cost-driver phrasing. Returns
 *      a list of violations so callers can either reject the output and
 *      regenerate, or log + soften the violation in production.
 *
 * The point: prompt-engineering alone has failed (the rules drift). We
 * keep the prompt rules but ALSO check the output for compliance, so a
 * regression in the model can't silently leak through.
 *
 * Wave 2 of the foundation pass. Pre-Pedro-unification, this module is
 * the place every NEW AI surface should plug into. Once Pedro becomes
 * the single AI hub (Sessie 3), this file is its prompt-and-validation
 * core.
 */

// ─── Canonical prompt block ──────────────────────────────────────────────

export const AI_GUARDRAILS_PROMPT = `## CRITICAL,TIME WINDOW LABELS ARE MANDATORY ON EVERY NUMBER
The KPI columns the user sees on screen are LAST 7 DAYS. Other inputs span different windows:
- KPIs block = last 7d (and 7d-vs-prev-7d % deltas)
- RECENT WINDOW block = last 1d / 2d / 3d
- MONDAY CRM block = lead status counts ALL-TIME, recent update texts last 14d
- TRENGO CONVERSATIONS block = last 14d
- Per-ad performance block = last 30d (unless specified)

Every numeric claim in your output MUST include its window inline, e.g. "25 leads (all-time), 0 appts (all-time)" or "8 'no budget' replies (14d)" or "CPL up 80%,€38 (7d) vs €23 (prev 7d)". Never write a bare number.

If you can't tell which window a number came from, do not use that number,pick a different angle.

## CRITICAL,KNOW WHAT DATA YOU HAVE BEFORE YOU WRITE ANYTHING
Each client comes with a "DATA AVAILABILITY" line. Read it first.

When Monday CRM = NOT CONNECTED:
- The KPI block will show \`appts UNKNOWN\`. Never write any of these:
  - "0 appointments" / "no appointments" / "zero appts"
  - "leads aren't converting to appointments"
  - any conversion-rate claim that uses appointments
- Also do NOT write claims about lead quality / lead sentiment,that lives in Monday updates which you don't have.
- Focus on Meta-trackable angles only: CPL trend, ad-set fatigue, creative variation depth, CTR decay, frequency.

When Monday CRM = CONNECTED:
- You can use leads and Monday update sentiment (with window labels per above).
- Appointment counts may be referenced descriptively but never as a CPA cost driver.

## CRITICAL,CPA / COST-PER-APPOINTMENT IS NOT A SIGNAL DRIVER RIGHT NOW
Appointment data is too sparse to support reliable cost-per-appointment conclusions. You MUST NOT write any of:
- "CPA up X%" / "CPA rising" / "CPA dropped"
- "high cost per appointment" / "appointment cost spiking"
- Any week-over-week comparison of appointment cost
- Any prescriptive logic that uses CPA as the driver

Appointment counts are still informational context. Reference them descriptively only ("10 appts (7d)").

## CRITICAL,RECENT WINDOW BEATS 7D WHEN THEY DIVERGE
We optimise daily. A 7d CPL spike that has already recovered in the last 1-3 days is no longer urgent,and a fresh spike yesterday is invisible in a 7d average. The data block contains a "RECENT WINDOW" line with CPL from the shortest trustworthy window (1d → 2d → 3d, requires ≥2 leads).

- RECOVERED (recent CPL ≤1.25× prev-7d baseline while 7d still shows a spike) → treat as "monitoring", not urgent.
- FRESH SPIKE (recent CPL ≥1.5× prev-7d baseline while 7d still calm) → act on the recent signal, reference the recent CPL not the 7d.
- In line with 7d trend → use the 7d framing.

If "RECENT WINDOW: insufficient leads…" is shown, you have no recent signal,stick to 7d framing without speculation.

## SIGNAL BAR,NO PADDING IN GENERATED LISTS
For lists of bullets / activity summaries / proposals, every bullet must clear the bar. Skip:
- Duplicates of what's already in the visible Insight column.
- Bare counts without a noemer ("11 leads marked X",needs ratio: "11/15 (73%, 14d)").
- Vague references with no concrete decision ("ongoing video timeline discussion",expand or skip).

Max 3 bullets. Zero bullets is a valid answer when there's nothing concrete to say,output exactly: \`- No notable activity in the last 14d.\`

## BUDGET REALITY
Rocket Leads clients have FIXED budgets (€1k–3k/month). You MUST NOT recommend:
- "Scale budget by X%" / "Increase spend"
- "Add more budget to capture more traffic"
- "Keep running this winner",winners decay; iterate, don't sit.

Recommend instead: iterate on winning creatives (3-5 new variants same hook), pause underperformers, test new angles within fixed budget, reallocate from underperformer to winner.

## FORMAT
- Be specific: name ads/UTMs/funnel elements where possible.
- Every number gets a window label in parentheses: (7d), (14d), (30d), (all-time), (last 2d), (prev 7d).
- Direct, no fluff.
- Output language is set per-call via the LANGUAGE directive in the request, respect it strictly.

## NEVER USE EM-DASHES OR EN-DASHES
Em-dashes (—) and en-dashes (–) are the most-recognised AI-tell in written output. They make every sentence read as machine-generated and undermine trust in the message. Do NOT use them, ever.
- If you want to split a sentence, use a COMMA.
- If two ideas don't fit in one sentence, split into TWO sentences.
- A regular ASCII hyphen INSIDE a compound word is fine (no-budget, high-ticket).
- A bare hyphen between spaces ( - ) is NOT a substitute. Also avoid it. Use a comma.
- Output is post-sanitised programmatically as a backstop. The prompt is the first line of defence: do not produce these characters at all.`

/**
 * Append-on instruction the registry uses to enforce the workspace
 * AI locale on every Pedro generation. Spliced after the canonical
 * AI_GUARDRAILS_PROMPT so the language directive is the LAST thing the
 * system prompt says,models tend to weight late instructions higher
 * for output formatting.
 *
 * Defaults to Dutch (the team's working language) when called without
 * an explicit locale.
 */
export function aiLanguageDirective(locale: "nl" | "en"): string {
  if (locale === "nl") {
    return `\n\n## LANGUAGE\nWrite the entire output in Dutch (Nederlands). All sentences, all labels you generate, all words,Dutch. Window labels stay as-is ((7d), (14d), (last 2d), etc) since they are abbreviations, not English words. Brand terms (Watch List, KPI, CPL, CPA, ROAS, MRR) stay as-is. Don't translate ad names, UTM strings, client names, or quoted text from CRM updates.`
  }
  return `\n\n## LANGUAGE\nWrite the entire output in English. Brand terms and abbreviations stay as-is. Don't translate ad names, UTM strings, client names, or quoted text from CRM updates.`
}

// ─── AI-tell sanitiser ───────────────────────────────────────────────────

/**
 * Strip the dead-giveaway "AI written this" markers from generated text.
 * Em-dashes (—) and en-dashes (–) are the strongest signal; ASCII " - " as a
 * sentence-splitter is the runner-up. All three get converted to a comma so
 * the prose reads like a human typed it.
 *
 * What this DOES NOT touch:
 *   - Hyphens inside compound words (`no-budget`, `high-ticket`, `op-de-man`)
 *    ,those have no surrounding spaces so the regex won't match them.
 *   - Bullet-list dashes at the START of a line (`- item`, `• item`),we
 *     anchor on dashes flanked by word/punctuation chars, not line-leading.
 *   - Existing commas, full stops, or other natural punctuation.
 *
 * Safe to run on any string, idempotent. Designed to be a final backstop on
 * top of the prompt rule,the prompt is the first line of defence, this is
 * the seatbelt.
 */
export function stripAiTells(text: string): string {
  if (!text) return text
  return (
    text
      // Em-dash and en-dash with optional surrounding spaces → ", "
      // The (?<=\S)…(?=\S) lookarounds ensure we only hit dashes BETWEEN words,
      // never at the start of a list item ("- item") or as a standalone line.
      .replace(/(?<=\S)\s*[—–]\s*(?=\S)/g, ", ")
      // ASCII " - " as a sentence splitter (less common but same AI tell).
      // Requires a space on BOTH sides,leaves compound-word hyphens alone.
      .replace(/(?<=\S) - (?=\S)/g, ", ")
      // Double-hyphen " -- " is another model habit, same fix.
      .replace(/(?<=\S)\s*--\s*(?=\S)/g, ", ")
      // Collapse "double commas" that can appear when the model wrote ", —"
      // or similar combinations we just hit twice.
      .replace(/,\s*,/g, ",")
  )
}

// ─── Programmatic post-validation ────────────────────────────────────────

export type GuardrailViolation = {
  /** Stable identifier so callers can filter / log specific rule classes. */
  rule:
    | "missing_window_label"
    | "claims_zero_appts_when_crm_missing"
    | "cpa_as_cost_driver"
    | "budget_increase_recommended"
    | "winner_keep_running"
    | "em_dash_used"
  /** The exact slice of text that tripped the rule,useful for logs. */
  excerpt: string
  /** Plain-English summary the developer / QA reviewer can act on. */
  message: string
}

export type ValidationContext = {
  /** True when Monday CRM is connected for this subject (client / window).
   *  When false, claims about appointments or lead quality are forbidden. */
  mondayCrmConnected: boolean
}

const WINDOW_LABEL_RE =
  /\((?:all-time|7d|14d|30d|prev[\s-]?7d|last\s+\d+d|\d+d|today|yesterday)\)/i

/**
 * Find numeric claims that don't have a window label nearby. We focus on
 * the patterns that have actually shipped bare in production: counts ("8
 * no-budget replies"), percentages ("up 60%"), and currency ("€38 CPL").
 *
 * Heuristic, not perfect,false positives on prose like "5 ad sets" are
 * acceptable; the cost is one extra label, the cost of a real miss is
 * Roy losing trust in the dashboard.
 */
function findBareNumbers(text: string): Array<{ excerpt: string; index: number }> {
  const out: Array<{ excerpt: string; index: number }> = []

  // Pattern 1,currency amounts: €38, €1,250, €38.50
  const currency = /€\s?[\d.,]+(?:[kKmM])?/g
  // Pattern 2,percentages: 60%, +60%, 60.5%
  const percent = /[+-]?\d+(?:\.\d+)?%/g
  // Pattern 3,counts before keyword: "8 leads", "11 replies", "5 calls",
  // "3 appts". Tight set so prose like "we have 5 minutes" doesn't trip.
  const counts =
    /\b\d+(?:\.\d+)?\s+(?:leads?|replies?|calls?|appts?|appointments?|deals?|conversions?|tickets?)\b/gi

  for (const re of [currency, percent, counts]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const start = m.index
      const end = start + m[0].length
      // Look ±60 chars around the match for a window label.
      const window = text.slice(Math.max(0, start - 60), Math.min(text.length, end + 60))
      if (!WINDOW_LABEL_RE.test(window)) {
        out.push({ excerpt: m[0], index: start })
      }
    }
  }
  return out
}

/**
 * Run the canonical rules over a generated AI output. Returns violations
 * (empty array when clean). Designed to be called BEFORE the output is
 * persisted or shown to the user,caller decides whether to retry,
 * soften, or log.
 *
 * Pure function,no I/O,so it's testable and cheap to call on every
 * AI response without affecting latency budgets.
 */
export function validateAiOutput(
  text: string,
  ctx: ValidationContext,
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = []

  // ─ Bare numbers ─
  for (const hit of findBareNumbers(text)) {
    violations.push({
      rule: "missing_window_label",
      excerpt: hit.excerpt,
      message: `Number "${hit.excerpt}" has no time-window label nearby (e.g. (7d), (14d), (all-time)).`,
    })
  }

  // ─ Zero-appts claim when CRM is missing ─
  if (!ctx.mondayCrmConnected) {
    const zeroAppts =
      /\b(?:0|no|zero)\s+(?:appointments?|appts?|booked\s+calls?)\b/gi
    let m: RegExpExecArray | null
    while ((m = zeroAppts.exec(text)) !== null) {
      violations.push({
        rule: "claims_zero_appts_when_crm_missing",
        excerpt: m[0],
        message: `Claims "${m[0]}" but Monday CRM is not connected,appointments are UNKNOWN, not zero.`,
      })
    }
  }

  // ─ CPA used as cost driver ─
  // Match prescriptive CPA phrasing: "CPA up", "high cost per appointment",
  // "appointment cost spiking", "CPA rising/dropped/elevated", etc.
  const cpaDriver =
    /\b(?:CPA\s+(?:up|down|rising|dropped|elevated|high|low|spik|surge)|(?:high|low|elevated|rising)\s+(?:cost\s+per\s+appointment|CPA)|appointment\s+cost\s+(?:spik|surge|rising|elevated))/gi
  let cpaMatch: RegExpExecArray | null
  while ((cpaMatch = cpaDriver.exec(text)) !== null) {
    violations.push({
      rule: "cpa_as_cost_driver",
      excerpt: cpaMatch[0],
      message: `Uses CPA as a cost-trend driver,appointment data is too sparse, see guardrail.`,
    })
  }

  // ─ Budget increase / "keep running" recommendations ─
  const budgetUp =
    /\b(?:scale\s+(?:up\s+)?budget|increase\s+(?:the\s+)?(?:budget|spend|ad\s+spend)|raise\s+budget|add\s+more\s+budget)/gi
  let bm: RegExpExecArray | null
  while ((bm = budgetUp.exec(text)) !== null) {
    violations.push({
      rule: "budget_increase_recommended",
      excerpt: bm[0],
      message: `Recommends a budget increase,Rocket Leads clients run on fixed budgets.`,
    })
  }

  const keepRunning = /\bkeep\s+(?:running|this\s+winner)|let\s+it\s+ride\b/gi
  let km: RegExpExecArray | null
  while ((km = keepRunning.exec(text)) !== null) {
    violations.push({
      rule: "winner_keep_running",
      excerpt: km[0],
      message: `"Keep running" wins decay, recommend iterating instead.`,
    })
  }

  // ─ Em-dash / en-dash AI tell ─
  // Anchored on dashes BETWEEN words so list bullets and standalone dashes
  // don't trip; matches the same shape `stripAiTells` cleans up. Logged
  // separately so we can see how often the model still emits them despite
  // the prompt rule.
  const emDash = /(?<=\S)\s*[—–]\s*(?=\S)/g
  let dm: RegExpExecArray | null
  while ((dm = emDash.exec(text)) !== null) {
    violations.push({
      rule: "em_dash_used",
      excerpt: dm[0],
      message: `Used an em-dash / en-dash, replace with a comma. (Sanitiser auto-strips, but the prompt should not produce them.)`,
    })
  }

  return violations
}

/**
 * Convenience wrapper: assert the output is clean, throw with a summarised
 * error if not. Use in places where a violation should hard-fail (cron jobs,
 * tests). Production code paths usually want the soft `validateAiOutput`
 * directly so they can log + render rather than crash.
 */
export function assertAiOutputClean(text: string, ctx: ValidationContext): void {
  const violations = validateAiOutput(text, ctx)
  if (violations.length === 0) return
  const summary = violations
    .slice(0, 5)
    .map((v) => `  [${v.rule}] ${v.message}`)
    .join("\n")
  const more = violations.length > 5 ? `\n  ...and ${violations.length - 5} more` : ""
  throw new Error(`AI output failed guardrails (${violations.length} violations):\n${summary}${more}`)
}
