import { describe, it, expect } from "vitest"
import { parsePedroBody } from "./types"

/**
 * `parsePedroBody` is the last line of defence between Haiku's actual output
 * and the dialog rendering - when it fails the AM sees a wall of raw JSON
 * (which is exactly the bug Roy hit in production). These tests pin the
 * common ways the model breaks the contract.
 */

describe("parsePedroBody", () => {
  it("parses clean JSON", () => {
    const body = `{"conclusion":"All good","actions":["one","two"]}`
    expect(parsePedroBody(body)).toEqual({ conclusion: "All good", actions: ["one", "two"] })
  })

  it("parses markdown-fenced JSON with a `json` language tag", () => {
    const body = "```json\n{\n  \"conclusion\": \"CPL stable\",\n  \"actions\": [\"A\", \"B\"]\n}\n```"
    expect(parsePedroBody(body)).toEqual({
      conclusion: "CPL stable",
      actions: ["A", "B"],
    })
  })

  it("parses markdown-fenced JSON without a language tag", () => {
    const body = "```\n{\"conclusion\":\"x\",\"actions\":[]}\n```"
    expect(parsePedroBody(body)).toEqual({ conclusion: "x", actions: [] })
  })

  it("parses output where the fence backticks were stripped but `json\\n` survived", () => {
    // This is the exact shape we saw in production: stripAiTells nuked the
    // backticks but left the language tag.
    const body = "json\n{\n  \"conclusion\": \"CPL is gestegen naar €5.90 (7d).\",\n  \"actions\": [\"Test 3-5 nieuwe variants\"]\n}"
    const parsed = parsePedroBody(body)
    expect(parsed?.conclusion).toBe("CPL is gestegen naar €5.90 (7d).")
    expect(parsed?.actions).toEqual(["Test 3-5 nieuwe variants"])
  })

  it("parses output with a preamble before the JSON object", () => {
    const body = `Here is the update:\n{"conclusion":"ok","actions":[]}`
    expect(parsePedroBody(body)).toEqual({ conclusion: "ok", actions: [] })
  })

  it("filters out empty action strings", () => {
    const body = `{"conclusion":"c","actions":["a","","   ","b"]}`
    expect(parsePedroBody(body)?.actions).toEqual(["a", "b"])
  })

  it("falls back to plain text when nothing parses", () => {
    const body = "This is just a plain message, not JSON at all."
    const parsed = parsePedroBody(body)
    expect(parsed?.conclusion).toBe("This is just a plain message, not JSON at all.")
    expect(parsed?.actions).toEqual([])
  })

  it("returns null for empty / whitespace input", () => {
    expect(parsePedroBody("")).toBeNull()
    expect(parsePedroBody("   \n  ")).toBeNull()
    expect(parsePedroBody(null)).toBeNull()
    expect(parsePedroBody(undefined)).toBeNull()
  })

  it("handles malformed JSON inside fences by falling back gracefully", () => {
    // Missing closing brace - substring parser tries `{...` slice, also fails,
    // we end up with plain-text fallback (better than crashing the dialog).
    const body = "```json\n{\"conclusion\": \"oops\",\n```"
    const parsed = parsePedroBody(body)
    expect(parsed).not.toBeNull()
    expect(parsed?.conclusion).toContain("conclusion")
  })
})

describe("parsePedroBody - action sanitiser (drops internal CM speech)", () => {
  const wrap = (actions: string[]) =>
    JSON.stringify({ conclusion: "Update.", actions })

  it("drops actions that use agency jargon (ad-set, fatigue, CTR, frequency)", () => {
    const body = wrap([
      "Analyseer ad-set fatigue: controleer frequency en CTR decay.",
      "Doelgroep wat verfijnen op leeftijd.",
      "Audience overlap onderzoeken in de Meta-campagne.",
    ])
    const parsed = parsePedroBody(body)
    expect(parsed?.actions).toEqual(["Doelgroep wat verfijnen op leeftijd."])
  })

  it("drops actions that reference team members in 3rd person", () => {
    const body = wrap([
      "Stem af met Roy Vosters over leadkwaliteit-signalen.",
      "Volgende week samen door de leadkwaliteit lopen.",
      "Vraag aan Stefan of dit ook bij andere klanten speelt.",
    ])
    expect(parsePedroBody(body)?.actions).toEqual([
      "Volgende week samen door de leadkwaliteit lopen.",
    ])
  })

  it("drops actions starting with CM-imperative verbs (Analyseer / Onderzoek / Herzie)", () => {
    const body = wrap([
      "Analyseer creatieve vermoeidheid.",
      "Onderzoek of de doelgroep niet te smal is.",
      "Herzie de lead-quality signalen.",
      "3-5 nieuwe varianten van de winnaar testen.",
    ])
    expect(parsePedroBody(body)?.actions).toEqual([
      "3-5 nieuwe varianten van de winnaar testen.",
    ])
  })

  it("drops actions longer than 18 words even when otherwise clean", () => {
    const long =
      "Heel uitgebreid gaan we deze week kijken naar diverse mogelijkheden om de campagne stap voor stap stap weer beter te laten draaien"
    const body = wrap([long, "Korte actie deze week."])
    expect(parsePedroBody(body)?.actions).toEqual(["Korte actie deze week."])
  })

  it("drops actions containing window labels meant for internal use", () => {
    // Internal-only markers like @mentions and TO-DO blocks shouldn't leak.
    const body = wrap([
      "@Stefan TO DO follow up op klant.",
      "Volgende week leadkwaliteit doornemen.",
    ])
    expect(parsePedroBody(body)?.actions).toEqual([
      "Volgende week leadkwaliteit doornemen.",
    ])
  })

  it("caps actions at 3 even when more clean actions come through", () => {
    const body = wrap([
      "Nieuwe varianten testen.",
      "Doelgroep verfijnen.",
      "Volgende week leadkwaliteit doornemen.",
      "Een extra creative klaarzetten.",
      "Frisheid in de copy aanbrengen.",
    ])
    expect(parsePedroBody(body)?.actions).toHaveLength(3)
  })

  it("returns an empty action array when EVERYTHING is internal - better than padding", () => {
    const body = wrap([
      "Analyseer ad-set fatigue diepgaand.",
      "Bespreek met Roy de leadkwaliteit signalen.",
      "Herzie de spend-aanpassing voor volgende cyclus.",
    ])
    expect(parsePedroBody(body)?.actions).toEqual([])
  })
})
