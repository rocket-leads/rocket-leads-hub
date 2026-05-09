import { describe, it, expect } from "vitest"
import { buildAnglesPrompt } from "./build-angles"
import { buildAdCopyPrompt } from "./build-ad-copy"
import { buildLpPrompt } from "./build-lp"
import {
  anglesString,
  scriptContext,
  styleReference,
  huisstijlContext,
  huisstijlForLp,
  previousManusReference,
} from "./context"
import type { BriefData, Angle, BrandStyle } from "@/lib/pedro/helpers"

/**
 * Sanity tests for the extracted prompt builders. The full prompt text
 * is too large/fragile to assert verbatim, so we lock down the parts
 * the rest of the system depends on:
 *  - Inputs end up in the prompt (no field silently dropped)
 *  - Optional context blocks are appended only when supplied
 *  - JSON-output contracts that callers parse against are still present
 *  - The shared GENERATION_RULES tail is appended (callers rely on it
 *    to keep AI output language-aligned with the brief)
 */

const stubBrief: BriefData = {
  bedrijf: "Acme",
  sector: "Loodgieter",
  doel: "B2C huiseigenaren",
  pijn: "Verstopte afvoer",
  aanbod: "24/7 service",
  usps: "- Vaste prijzen",
  hooksAM: "binnen 60 min op locatie",
  hooksExtra: "",
}

describe("buildAnglesPrompt", () => {
  it("inlines every brief field and demands the 5-angle JSON shape", () => {
    const out = buildAnglesPrompt({ brief: stubBrief })
    expect(out).toContain("Acme")
    expect(out).toContain("Loodgieter")
    expect(out).toContain("Verstopte afvoer")
    expect(out).toContain("24/7 service")
    expect(out).toContain("binnen 60 min op locatie")
    expect(out).toContain("ALLEEN JSON")
    expect(out).toContain('"nummer":1')
    // GENERATION_RULES tail
    expect(out).toContain("ALGEMENE REGELS")
  })

  it("appends research context only when supplied", () => {
    const without = buildAnglesPrompt({ brief: stubBrief })
    expect(without).not.toContain("RESEARCH")
    const withCtx = buildAnglesPrompt({
      brief: stubBrief,
      researchContext: "\nRESEARCH: winnende angles\n- Subsidie",
    })
    expect(withCtx).toContain("RESEARCH: winnende angles")
  })
})

describe("buildAdCopyPrompt", () => {
  it("references the LP context when provided", () => {
    const out = buildAdCopyPrompt({
      brief: stubBrief,
      anglesStr: '- "Garantie"',
      lpPrompt: "Hero: Voorkom waterschade nu",
    })
    expect(out).toContain("Landingspagina context")
    expect(out).toContain("Voorkom waterschade nu")
    expect(out).toContain('{"variantA":')
  })

  it("omits the LP block when no LP is passed", () => {
    const out = buildAdCopyPrompt({ brief: stubBrief, anglesStr: "" })
    expect(out).not.toContain("Landingspagina context")
  })
})

describe("buildLpPrompt", () => {
  it("renders all selected angles into the inclusivity instruction", () => {
    const angles: Angle[] = [
      { nummer: 1, titel: "Garantie", beschrijving: "..." },
      { nummer: 2, titel: "Snelheid", beschrijving: "..." },
    ]
    const out = buildLpPrompt({
      brief: stubBrief,
      selectedAngles: angles,
      anglesStr: '- "Garantie"\n- "Snelheid"',
      stijl: "Urgentie-gedreven",
      lengte: "Medium",
      pixelId: "12345",
      webhookUrl: "https://hooks.zapier.com/x",
    })
    expect(out).toContain("Garantie, Snelheid")
    expect(out).toContain("12345")
    expect(out).toContain("https://hooks.zapier.com/x")
  })
})

describe("context helpers", () => {
  it("anglesString collapses to empty when nothing's selected", () => {
    expect(anglesString([])).toBe("")
  })

  it("scriptContext respects skipped flag", () => {
    expect(scriptContext({ script: "lorem", scriptSkipped: true })).toBe("")
    expect(scriptContext({ script: "", scriptSkipped: false })).toBe("")
    expect(scriptContext({ script: "Hook 1: ...", scriptSkipped: false })).toContain(
      "Video script context",
    )
  })

  it("styleReference returns empty string when input is missing", () => {
    expect(styleReference(null)).toBe("")
    expect(styleReference("")).toBe("")
    expect(styleReference("Existing RL ads...")).toContain("Existing RL ads")
  })

  it("huisstijlContext: AM override beats extracted brand style", () => {
    const bs: BrandStyle = {
      primaryColor: "#000",
      secondaryColor: "#FFF",
      tone: "calm",
      industry: "x",
      brandKeywords: "y",
      visualStyle: "z",
    }
    const out = huisstijlContext({
      brandStyle: bs,
      huisstijl: "Manual override here",
      huisstijlOverride: true,
    })
    expect(out).toContain("Manual override here")
    expect(out).not.toContain("#000")
  })

  it("huisstijlForLp uses the LP-specific framing", () => {
    const bs: BrandStyle = {
      primaryColor: "#abc",
      secondaryColor: "#def",
      tone: "punchy",
      industry: "x",
      brandKeywords: "y",
      visualStyle: "minimalist",
    }
    const out = huisstijlForLp({ brandStyle: bs, huisstijl: null, huisstijlOverride: false })
    expect(out).toContain("Match de bestaande merkidentiteit")
    expect(out).toContain("#abc")
    expect(out).toContain("minimalist")
  })

  it("previousManusReference returns empty when client DB has no campaigns", () => {
    expect(previousManusReference(null)).toBe("")
    expect(
      previousManusReference({
        name: "Acme",
        created: "",
        lastUpdate: "",
        website: "",
        sector: "",
        drive: "",
        primaryColor: "",
        secondaryColor: "",
        tone: "",
        visualStyle: "",
        brandbook: "",
        doelgroep: "",
        pijnpunten: "",
        aanbod: "",
        usps: "",
        campaigns: [],
      }),
    ).toBe("")
  })
})
