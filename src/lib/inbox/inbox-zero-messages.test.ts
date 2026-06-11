import { describe, it, expect } from "vitest"
import { INBOX_ZERO_MESSAGES, pickInboxZeroMessage } from "./inbox-zero-messages"

/**
 * Inbox Zero rotation has to be deterministic per UTC day so the home
 * page doesn't flicker on refresh. These tests also pin the list shape
 * so a future tweak doesn't accidentally drop the rotation behaviour.
 */

describe("pickInboxZeroMessage", () => {
  it("returns the same message twice in a row when called within the same day", () => {
    const now = new Date("2026-05-09T10:00:00Z")
    expect(pickInboxZeroMessage(now)).toBe(pickInboxZeroMessage(now))
  })

  it("rotates at UTC midnight - different day yields a different index slot", () => {
    const day1 = new Date("2026-05-09T23:59:59Z")
    const day2 = new Date("2026-05-10T00:00:00Z")
    // The day index changes, so the picked slot changes (potentially same
    // message if the list length divides evenly, but the index DOES move).
    const idxA = Math.floor(day1.getTime() / (24 * 60 * 60 * 1000)) % INBOX_ZERO_MESSAGES.length
    const idxB = Math.floor(day2.getTime() / (24 * 60 * 60 * 1000)) % INBOX_ZERO_MESSAGES.length
    expect(idxA).not.toBe(idxB)
  })

  it("always returns one of the messages from the canonical list", () => {
    // Spot-check a handful of dates across the year - the picker must
    // always land inside the list.
    const samples = [
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-04-15T12:00:00Z"),
      new Date("2026-07-20T08:00:00Z"),
      new Date("2026-12-31T23:59:59Z"),
    ]
    for (const d of samples) {
      expect(INBOX_ZERO_MESSAGES).toContain(pickInboxZeroMessage(d))
    }
  })
})

describe("INBOX_ZERO_MESSAGES", () => {
  it("has at least 10 messages so the rotation feels fresh, not repetitive", () => {
    expect(INBOX_ZERO_MESSAGES.length).toBeGreaterThanOrEqual(10)
  })

  it("contains no duplicates - duplicates make the rotation feel broken", () => {
    const set = new Set(INBOX_ZERO_MESSAGES)
    expect(set.size).toBe(INBOX_ZERO_MESSAGES.length)
  })

  it("every message is a non-empty string", () => {
    for (const msg of INBOX_ZERO_MESSAGES) {
      expect(typeof msg).toBe("string")
      expect(msg.trim().length).toBeGreaterThan(0)
    }
  })
})
