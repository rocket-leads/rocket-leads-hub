import { describe, it, expect } from "vitest"
import { previousMonth } from "./monthly-digest"

/**
 * `previousMonth` derives the digest's month label from the cron run
 * date. It must always return the month that just *ended* — anything
 * else lands the task with the wrong title and breaks the dedupe key.
 */

describe("previousMonth", () => {
  it("returns the prior month when the run date is the 1st", () => {
    const r = previousMonth(new Date("2026-05-01T09:00:00Z"))
    expect(r.monthYear).toBe("2026-04")
    expect(r.label).toBe("April 2026")
  })

  it("rolls over the year boundary (Jan 1 → previous December)", () => {
    const r = previousMonth(new Date("2026-01-01T09:00:00Z"))
    expect(r.monthYear).toBe("2025-12")
    expect(r.label).toBe("December 2025")
  })

  it("handles month-end run dates without falling into the wrong month", () => {
    // 31 March: a naive d.setMonth(d.getMonth() - 1) on the 31st would
    // land in March (since Feb has no 31st) — but we set day=1 first.
    const r = previousMonth(new Date("2026-03-31T09:00:00Z"))
    expect(r.monthYear).toBe("2026-02")
    expect(r.label).toBe("February 2026")
  })

  it("zero-pads single-digit months in monthYear", () => {
    const r = previousMonth(new Date("2026-04-01T09:00:00Z"))
    expect(r.monthYear).toBe("2026-03")
  })
})
