import { describe, it, expect } from "vitest"
import { calculateKpis } from "./kpis"
import type { MondayLeadItem } from "@/lib/integrations/monday"

/**
 * Date-window inclusion regression. Monday's GraphQL `text` for a date+time
 * column returns "2026-05-17 06:50:00", not "2026-05-17". A naive lexicographic
 * compare drops every item on the end date because the trailing time sorts
 * after the YYYY-MM-DD endpoint — silently undercounting leads on the most
 * recent day in any window. The Zenovo report (Hub 17 vs Monday 24 for
 * May 11–17) was this exact bug surfacing.
 */

function item(overrides: Partial<MondayLeadItem>): MondayLeadItem {
  return {
    id: "1",
    name: "Lead",
    dateCreated: "",
    dateAppointment: "",
    leadStatus: "",
    leadStatus2: "",
    dealValue: 0,
    utm: "",
    dateDeal: "",
    ...overrides,
  }
}

describe("calculateKpis date-window inclusion", () => {
  const start = "2026-05-11"
  const end = "2026-05-17"

  it("includes a lead with a pure date on the end date", () => {
    const k = calculateKpis(0, [item({ dateCreated: "2026-05-17" })], start, end, "Afspraak")
    expect(k.leads).toBe(1)
  })

  it("includes a lead with a date+time on the end date (the Zenovo bug)", () => {
    const k = calculateKpis(
      0,
      [item({ dateCreated: "2026-05-17 06:50:00" })],
      start,
      end,
      "Afspraak",
    )
    expect(k.leads).toBe(1)
  })

  it("includes a lead with a date+time late on the end date", () => {
    const k = calculateKpis(
      0,
      [item({ dateCreated: "2026-05-17 23:59:59" })],
      start,
      end,
      "Afspraak",
    )
    expect(k.leads).toBe(1)
  })

  it("includes a lead with an ISO-T datetime on the end date", () => {
    const k = calculateKpis(
      0,
      [item({ dateCreated: "2026-05-17T06:50:00Z" })],
      start,
      end,
      "Afspraak",
    )
    expect(k.leads).toBe(1)
  })

  it("includes a lead with a date+time on the start date", () => {
    const k = calculateKpis(
      0,
      [item({ dateCreated: "2026-05-11 00:01:00" })],
      start,
      end,
      "Afspraak",
    )
    expect(k.leads).toBe(1)
  })

  it("excludes a lead one day past the end date even with no time", () => {
    const k = calculateKpis(0, [item({ dateCreated: "2026-05-18" })], start, end, "Afspraak")
    expect(k.leads).toBe(0)
  })

  it("excludes a lead one day before the start date", () => {
    const k = calculateKpis(0, [item({ dateCreated: "2026-05-10 23:59:59" })], start, end, "Afspraak")
    expect(k.leads).toBe(0)
  })

  it("excludes items with empty dateCreated", () => {
    const k = calculateKpis(0, [item({ dateCreated: "" })], start, end, "Afspraak")
    expect(k.leads).toBe(0)
  })

  it("excludes items with unparseable dateCreated (garbage in -> not counted)", () => {
    const k = calculateKpis(0, [item({ dateCreated: "not a date" })], start, end, "Afspraak")
    expect(k.leads).toBe(0)
  })

  it("normalizes appointment, deal, and UTM-breakdown dates the same way", () => {
    // One lead created on the end-date with a time, an appointment on the
    // end-date with a time, and a deal on the end-date with a time. All three
    // should land in the window — pre-fix only the lead one would have made it
    // (and not even that one).
    const k = calculateKpis(
      0,
      [
        item({
          dateCreated: "2026-05-17 06:50:00",
          dateAppointment: "2026-05-17 14:30:00",
          dateDeal: "2026-05-17 18:00:00",
          leadStatus2: "Afspraak",
          dealValue: 500,
          utm: "campaign-a",
        }),
      ],
      start,
      end,
      "Afspraak",
    )
    expect(k.leads).toBe(1)
    expect(k.bookedCalls).toBe(1)
    expect(k.takenCalls).toBe(1)
    expect(k.deals).toBe(1)
    expect(k.revenue).toBe(500)
    expect(k.utmBreakdown).toHaveLength(1)
    expect(k.utmBreakdown[0]).toMatchObject({
      utm: "campaign-a",
      leads: 1,
      bookedCalls: 1,
      takenCalls: 1,
      deals: 1,
      revenue: 500,
    })
  })

  it("aggregates a realistic mix where 6 of the leads land on the end date with times", () => {
    // Mirrors the Zenovo case: 18 earlier-week leads (pure date) + 6 May-17
    // leads with timestamps. Pre-fix the Hub returned 18; post-fix it returns
    // the full 24.
    const earlier = Array.from({ length: 18 }, (_, i) =>
      item({ id: `e${i}`, dateCreated: "2026-05-13" }),
    )
    const may17 = [
      "2026-05-17 06:50:00",
      "2026-05-17 11:05:00",
      "2026-05-17 13:33:00",
      "2026-05-17 15:18:00",
      "2026-05-17 16:15:00",
      "2026-05-17 16:50:00",
    ].map((d, i) => item({ id: `m${i}`, dateCreated: d }))

    const k = calculateKpis(0, [...earlier, ...may17], start, end, "Afspraak")
    expect(k.leads).toBe(24)
  })
})
