import { describe, it, expect } from "vitest"
import {
  validateAiOutput,
  assertAiOutputClean,
  AI_GUARDRAILS_PROMPT,
  stripAiTells,
} from "./guardrails"

/**
 * Guardrails are the *enforcement* side of the AI rules — without these,
 * the rules in the prompt drift across surfaces and Roy ends up with a
 * memory entry per regression. The validator catches the regressions
 * automatically, before the output reaches the user.
 *
 * Tests pin every rule's positive (violation detected) and negative
 * (compliant text passes) case.
 */

const CRM_OK = { mondayCrmConnected: true } as const
const CRM_MISSING = { mondayCrmConnected: false } as const

describe("validateAiOutput — missing window labels", () => {
  it("flags a bare percentage", () => {
    const v = validateAiOutput("CPL up 80% — pause underperformer.", CRM_OK)
    expect(v.some((x) => x.rule === "missing_window_label")).toBe(true)
  })

  it("flags a bare currency amount", () => {
    const v = validateAiOutput("Spend €450 with 3 leads — efficiency dropping.", CRM_OK)
    expect(v.some((x) => x.rule === "missing_window_label")).toBe(true)
  })

  it("flags a bare lead count", () => {
    const v = validateAiOutput("8 leads marked 'no budget' — add qualifier.", CRM_OK)
    expect(v.some((x) => x.rule === "missing_window_label")).toBe(true)
  })

  it("passes when each number has a nearby window label", () => {
    const text =
      "CPL up 80% (7d) vs €23 (prev 7d). 8 'no budget' replies (14d). 25 leads (all-time)."
    const v = validateAiOutput(text, CRM_OK)
    expect(v.filter((x) => x.rule === "missing_window_label")).toEqual([])
  })

  it("FLAGS prose without parens (canonical form requires parens — be strict)", () => {
    // "In the last 7d the spend was €450" reads fine to a human but the
    // canonical format is parens-suffix per number ("€450 (7d)"). We
    // enforce strictness so cross-surface output stays consistent and
    // reviewers can rely on the convention.
    const v = validateAiOutput("In the last 7d the spend was €450 with no real recovery.", CRM_OK)
    expect(v.some((x) => x.rule === "missing_window_label")).toBe(true)
  })

  it("passes when the prefix is 'last Nd'", () => {
    const v = validateAiOutput("CPL recovered to €25 (last 2d) — monitor.", CRM_OK)
    expect(v.filter((x) => x.rule === "missing_window_label")).toEqual([])
  })
})

describe("validateAiOutput — zero appts when CRM missing", () => {
  it("flags '0 appointments' when CRM is not connected", () => {
    const v = validateAiOutput("25 leads (all-time), 0 appointments (all-time) — audience mismatch.", CRM_MISSING)
    expect(v.some((x) => x.rule === "claims_zero_appts_when_crm_missing")).toBe(true)
  })

  it("flags 'no booked calls' when CRM is not connected", () => {
    const v = validateAiOutput("Leads come in (14d) but no booked calls.", CRM_MISSING)
    expect(v.some((x) => x.rule === "claims_zero_appts_when_crm_missing")).toBe(true)
  })

  it("does NOT flag 0-appts language when CRM IS connected", () => {
    const v = validateAiOutput("25 leads (all-time), 0 appointments (all-time) — fix opvolging.", CRM_OK)
    expect(v.some((x) => x.rule === "claims_zero_appts_when_crm_missing")).toBe(false)
  })
})

describe("validateAiOutput — CPA as cost driver", () => {
  it("flags 'CPA up X%'", () => {
    const v = validateAiOutput("CPA up 40% (7d) — pause this ad set.", CRM_OK)
    expect(v.some((x) => x.rule === "cpa_as_cost_driver")).toBe(true)
  })

  it("flags 'high cost per appointment'", () => {
    const v = validateAiOutput("High cost per appointment (7d) — refresh creative.", CRM_OK)
    expect(v.some((x) => x.rule === "cpa_as_cost_driver")).toBe(true)
  })

  it("flags 'appointment cost spiking'", () => {
    const v = validateAiOutput("Appointment cost spiking — investigate.", CRM_OK)
    expect(v.some((x) => x.rule === "cpa_as_cost_driver")).toBe(true)
  })

  it("does NOT flag descriptive appointment counts", () => {
    const v = validateAiOutput("10 appts (7d), conversion path looks healthy.", CRM_OK)
    expect(v.some((x) => x.rule === "cpa_as_cost_driver")).toBe(false)
  })
})

describe("validateAiOutput — budget reality", () => {
  it("flags 'scale budget'", () => {
    const v = validateAiOutput("Scale budget on this winner.", CRM_OK)
    expect(v.some((x) => x.rule === "budget_increase_recommended")).toBe(true)
  })

  it("flags 'increase ad spend'", () => {
    const v = validateAiOutput("Increase ad spend on Photo 2.", CRM_OK)
    expect(v.some((x) => x.rule === "budget_increase_recommended")).toBe(true)
  })

  it("flags 'add more budget'", () => {
    const v = validateAiOutput("Add more budget to capture more traffic.", CRM_OK)
    expect(v.some((x) => x.rule === "budget_increase_recommended")).toBe(true)
  })

  it("does NOT flag 'reallocate budget' (within fixed total)", () => {
    const v = validateAiOutput("Reallocate budget from Photo 4 to Video 2 within the same ad set.", CRM_OK)
    expect(v.some((x) => x.rule === "budget_increase_recommended")).toBe(false)
  })

  it("flags 'keep running' (passive, leads to ad fatigue)", () => {
    const v = validateAiOutput("Keep running this winner — it's converting well.", CRM_OK)
    expect(v.some((x) => x.rule === "winner_keep_running")).toBe(true)
  })

  it("flags 'let it ride'", () => {
    const v = validateAiOutput("Let it ride for another week.", CRM_OK)
    expect(v.some((x) => x.rule === "winner_keep_running")).toBe(true)
  })

  it("does NOT flag 'iterate on the winner'", () => {
    const v = validateAiOutput("Iterate on the winner — 3 new variants same hook.", CRM_OK)
    expect(v.some((x) => x.rule === "winner_keep_running")).toBe(false)
  })
})

describe("assertAiOutputClean", () => {
  it("returns silently when clean", () => {
    expect(() =>
      assertAiOutputClean(
        "Iterate on Photo 2, €25 CPL (7d), 14 leads (30d). 3 new variants same hook.",
        CRM_OK,
      ),
    ).not.toThrow()
  })

  it("throws when there are violations, with rule summary in the message", () => {
    expect(() =>
      assertAiOutputClean("Scale budget on this winner. CPA up 40%.", CRM_OK),
    ).toThrow(/budget_increase_recommended/)
  })
})

describe("AI_GUARDRAILS_PROMPT", () => {
  it("includes the three CRITICAL rule headers a downstream prompt must keep", () => {
    expect(AI_GUARDRAILS_PROMPT).toContain("TIME WINDOW LABELS")
    expect(AI_GUARDRAILS_PROMPT).toContain("KNOW WHAT DATA YOU HAVE")
    expect(AI_GUARDRAILS_PROMPT).toContain("CPA")
  })

  it("explicitly forbids 0-appts claims when CRM is missing", () => {
    expect(AI_GUARDRAILS_PROMPT).toMatch(/0 appointments/i)
    expect(AI_GUARDRAILS_PROMPT).toMatch(/no appointments/i)
  })

  it("includes the SIGNAL BAR rule (no padding lists)", () => {
    expect(AI_GUARDRAILS_PROMPT).toContain("SIGNAL BAR")
  })

  it("forbids budget-increase recommendations", () => {
    expect(AI_GUARDRAILS_PROMPT).toMatch(/budget/i)
    expect(AI_GUARDRAILS_PROMPT).toMatch(/fixed/i)
  })

  it("includes the em-dash / en-dash ban", () => {
    expect(AI_GUARDRAILS_PROMPT).toMatch(/NEVER USE EM-DASHES/)
    expect(AI_GUARDRAILS_PROMPT).toMatch(/COMMA/)
  })
})

describe("stripAiTells", () => {
  it("replaces em-dash with comma", () => {
    expect(stripAiTells("CPL stable, geen actie nodig — alleen monitoren."))
      .toBe("CPL stable, geen actie nodig, alleen monitoren.")
  })

  it("replaces en-dash with comma", () => {
    expect(stripAiTells("Lead quality goed – maar volume zakt."))
      .toBe("Lead quality goed, maar volume zakt.")
  })

  it("replaces space-hyphen-space with comma", () => {
    expect(stripAiTells("Pauzeer ad - test nieuwe angle."))
      .toBe("Pauzeer ad, test nieuwe angle.")
  })

  it("replaces double-hyphen splitter with comma", () => {
    expect(stripAiTells("Iteratie hier -- nieuwe varianten daar."))
      .toBe("Iteratie hier, nieuwe varianten daar.")
  })

  it("preserves hyphens inside compound words", () => {
    const txt = "Test op no-budget en high-ticket prospects voor de B2B-funnel."
    expect(stripAiTells(txt)).toBe(txt)
  })

  it("preserves leading bullet dashes", () => {
    const txt = "- eerste actie\n- tweede actie"
    expect(stripAiTells(txt)).toBe(txt)
  })

  it("is idempotent on already-clean text", () => {
    const clean = "CPL stabiel deze week. Volgende stap: nieuwe creatives."
    expect(stripAiTells(clean)).toBe(clean)
    expect(stripAiTells(stripAiTells(clean))).toBe(clean)
  })

  it("collapses double commas it creates", () => {
    expect(stripAiTells("CPL stijgt, — focus op creatives.")).toBe("CPL stijgt, focus op creatives.")
  })

  it("handles empty/null-ish input safely", () => {
    expect(stripAiTells("")).toBe("")
  })
})

describe("validateAiOutput — em-dash detection", () => {
  it("flags an em-dash between words", () => {
    const v = validateAiOutput("CPL up 80% (7d) — pauzeer ad.", { mondayCrmConnected: true })
    expect(v.some((x) => x.rule === "em_dash_used")).toBe(true)
  })

  it("flags an en-dash between words", () => {
    const v = validateAiOutput("CPL up 80% (7d) – pauzeer ad.", { mondayCrmConnected: true })
    expect(v.some((x) => x.rule === "em_dash_used")).toBe(true)
  })

  it("does not flag a leading bullet dash", () => {
    const v = validateAiOutput("- CPL up 80% (7d).\n- Pause ad.", { mondayCrmConnected: true })
    expect(v.some((x) => x.rule === "em_dash_used")).toBe(false)
  })

  it("does not flag a compound word hyphen", () => {
    const v = validateAiOutput("5/8 leads said 'no-budget' (14d).", { mondayCrmConnected: true })
    expect(v.some((x) => x.rule === "em_dash_used")).toBe(false)
  })
})
