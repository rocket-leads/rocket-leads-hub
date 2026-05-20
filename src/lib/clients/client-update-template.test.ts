import { describe, it, expect } from "vitest"
import {
  renderWeeklyUpdate,
  composeInitialParts,
  renderFromParts,
  partsToWeeklyUpdateParams,
  INTROS,
  type EditableParts,
} from "./client-update-template"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"
import type { PedroInsightBody } from "@/lib/pedro/insights/types"

const KPI: KpiSummary = {
  adSpend: 1834,
  leads: 42,
  cpl: 43.67,
  prevCpl: 38.5,
  prevPeriodReliable: true,
}

const PEDRO: PedroInsightBody = {
  conclusion: "Campagne draait stabiel deze week, met een lichte stijging in CPL.",
  actions: [
    "Itereer op winning ad 'Video 2 | Pricelist' met 3 nieuwe varianten",
    "Pauzeer ad 'Photo 4 | Generic', €120 spent, 1 lead",
    "Test nieuwe angle: subsidie-hook",
  ],
}

const MONDAY_WEEK_20 = new Date("2026-05-11T10:00:00Z")

describe("renderWeeklyUpdate", () => {
  it("emits a complete draft for a healthy client", () => {
    const out = renderWeeklyUpdate({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    // Opener is just the name — the V2 Trengo template body provides
    // both "Hey " prefix and trailing ",", so the variable content stays
    // bare.
    expect(out).toMatch(/^Bram\b/)
    expect(out).not.toMatch(/^(Hé|Hoi|Hi|Hey)\s/)
    expect(out).not.toMatch(/^Bram!/)
    expect(out).toContain("Ad spend: €1.834")
    expect(out).toContain("Kosten per lead: €43,67")
    expect(out).toMatch(/13% stijging/)
    expect(out).toContain(PEDRO.conclusion)
    expect(out).toContain("• " + PEDRO.actions[0])
    // Actions header is provided by the V2 template body, not by the
    // variable content — so it should NOT appear in the rendered string.
    expect(out).not.toContain("Wat we deze week gaan doen")
    // No sign-off — that comes from the Trengo template suffix.
    expect(out).not.toMatch(/Hoor 't graag/)
    expect(out).not.toMatch(/Groet(jes)?/i)
  })

  it("is deterministic — same client + same week = same draft", () => {
    const input = { firstName: "Bram", clientId: "12345", kpi: KPI, pedro: PEDRO }
    const a = renderWeeklyUpdate({ ...input, now: MONDAY_WEEK_20 })
    const b = renderWeeklyUpdate({ ...input, now: new Date("2026-05-12T10:00:00Z") })
    expect(a).toBe(b)
  })

  it("falls back to an empty-state conclusion when both Pedro + KPI are missing", () => {
    const out = renderWeeklyUpdate({
      firstName: "Bram",
      clientId: "12345",
      kpi: null,
      pedro: null,
      now: MONDAY_WEEK_20,
    })
    expect(out).toMatch(/^Bram\b/)
    expect(out).not.toMatch(/^Bram!/)
    expect(out).toMatch(/opstarten/i)
    expect(out).not.toMatch(/Afgelopen 7 dagen/)
    expect(out).not.toMatch(/Wat we deze week gaan doen/)
  })

  it("renders without a first name (no dangling space after the empty opener)", () => {
    const out = renderWeeklyUpdate({
      firstName: "",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    expect(out).not.toMatch(/^!/) // no leading "!"
    expect(out).not.toMatch(/^\s/)
    expect(out).toContain("Ad spend: €1.834")
  })

  it("caps Pedro actions at 3 bullets", () => {
    const manyActions: PedroInsightBody = {
      conclusion: PEDRO.conclusion,
      actions: ["a", "b", "c", "d", "e"],
    }
    const out = renderWeeklyUpdate({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: manyActions,
      now: MONDAY_WEEK_20,
    })
    expect(out).toContain("• a")
    expect(out).toContain("• c")
    expect(out).not.toContain("• d")
    expect(out).not.toContain("• e")
  })
})

describe("composeInitialParts + renderFromParts — fully-editable model", () => {
  it("returns parts with the opener as name-only (no greeting word)", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    // V2 WhatsApp shape: opener is just the first name (template adds
    // "Hey " + ","), kpiBlock is bullets-only (template provides the
    // "📊 Cijfers deze week:" header), actionsHeader is empty (template
    // provides "✅ Wat we deze week gaan doen:").
    expect(parts.opener).toBe("Bram")
    expect(INTROS).toContain(parts.intro as (typeof INTROS)[number])
    expect(parts.kpiBlock).not.toContain("📊 Afgelopen 7 dagen")
    expect(parts.kpiBlock).toContain("€1.834")
    // trendSentence is now empty on new composes — the qualitative
    // headline is concatenated into `conclusion` so the AM edits a
    // single block.
    expect(parts.trendSentence).toBe("")
    expect(parts.conclusion).toMatch(/Kosten per lead lopen/i)
    expect(parts.conclusion).toContain(PEDRO.conclusion)
    expect(parts.actions).toEqual(PEDRO.actions)
    expect(parts.actionsHeader).toBe("")
  })

  it("editing every field — including KPI numbers — flows through to the rendered output", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    const edited = {
      ...parts,
      opener: "Janneke!",
      intro: "Aangepaste intro.",
      kpiBlock: "📊 Custom block\n• Ad spend: €9.999\n• Leads: 1",
      trendSentence: "Custom trend.",
      conclusion: "Custom conclusie.",
      actionsHeader: "✅ Custom header:",
      actions: ["Nieuwe actie"],
    }
    const out = renderFromParts(edited)
    expect(out).toContain("Janneke!")
    expect(out).toContain("Aangepaste intro.")
    expect(out).toContain("€9.999")
    expect(out).not.toContain("€1.834") // original KPI got overwritten
    expect(out).toContain("Custom trend.")
    expect(out).toContain("Custom conclusie.")
    expect(out).toContain("Custom header:")
    expect(out).toContain("• Nieuwe actie")
  })

  it("skips empty fields cleanly so deleting a section doesn't leave blank lines", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    const withoutTrend = { ...parts, trendSentence: "" }
    const out = renderFromParts(withoutTrend)
    expect(out).not.toMatch(/\n\n\n/) // no triple-newline runs
  })

  it("renderFromParts and renderWeeklyUpdate produce the same output for the same input", () => {
    const input = {
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    }
    const direct = renderFromParts(composeInitialParts(input).parts)
    const viaWrapper = renderWeeklyUpdate(input)
    expect(direct).toBe(viaWrapper)
  })

  it("empty-state path: name + opstartings sentence, nothing else", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: null,
      pedro: null,
      now: MONDAY_WEEK_20,
    })
    expect(parts.opener).toBe("Bram")
    expect(parts.intro).toBe("")
    expect(parts.kpiBlock).toBe("")
    expect(parts.actions).toEqual([])
    expect(parts.conclusion).toMatch(/opstarten/i)
  })
})

describe("composeInitialParts — defaults when Pedro hasn't generated yet", () => {
  it("pre-fills a CPL-shaped conclusion when Pedro has nothing to say", () => {
    // CPL up 25%+ → focus-area framing
    const spikedKpi: KpiSummary = { ...KPI, cpl: 60, prevCpl: 40 }
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: spikedKpi,
      pedro: null,
      now: MONDAY_WEEK_20,
    })
    expect(parts.conclusion).toMatch(/(loopt op|optimalisaties)/i)
  })

  it("pre-fills 3 plausible actions when Pedro has none", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: null,
      now: MONDAY_WEEK_20,
    })
    expect(parts.actions).toHaveLength(3)
    // All defaults are non-empty, generic playbook actions
    expect(parts.actions.every((a) => a.trim().length > 5)).toBe(true)
    // No duplicates within the trio
    expect(new Set(parts.actions).size).toBe(3)
    // Header is provided by the V2 Trengo template body — not by the
    // variable content — so it stays empty in `parts`.
    expect(parts.actionsHeader).toBe("")
  })

  it("Pedro wins over defaults when present", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    // Pedro's conclusion is included verbatim within the merged block.
    expect(parts.conclusion).toContain(PEDRO.conclusion)
    expect(parts.actions).toEqual(PEDRO.actions)
  })

  it("email mode: opener uses full salutation, signOff + subject get populated", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientName: "SiteJob",
      amFirstName: "danny",
      channel: "email",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    // Full salutation, ending in a comma (not "!")
    expect(parts.opener).toBe("Hé Bram,")
    // Subject reads like a real email
    expect(parts.subject).toBe("Wekelijkse update SiteJob")
    // Sign-off uses the AM's first name, capitalised
    expect(parts.signOff).toContain("Groetjes,")
    expect(parts.signOff).toContain("Danny")
  })

  it("email mode: renderFromParts appends the signOff at the end of the body", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientName: "SiteJob",
      amFirstName: "danny",
      channel: "email",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    const out = renderFromParts(parts)
    expect(out).toMatch(/^Hé Bram,/)
    expect(out).toMatch(/Groetjes,\nDanny$/)
    // Subject is NOT in the body
    expect(out).not.toContain("Wekelijkse update SiteJob")
  })

  it("whatsapp mode: bare-name opener, no subject, no signOff", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientName: "SiteJob",
      amFirstName: "danny",
      channel: "whatsapp",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    // V2 template wraps the body — opener variable is just the name.
    expect(parts.opener).toBe("Bram")
    expect(parts.subject).toBe("")
    expect(parts.signOff).toBe("")
    const out = renderFromParts(parts)
    expect(out).not.toMatch(/Groetjes/i)
    expect(out).not.toContain("Hé Bram")
  })

  it("note: empty by default, lands between trend and conclusion when filled", () => {
    const { parts } = composeInitialParts({
      firstName: "Bram",
      clientId: "12345",
      kpi: KPI,
      pedro: PEDRO,
      now: MONDAY_WEEK_20,
    })
    expect(parts.note).toBe("")

    // When the AM dictates context, it appears between trend + conclusion.
    const out = renderFromParts({
      ...parts,
      note: "We hebben de drempel verhoogd, daarom is CPL gestegen.",
    })
    expect(out).toContain("We hebben de drempel verhoogd")
    // Note paragraph appears AFTER the trend block
    const trendIdx = out.indexOf(parts.trendSentence)
    const noteIdx = out.indexOf("We hebben de drempel")
    const conclusionIdx = out.indexOf(parts.conclusion)
    expect(trendIdx).toBeLessThan(noteIdx)
    expect(noteIdx).toBeLessThan(conclusionIdx)
  })

  it("rotates the default actions across weeks so the trio differs", () => {
    const inputs = [0, 1, 2, 3].map((wOffset) => {
      const d = new Date(MONDAY_WEEK_20)
      d.setUTCDate(d.getUTCDate() + 7 * wOffset)
      return composeInitialParts({
        firstName: "Bram",
        clientId: "12345",
        kpi: KPI,
        pedro: null,
        now: d,
      }).parts.actions
    })
    // At least one of the offset weeks should produce a different action trio.
    const allSame = inputs.every((trio) => trio.join("|") === inputs[0].join("|"))
    expect(allSame).toBe(false)
  })
})

describe("partsToWeeklyUpdateParams — V2 multi-variable template mapping", () => {
  const baseParts: EditableParts = {
    opener: "Bram!",
    intro: "Korte update over deze week.",
    kpiBlock: "📊 KPI deze week:\n• CPL: €11.42\n• Spend: €450\n• Leads: 39",
    trendSentence: "Lichte stijging deze week.",
    note: "We hebben de drempel verhoogd.",
    conclusion: "Volgende week zien we of dit zich vertaalt.",
    actionsHeader: "✅ Wat we deze week gaan doen:",
    actions: ["Nieuwe varianten testen", "Doelgroep verfijnen"],
    subject: "",
    signOff: "",
  }

  it("returns exactly 5 params in slot order", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    expect(out).toHaveLength(5)
  })

  it("strips trailing '!' from the opener for {{1}}", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    expect(out[0]).toBe("Bram")
  })

  it("renders the KPI block as a flat comma-separated phrase (no bullets, no header)", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    expect(out[2]).toBe("CPL: €11.42, Spend: €450, Leads: 39.")
    expect(out[2]).not.toContain("•")
    expect(out[2]).not.toContain("KPI deze week")
  })

  it("merges trend + note + conclusion into one inline body block", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    expect(out[3]).toContain("Lichte stijging deze week.")
    expect(out[3]).toContain("We hebben de drempel verhoogd.")
    expect(out[3]).toContain("Volgende week zien we")
  })

  it("renders actions as flowing sentences joined with spaces (no bullets)", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    expect(out[4]).toBe("Nieuwe varianten testen. Doelgroep verfijnen.")
    expect(out[4]).not.toContain("•")
  })

  it("never produces newlines, tabs, or double spaces in any param", () => {
    const out = partsToWeeklyUpdateParams(baseParts)
    for (const p of out) {
      expect(p).not.toMatch(/[\n\r\t]/)
      expect(p).not.toMatch(/ {2,}/)
    }
  })

  it("handles empty intro / trend / note gracefully (still 5 non-empty params)", () => {
    const sparse: EditableParts = {
      ...baseParts,
      intro: "",
      trendSentence: "",
      note: "",
    }
    const out = partsToWeeklyUpdateParams(sparse)
    expect(out).toHaveLength(5)
    // Empty intro → fallback placeholder (Meta rejects empty body params)
    expect(out[1]).toBe("Update over de afgelopen week.")
    // Body still collapses to just the conclusion since that's non-empty
    expect(out[3]).toBe("Volgende week zien we of dit zich vertaalt.")
  })

  it("handles empty actions list with a fallback placeholder for {{5}}", () => {
    const out = partsToWeeklyUpdateParams({ ...baseParts, actions: [] })
    // Meta rejects empty body params — must substitute something non-empty.
    expect(out[4]).toBe("Geen specifieke actiepunten deze week.")
  })

  it("substitutes per-slot fallbacks when every editable field is empty (defends against Meta 422)", () => {
    const blank: EditableParts = {
      opener: "",
      intro: "",
      kpiBlock: "",
      trendSentence: "",
      note: "",
      conclusion: "",
      actionsHeader: "",
      actions: [],
      subject: "",
      signOff: "",
    }
    const out = partsToWeeklyUpdateParams(blank)
    expect(out).toHaveLength(5)
    for (const p of out) {
      expect(typeof p).toBe("string")
      expect(p.length).toBeGreaterThan(0)
    }
  })

  it("coerces null/undefined fields without crashing (defensive against stored drafts)", () => {
    const dirty = {
      ...baseParts,
      intro: null,
      kpiBlock: undefined,
      conclusion: null,
      actions: [null, "Echte actie", undefined],
    } as unknown as EditableParts
    const out = partsToWeeklyUpdateParams(dirty)
    expect(out).toHaveLength(5)
    for (const p of out) {
      expect(typeof p).toBe("string")
      expect(p.length).toBeGreaterThan(0)
    }
    expect(out[4]).toContain("Echte actie")
  })
})
