import { describe, it, expect } from "vitest"
import {
  mondayStatusToHub,
  hubStatusToMondayLabel,
  mondayLabelToOnboardingPhase,
  statusLabel,
  statusTone,
  STATUS_LABEL_NONE,
  STATUS_TONE_NONE,
} from "./status"

/**
 * The status mapping is shared between every part of the Hub that pills
 * a client's lifecycle phase - Watch List, Settings, Clients overview,
 * Home, Targets. A regression here either silently misclassifies clients
 * (e.g. counting "Stopt - geen budget" as live revenue) or produces
 * phantom "Onboarding" badges on truly unmapped values.
 *
 * Coverage focus: every Monday label observed in the production board is
 * pinned here so a Monday-side rename or a code refactor doesn't drop
 * a status family.
 */

describe("mondayStatusToHub - current board", () => {
  it("Live family", () => {
    expect(mondayStatusToHub("Live", "current")).toBe("live")
    expect(mondayStatusToHub("Subcampaigns only", "current")).toBe("live")
  })

  it("On-hold family - including PAUSED variants", () => {
    expect(mondayStatusToHub("On hold", "current")).toBe("on_hold")
    expect(mondayStatusToHub("Paused", "current")).toBe("on_hold")
    expect(mondayStatusToHub("PAUSED (long term)", "current")).toBe("on_hold")
  })

  it("Onboarding family on the current board (legacy values)", () => {
    expect(mondayStatusToHub("In development", "current")).toBe("onboarding")
    expect(mondayStatusToHub("Kick off", "current")).toBe("onboarding")
    expect(mondayStatusToHub("Kickoff scheduled", "current")).toBe("onboarding")
    expect(mondayStatusToHub("Onboarding", "current")).toBe("onboarding")
  })

  it("Churned family - Stopt / Stopped / debt collection / guarantee not met", () => {
    expect(mondayStatusToHub("Stopped 1st month", "current")).toBe("churned")
    expect(mondayStatusToHub("Stopped 2nd month+", "current")).toBe("churned")
    expect(mondayStatusToHub("Stopt - geen budget", "current")).toBe("churned")
    expect(mondayStatusToHub("Stopt - andere reden", "current")).toBe("churned")
    expect(mondayStatusToHub("Debt collection agency", "current")).toBe("churned")
    expect(mondayStatusToHub("Debt collecting agency", "current")).toBe("churned") // typo variant
    expect(mondayStatusToHub("Guarantee not met", "current")).toBe("churned")
    expect(mondayStatusToHub("Churned", "current")).toBe("churned")
  })

  it("normalises case and trailing whitespace", () => {
    expect(mondayStatusToHub("  live  ", "current")).toBe("live")
    expect(mondayStatusToHub("LIVE", "current")).toBe("live")
    expect(mondayStatusToHub("on hold", "current")).toBe("on_hold")
  })

  it("returns null for empty / unknown labels - never silently falls back to onboarding", () => {
    expect(mondayStatusToHub("", "current")).toBeNull()
    expect(mondayStatusToHub("   ", "current")).toBeNull()
    expect(mondayStatusToHub(null, "current")).toBeNull()
    expect(mondayStatusToHub(undefined, "current")).toBeNull()
    // Brand-new Monday option not yet ladded into the mapping → null, not phantom.
    expect(mondayStatusToHub("Some Brand New Status", "current")).toBeNull()
  })
})

describe("mondayStatusToHub - onboarding board", () => {
  it("always returns onboarding regardless of column value", () => {
    // The onboarding board's membership IS the lifecycle signal - column
    // value is per-phase, not per-status. We collapse all of them.
    expect(mondayStatusToHub("Live", "onboarding")).toBe("onboarding")
    expect(mondayStatusToHub("Stopped", "onboarding")).toBe("onboarding")
    expect(mondayStatusToHub("", "onboarding")).toBe("onboarding")
    expect(mondayStatusToHub(null, "onboarding")).toBe("onboarding")
  })
})

describe("hubStatusToMondayLabel", () => {
  it("round-trips cleanly through mondayStatusToHub on the canonical labels", () => {
    expect(mondayStatusToHub(hubStatusToMondayLabel("live"), "current")).toBe("live")
    expect(mondayStatusToHub(hubStatusToMondayLabel("on_hold"), "current")).toBe("on_hold")
    expect(mondayStatusToHub(hubStatusToMondayLabel("onboarding"), "current")).toBe("onboarding")
    expect(mondayStatusToHub(hubStatusToMondayLabel("churned"), "current")).toBe("churned")
  })

  it("writes the canonical Monday label, not a variant", () => {
    expect(hubStatusToMondayLabel("live")).toBe("Live")
    expect(hubStatusToMondayLabel("on_hold")).toBe("On hold")
    expect(hubStatusToMondayLabel("churned")).toBe("Churned")
  })
})

describe("mondayLabelToOnboardingPhase", () => {
  it("maps the canonical phase labels", () => {
    expect(mondayLabelToOnboardingPhase("Kickoff scheduled")).toBe("kickoff_scheduled")
    expect(mondayLabelToOnboardingPhase("Waiting on client")).toBe("waiting_on_client")
    expect(mondayLabelToOnboardingPhase("Create campaign")).toBe("create_campaign")
    expect(mondayLabelToOnboardingPhase("Waiting for feedback")).toBe("waiting_for_feedback")
    expect(mondayLabelToOnboardingPhase("LAUNCH 🚀")).toBe("launch")
    expect(mondayLabelToOnboardingPhase("On hold")).toBe("on_hold")
    expect(mondayLabelToOnboardingPhase("Debt collection agency")).toBe("debt_collection")
  })

  it("accepts spelling variants", () => {
    expect(mondayLabelToOnboardingPhase("Kick off scheduled")).toBe("kickoff_scheduled")
    expect(mondayLabelToOnboardingPhase("Kick-off scheduled")).toBe("kickoff_scheduled")
    expect(mondayLabelToOnboardingPhase("Waiting on feedback")).toBe("waiting_for_feedback")
    expect(mondayLabelToOnboardingPhase("LAUNCH")).toBe("launch")
  })

  it("returns null for empty / unmapped values", () => {
    expect(mondayLabelToOnboardingPhase("")).toBeNull()
    expect(mondayLabelToOnboardingPhase(null)).toBeNull()
    expect(mondayLabelToOnboardingPhase("In development")).toBeNull() // legacy, not a phase
  })
})

describe("statusLabel + statusTone", () => {
  it("uses the muted dash + tone for null", () => {
    expect(statusLabel(null)).toBe(STATUS_LABEL_NONE)
    expect(statusTone(null)).toEqual(STATUS_TONE_NONE)
  })

  it("returns sensible labels for each status", () => {
    expect(statusLabel("live")).toBe("Live")
    expect(statusLabel("on_hold")).toBe("On Hold")
    expect(statusLabel("onboarding")).toBe("Onboarding")
    expect(statusLabel("churned")).toBe("Churned")
  })

  it("returns dot+pill classes per status (smoke test, not asserting exact tailwind strings)", () => {
    for (const s of ["live", "on_hold", "onboarding", "churned"] as const) {
      const tone = statusTone(s)
      expect(tone.dot).toBeTruthy()
      expect(tone.pill).toBeTruthy()
    }
  })
})
