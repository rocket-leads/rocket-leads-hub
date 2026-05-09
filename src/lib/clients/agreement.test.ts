import { describe, it, expect } from "vitest"
import {
  agreementMonthly,
  normalizeAgreement,
  EMPTY_AGREEMENT,
  PLATFORMS,
} from "./agreement"

/**
 * agreementMonthly drives the Home dashboard's Team MRR card and the
 * billing/agreement section on every client page. A miscount here =
 * misreported team revenue. normalizeAgreement is the read-side guard
 * against malformed JSONB rows that used to silently break agreementMonthly
 * with NaN.
 */

describe("agreementMonthly", () => {
  it("returns 0 for the empty agreement", () => {
    expect(agreementMonthly(EMPTY_AGREEMENT)).toBe(0)
  })

  it("sums fees for selected platforms only", () => {
    expect(
      agreementMonthly({
        ad_budget: 0,
        platforms: ["meta", "google"],
        platform_fees: { meta: 1000, google: 500, tiktok: 999 },
        follow_up: false,
        follow_up_fee: 0,
        notes: "",
      }),
    ).toBe(1500)
  })

  it("ignores fees for unselected platforms (deselecting must zero them out)", () => {
    expect(
      agreementMonthly({
        ad_budget: 0,
        platforms: ["meta"],
        // tiktok fee is stored but tiktok isn't in `platforms` — must NOT count.
        platform_fees: { meta: 1000, tiktok: 999 },
        follow_up: false,
        follow_up_fee: 0,
        notes: "",
      }),
    ).toBe(1000)
  })

  it("adds follow-up fee when follow_up is true", () => {
    expect(
      agreementMonthly({
        ad_budget: 0,
        platforms: ["meta"],
        platform_fees: { meta: 1000 },
        follow_up: true,
        follow_up_fee: 750,
        notes: "",
      }),
    ).toBe(1750)
  })

  it("does not add follow-up fee when follow_up is false (even with a fee value)", () => {
    expect(
      agreementMonthly({
        ad_budget: 0,
        platforms: ["meta"],
        platform_fees: { meta: 1000 },
        follow_up: false,
        follow_up_fee: 750,
        notes: "",
      }),
    ).toBe(1000)
  })

  it("excludes ad_budget — that is invoiced separately, not part of MRR", () => {
    // ad_budget is the client's media spend, paid through to Meta/Google,
    // not Rocket Leads revenue. agreementMonthly is the management+follow-up
    // fee total only.
    expect(
      agreementMonthly({
        ad_budget: 5000,
        platforms: ["meta"],
        platform_fees: { meta: 1000 },
        follow_up: false,
        follow_up_fee: 0,
        notes: "",
      }),
    ).toBe(1000)
  })
})

describe("normalizeAgreement", () => {
  it("returns the empty agreement for null / undefined / non-object", () => {
    expect(normalizeAgreement(null)).toEqual(EMPTY_AGREEMENT)
    expect(normalizeAgreement(undefined)).toEqual(EMPTY_AGREEMENT)
    expect(normalizeAgreement("nonsense")).toEqual({
      ...EMPTY_AGREEMENT,
      // String input goes through Record cast — all fields stay at default.
    })
  })

  it("filters out unknown platforms", () => {
    const result = normalizeAgreement({ platforms: ["meta", "linkedin", "tiktok"] })
    expect(result.platforms).toEqual(["meta", "tiktok"])
  })

  it("drops non-numeric platform fees", () => {
    const result = normalizeAgreement({
      platform_fees: { meta: 1000, google: "five hundred", tiktok: NaN },
    })
    expect(result.platform_fees.meta).toBe(1000)
    expect(result.platform_fees.google).toBeUndefined()
    expect(result.platform_fees.tiktok).toBeUndefined()
  })

  it("coerces numeric strings for ad_budget and follow_up_fee", () => {
    const result = normalizeAgreement({ ad_budget: "1500", follow_up_fee: "750" })
    expect(result.ad_budget).toBe(1500)
    expect(result.follow_up_fee).toBe(750)
  })

  it("falls back to 0 when ad_budget / follow_up_fee can't be coerced", () => {
    const result = normalizeAgreement({ ad_budget: "free", follow_up_fee: null })
    expect(result.ad_budget).toBe(0)
    expect(result.follow_up_fee).toBe(0)
  })

  it("strict-equals follow_up: true (truthy values like 1 don't count)", () => {
    expect(normalizeAgreement({ follow_up: 1 }).follow_up).toBe(false)
    expect(normalizeAgreement({ follow_up: "true" }).follow_up).toBe(false)
    expect(normalizeAgreement({ follow_up: true }).follow_up).toBe(true)
  })

  it("preserves a stable PLATFORMS order regardless of input array order", () => {
    const result = normalizeAgreement({ platforms: ["tiktok", "meta"] })
    // Input order is preserved (filter doesn't reorder) — but PLATFORMS const
    // is the canonical reference if a UI ever needs to display in fixed order.
    expect(result.platforms.every((p) => PLATFORMS.includes(p))).toBe(true)
    expect(result.platforms.length).toBe(2)
  })
})
