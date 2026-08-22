import { describe, it, expect } from "vitest"
import { resolveBillingPeriod } from "./stripe"

describe("resolveBillingPeriod", () => {
  it("returns null for missing / malformed cycle start", () => {
    expect(resolveBillingPeriod(null)).toBeNull()
    expect(resolveBillingPeriod("")).toBeNull()
    // Wrong shape (not YYYY-MM-DD) → null. Calendar-range validity isn't
    // checked here; the cycle date always comes from Monday's date column.
    expect(resolveBillingPeriod("28-08-2026")).toBeNull()
  })

  it("falls back to a 1-month span when no next cycle date is given", () => {
    // 28 Aug → 27 Sep (day before same-day-next-month).
    expect(resolveBillingPeriod("2026-08-28")?.label).toBe("28 Aug – 27 Sept 2026")
  })

  it("uses the next cycle date to span the real period (quarterly)", () => {
    // Vloerschuurmeester case: quarterly invoice, next cycle +3 months.
    // 28 Aug → 27 Nov, NOT the old hardcoded 27 Sep.
    expect(resolveBillingPeriod("2026-08-28", "2026-11-28")?.label).toBe(
      "28 Aug – 27 Nov 2026",
    )
  })

  it("spans a 2-month cadence correctly", () => {
    expect(resolveBillingPeriod("2026-08-28", "2026-10-28")?.label).toBe(
      "28 Aug – 27 Oct 2026",
    )
  })

  it("straddling a year boundary shows both years", () => {
    // Dec → Feb (quarterly across new year).
    expect(resolveBillingPeriod("2026-12-01", "2027-03-01")?.label).toBe(
      "1 Dec 2026 – 28 Feb 2027",
    )
  })

  it("ignores a next cycle date that is not strictly after the start", () => {
    // Same/earlier date → zero/negative period → fall back to +1 month.
    expect(resolveBillingPeriod("2026-08-28", "2026-08-28")?.label).toBe(
      "28 Aug – 27 Sept 2026",
    )
    expect(resolveBillingPeriod("2026-08-28", "2026-07-01")?.label).toBe(
      "28 Aug – 27 Sept 2026",
    )
    // Malformed next date → fall back too.
    expect(resolveBillingPeriod("2026-08-28", "not-a-date")?.label).toBe(
      "28 Aug – 27 Sept 2026",
    )
  })

  it("clamps the monthly fallback to the last valid day (Jan 31 → Feb)", () => {
    // 31 Jan + 1mo - 1d must not roll into March.
    expect(resolveBillingPeriod("2026-01-31")?.label).toBe("31 Jan – 27 Feb 2026")
  })

  it("tags Stripe period boundaries in unix seconds", () => {
    const p = resolveBillingPeriod("2026-08-28", "2026-11-28")
    expect(p?.unixStart).toBe(Math.floor(Date.UTC(2026, 7, 28) / 1000))
    // End = 27 Nov (next cycle − 1 day).
    expect(p?.unixEnd).toBe(Math.floor(Date.UTC(2026, 10, 27) / 1000))
  })
})
