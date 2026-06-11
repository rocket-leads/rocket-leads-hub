import { describe, it, expect } from "vitest"
import { isPrevPeriodReliable, PREV_PERIOD_COVERAGE_THRESHOLD } from "./kpi-window"

/**
 * The prev-period reliability flag is what tells the UI whether to show
 * "+/- X% vs prev 7d" or hide it entirely. A regression here lets a
 * freshly-launched client display a wild +inf%/+5000% delta as if it were
 * a real campaign performance signal - which is exactly the kind of
 * silent dashboard lie this whole foundation pass is meant to prevent.
 */

describe("isPrevPeriodReliable", () => {
  it("constant is 0.8 (80% coverage)", () => {
    expect(PREV_PERIOD_COVERAGE_THRESHOLD).toBe(0.8)
  })

  it("returns true when the prev window had spend on most days", () => {
    // 7-day prev window, 6 active days, total spend 700.
    expect(isPrevPeriodReliable("2026-05-01", "2026-05-07", 6, 700)).toBe(true)
  })

  it("returns false when prev spend is zero (window happened but client wasn't really on)", () => {
    expect(isPrevPeriodReliable("2026-05-01", "2026-05-07", 7, 0)).toBe(false)
  })

  it("returns false when coverage is below the 80% threshold", () => {
    // 5/7 = 71% - below threshold.
    expect(isPrevPeriodReliable("2026-05-01", "2026-05-07", 5, 100)).toBe(false)
  })

  it("returns true at exactly the 80% threshold", () => {
    // 6/7 ≈ 85.7% - over. Test the precise boundary on a 10-day window.
    expect(isPrevPeriodReliable("2026-05-01", "2026-05-10", 8, 100)).toBe(true)
  })

  it("returns false for a degenerate 0-day window", () => {
    // Same start and end with the formula `(end - start)/86400000 + 1` is 1
    // day - this assertion checks an actually-bad input where end < start.
    expect(isPrevPeriodReliable("2026-05-07", "2026-05-01", 0, 100)).toBe(false)
  })
})
