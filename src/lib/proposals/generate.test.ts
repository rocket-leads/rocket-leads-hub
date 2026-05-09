import { describe, it, expect } from "vitest"
import { parseProposalRow, PROPOSAL_TTL_MS } from "./generate"

/**
 * The freshness gate + JSON parse path on the proposal facade is the
 * difference between "user gets a fast cached read" and "user pays a
 * 30-60s Sonnet call every time". A regression here would hammer
 * Anthropic invisibly until someone notices the bill — these tests
 * pin the gate.
 */

const NOW = Date.UTC(2026, 4, 9, 12, 0, 0) // 2026-05-09T12:00:00Z

function makeRow(body: object | null, generatedAt: string) {
  return { body: body ? JSON.stringify(body) : null, generated_at: generatedAt }
}

describe("parseProposalRow — freshness gate", () => {
  it("returns null for null/undefined row (cache miss)", () => {
    expect(parseProposalRow(null, NOW)).toBeNull()
    expect(parseProposalRow(undefined, NOW)).toBeNull()
  })

  it("returns null when body is empty string", () => {
    expect(parseProposalRow({ body: "", generated_at: "2026-05-09T11:00:00Z" }, NOW)).toBeNull()
  })

  it("returns the parsed payload when within TTL", () => {
    const payload = {
      proposals: [{ category: "creative", title: "Iterate on Photo 2 — €25 CPL", detail: "..." }],
      leadAnalysis: null,
      hasKnowledge: true,
      generatedAt: "2026-05-09T11:30:00Z",
    }
    const row = makeRow(payload, "2026-05-09T11:30:00Z")
    const result = parseProposalRow(row, NOW)
    expect(result?.proposals).toHaveLength(1)
    expect(result?.hasKnowledge).toBe(true)
  })

  it("returns null when row is older than the 24h TTL", () => {
    const payload = { proposals: [], leadAnalysis: null, hasKnowledge: false, generatedAt: "2026-05-08T10:00:00Z" }
    const row = makeRow(payload, "2026-05-08T10:00:00Z") // 26h old
    expect(parseProposalRow(row, NOW)).toBeNull()
  })

  it("treats the TTL boundary inclusively — exactly TTL old still passes", () => {
    const generatedAt = new Date(NOW - PROPOSAL_TTL_MS).toISOString()
    const payload = { proposals: [], leadAnalysis: null, hasKnowledge: false, generatedAt }
    const row = makeRow(payload, generatedAt)
    expect(parseProposalRow(row, NOW)).not.toBeNull()
  })

  it("returns null when body isn't valid JSON (corrupt row triggers regen)", () => {
    const row = { body: "{not valid json", generated_at: "2026-05-09T11:00:00Z" }
    expect(parseProposalRow(row, NOW)).toBeNull()
  })

  it("returns null when JSON has no `proposals` array (shape drift)", () => {
    const row = makeRow({ leadAnalysis: { quantity: {} } }, "2026-05-09T11:00:00Z")
    expect(parseProposalRow(row, NOW)).toBeNull()
  })

  it("falls back to row.generated_at when payload.generatedAt is missing", () => {
    const payload = { proposals: [], leadAnalysis: null, hasKnowledge: false }
    const row = makeRow(payload, "2026-05-09T11:00:00Z")
    const result = parseProposalRow(row, NOW)
    expect(result?.generatedAt).toBe("2026-05-09T11:00:00Z")
  })

  it("preserves leadAnalysis when present", () => {
    const payload = {
      proposals: [],
      leadAnalysis: {
        quantity: { verdict: "good", headline: "CPL stable", detail: "...", patterns: [] },
        quality: { verdict: "neutral", headline: "Mixed signals", detail: "...", patterns: [] },
      },
      hasKnowledge: false,
      generatedAt: "2026-05-09T11:00:00Z",
    }
    const row = makeRow(payload, "2026-05-09T11:00:00Z")
    const result = parseProposalRow(row, NOW)
    expect(result?.leadAnalysis?.quantity.verdict).toBe("good")
    expect(result?.leadAnalysis?.quality.verdict).toBe("neutral")
  })

  it("respects a custom ttlMs override (callers may want a tighter window)", () => {
    const generatedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString() // 2h old
    const payload = { proposals: [], leadAnalysis: null, hasKnowledge: false, generatedAt }
    const row = makeRow(payload, generatedAt)
    // Default TTL: passes (2h < 24h)
    expect(parseProposalRow(row, NOW)).not.toBeNull()
    // Tighter 1h TTL: fails
    expect(parseProposalRow(row, NOW, 60 * 60 * 1000)).toBeNull()
  })
})
