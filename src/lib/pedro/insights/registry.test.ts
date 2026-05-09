import { describe, it, expect } from "vitest"
import { ALL_INSIGHT_TYPES, INSIGHT_REGISTRY } from "./registry"
import { INSIGHT_TYPES } from "./types"
import type { ClientAiContext } from "./context"
import type { MondayClient } from "@/lib/integrations/monday"

/**
 * Registry shape tests — lock in invariants every insight type must hold.
 * The cron loops over ALL_INSIGHT_TYPES and calls systemPrompt + userPrompt
 * on each; a registry entry that throws on a no-data context (for example)
 * would silently kill the entire cron tick mid-batch.
 */

function makeClient(): MondayClient {
  return {
    mondayItemId: "test_1",
    name: "Test Client",
    firstName: "Test",
    companyName: "Test BV",
    accountManager: "AM",
    campaignManager: "CM",
    appointmentSetter: "Setter",
    campaignStatus: "Live",
    kickOffDate: "",
    adBudget: "1000",
    serviceFee: "1000",
    followUpFee: "",
    followUpStatus: "",
    metaConnected: "",
    metaAdAccountId: "act_1",
    stripeCustomerId: "cus_1",
    trengoContactId: "",
    clientBoardId: "",
    googleDriveId: "",
    cycleStartDate: "",
    nextInvoiceDate: "",
    boardType: "current",
  } as MondayClient
}

function makeMinimalContext(overrides: Partial<ClientAiContext> = {}): ClientAiContext {
  const client = overrides.client ?? makeClient()
  return {
    clientId: client.mondayItemId,
    client,
    kpi: null,
    recent: null,
    mondayTrengo: null,
    fathomMeetings: [],
    inboxEvents: [],
    agreement: null,
    billing: null,
    sources: {
      kpi: false,
      recentWindow: false,
      mondayUpdates: false,
      trengoSummary: false,
      fathomMeetings: false,
      inboxEvents: false,
      agreement: false,
      billing: false,
    },
    collectedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeRichContext(): ClientAiContext {
  return makeMinimalContext({
    kpi: {
      adSpend: 700,
      leads: 20,
      cpl: 35,
      appointments: 3,
      costPerAppointment: 233.33,
      prevCpl: 30,
      prevCostPerAppointment: 200,
      prevPeriodReliable: true,
      mondayCrmConnected: true,
    },
    sources: {
      kpi: true,
      recentWindow: false,
      mondayUpdates: true,
      trengoSummary: true,
      fathomMeetings: true,
      inboxEvents: true,
      agreement: true,
      billing: true,
    },
    mondayTrengo: {
      mondayUpdates: "Lead statuses: deal: 4, geen budget: 2",
      trengoSummary: "Conversation (whatsapp, open):\n[2026-05-08] CLIENT: ...",
      collectedAt: new Date().toISOString(),
    },
  })
}

describe("INSIGHT_REGISTRY — shape invariants", () => {
  it("ALL_INSIGHT_TYPES matches the INSIGHT_TYPES constant", () => {
    expect(new Set(ALL_INSIGHT_TYPES)).toEqual(new Set(INSIGHT_TYPES))
  })

  it("every insight type has a registry entry (no Record holes)", () => {
    for (const type of INSIGHT_TYPES) {
      expect(INSIGHT_REGISTRY[type]).toBeDefined()
      expect(typeof INSIGHT_REGISTRY[type].systemPrompt).toBe("function")
      expect(typeof INSIGHT_REGISTRY[type].userPrompt).toBe("function")
      expect(INSIGHT_REGISTRY[type].model).toBeTruthy()
      expect(INSIGHT_REGISTRY[type].maxTokens).toBeGreaterThan(0)
      expect(INSIGHT_REGISTRY[type].promptVersion).toBeGreaterThan(0)
    }
  })

  it("every systemPrompt splices the canonical AI guardrails block", () => {
    // The whole point of the unification is one source of truth for rules.
    // A registry entry that silently forgot to splice AI_GUARDRAILS_PROMPT
    // would drift back to the pre-unification status quo.
    const ctx = makeRichContext()
    for (const type of INSIGHT_TYPES) {
      const sys = INSIGHT_REGISTRY[type].systemPrompt(ctx)
      expect(sys).toMatch(/TIME WINDOW LABELS/)
      expect(sys).toMatch(/KNOW WHAT DATA YOU HAVE/)
    }
  })

  it("every prompt builder is total — runs on minimal (no-data) context without throwing", () => {
    // The cron WILL pass thin contexts in real life (clients with no KPI,
    // no Monday, no Trengo). A registry entry that throws on such a
    // context kills the entire batch — defend against that here.
    const ctx = makeMinimalContext()
    for (const type of INSIGHT_TYPES) {
      expect(() => INSIGHT_REGISTRY[type].systemPrompt(ctx)).not.toThrow()
      expect(() => INSIGHT_REGISTRY[type].userPrompt(ctx)).not.toThrow()
    }
  })

  it("userPrompt embeds the client name + monday item id", () => {
    const ctx = makeRichContext()
    for (const type of INSIGHT_TYPES) {
      const user = INSIGHT_REGISTRY[type].userPrompt(ctx)
      expect(user).toContain(ctx.client.name)
      expect(user).toContain(ctx.client.mondayItemId)
    }
  })
})

describe("INSIGHT_REGISTRY — shouldGenerate gates", () => {
  it("watchlist_action_note skips no-data clients", () => {
    const ctx = makeMinimalContext()
    expect(INSIGHT_REGISTRY.watchlist_action_note.shouldGenerate?.(ctx)).toBe(false)
  })

  it("watchlist_action_note generates when KPI signal exists", () => {
    const ctx = makeRichContext()
    expect(INSIGHT_REGISTRY.watchlist_action_note.shouldGenerate?.(ctx)).toBe(true)
  })

  it("client_overview generates even on no-data — overview should always render", () => {
    const ctx = makeMinimalContext()
    // No shouldGenerate gate means it generates for every Live client.
    const gate = INSIGHT_REGISTRY.client_overview.shouldGenerate
    expect(gate === undefined || gate(ctx) === true).toBe(true)
  })

  it("client_lead_quality_summary skips when Monday CRM not connected", () => {
    const ctx = makeMinimalContext() // sources.mondayUpdates = false
    expect(INSIGHT_REGISTRY.client_lead_quality_summary.shouldGenerate?.(ctx)).toBe(false)
  })

  it("client_lead_quality_summary generates when Monday CRM is connected", () => {
    const ctx = makeRichContext() // sources.mondayUpdates = true
    expect(INSIGHT_REGISTRY.client_lead_quality_summary.shouldGenerate?.(ctx)).toBe(true)
  })

  it("client_optimisation_summary skips no-data clients", () => {
    const ctx = makeMinimalContext()
    expect(INSIGHT_REGISTRY.client_optimisation_summary.shouldGenerate?.(ctx)).toBe(false)
  })
})

describe("INSIGHT_REGISTRY — context-awareness in prompts", () => {
  it("user prompt includes the appropriate UNKNOWN signal when CRM is missing", () => {
    const ctx = makeMinimalContext()
    const user = INSIGHT_REGISTRY.watchlist_action_note.userPrompt(ctx)
    // Without Monday CRM, the data-availability block must communicate
    // appointments are UNKNOWN — guards against the "0 appointments"
    // hallucination the guardrail validates against.
    expect(user).toMatch(/Monday CRM = NOT CONNECTED/)
    expect(user).toMatch(/UNKNOWN/)
  })

  it("user prompt includes Monday updates when present", () => {
    const ctx = makeRichContext()
    const user = INSIGHT_REGISTRY.watchlist_action_note.userPrompt(ctx)
    expect(user).toContain("MONDAY CRM")
    expect(user).toContain("Lead statuses")
  })

  it("user prompt includes the watchlist insight to anchor the AI Note", () => {
    const ctx = makeRichContext()
    const user = INSIGHT_REGISTRY.watchlist_action_note.userPrompt(ctx)
    // The AI Note is supposed to ADD to the Insight column — so the
    // Insight must be in the prompt so the model knows what NOT to repeat.
    expect(user).toMatch(/INSIGHT COLUMN/)
    expect(user).toMatch(/DO NOT REPEAT/)
  })
})
