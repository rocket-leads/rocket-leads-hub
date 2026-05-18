import { describe, it, expect } from "vitest"
import {
  categorize,
  severityScore,
  getRecentSignal,
  getThresholds,
  detectLiveButDark,
  LIVE_BUT_DARK_SEVERITY_FLOOR,
} from "./categorize"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

/**
 * categorize() is the single source of truth shared between the cron
 * (writes the watchlist_client_state table) and the UI (renders the
 * Watch List). A regression here flips every client into the wrong
 * bucket on the next cron tick — the kind of silent, dashboard-wide
 * break that's expensive to notice and worse to roll back.
 *
 * Coverage focus: bucket boundaries (action / watch / good / no-data),
 * the recent-window override (7d says action but 1-3d recovered), and
 * the tiered thresholds keyed on 7d ad spend.
 */

// ─── Fixture helpers ─────────────────────────────────────────────────────

function makeClient(overrides: Partial<MondayClient> = {}): MondayClient {
  return {
    mondayItemId: "1",
    name: "Test Client",
    firstName: "Test",
    companyName: "Test BV",
    accountManager: "AM",
    campaignManager: "CM",
    appointmentSetter: "Setter",
    campaignStatus: "Live",
    kickOffDate: "",
    adBudget: "1000",
    serviceFee: "1000",
    followUpFee: "",
    followUpStatus: "",
    metaConnected: "",
    metaAdAccountId: "act_999",
    stripeCustomerId: "cus_test",
    trengoContactId: "",
    clientBoardId: "",
    googleDriveId: "",
    cycleStartDate: "",
    nextInvoiceDate: "",
    boardType: "current",
    ...overrides,
  } as MondayClient
}

function makeKpi(overrides: Partial<KpiSummary> = {}): KpiSummary {
  return {
    adSpend: 700,
    leads: 20,
    cpl: 35,
    appointments: 3,
    costPerAppointment: 233.33,
    prevCpl: 30,
    prevCostPerAppointment: 200,
    prevPeriodReliable: true,
    mondayCrmConnected: true,
    ...overrides,
  }
}

/** Build a 14-day daily trend with constant spend/leads on each day. */
function constantTrend(days: number, spend: number, leads: number) {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, "0")}`,
    spend,
    leads,
  }))
}

// ─── No-data branches ────────────────────────────────────────────────────

describe("categorize — no-data", () => {
  it("returns no-data with the RL-specific reason when the flag is set", () => {
    const result = categorize(makeClient(), makeKpi({ rlAccountNoCampaign: true }))
    expect(result.category).toBe("no-data")
    expect(result.insight).toMatch(/no campaigns selected/i)
  })

  it("returns no-data when there is no Meta ad account configured", () => {
    const result = categorize(makeClient({ metaAdAccountId: "" }), makeKpi())
    expect(result.category).toBe("no-data")
    expect(result.insight).toMatch(/no meta ad account/i)
  })

  it("returns no-data when both spend and leads are zero", () => {
    const result = categorize(makeClient(), makeKpi({ adSpend: 0, leads: 0 }))
    expect(result.category).toBe("no-data")
    expect(result.insight).toMatch(/no spend or leads/i)
  })

  it("returns no-data when KPI is missing entirely", () => {
    const result = categorize(makeClient(), undefined)
    expect(result.category).toBe("no-data")
  })
})

// ─── Action: zero-leads-with-spend ───────────────────────────────────────

describe("categorize — zero leads with spend", () => {
  it("flips to action when spend > 50 and leads = 0", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 100, leads: 0, cpl: 0, prevCpl: 0 }),
    )
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/0 leads/)
  })

  it("does NOT flip to action when spend <= 50 (too small to be a clean signal)", () => {
    // Spend 40 with 0 leads doesn't meet the threshold — falls through to
    // the CPL trend logic. With prevCpl=0 the CPL branch evaluates as good.
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 40, leads: 0, cpl: 0, prevCpl: 0 }),
    )
    expect(result.category).not.toBe("action")
  })
})

// ─── CPL trend bucketing ─────────────────────────────────────────────────

describe("categorize — CPL trend", () => {
  it("good when CPL is stable and there are leads", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 20, cpl: 35, prevCpl: 35 }),
    )
    expect(result.category).toBe("good")
  })

  it("good with strong CPL drop", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 20, cpl: 20, prevCpl: 40 }),
    )
    expect(result.category).toBe("good")
    expect(result.insight).toMatch(/dropped/i)
  })

  it("watch when CPL rises above the watch threshold but below action", () => {
    // 7d adSpend 700 → tier { watchPct: 10, actionPct: 30 } (250-1000 bracket)
    // CPL 35 vs 30 = +16.67% → watch but not action.
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 20, cpl: 35, prevCpl: 30 }),
    )
    expect(result.category).toBe("watch")
    expect(result.insight).toMatch(/CPL rising/)
  })

  it("action when CPL crosses the action threshold", () => {
    // adSpend 700 → action threshold 30%. 50 vs 30 = +66.67% → action.
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 14, cpl: 50, prevCpl: 30 }),
    )
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/CPL up/)
  })

  it("good when there's no comparable prevCpl", () => {
    // Newly-launched account: no prev → can't compute %, so we trust
    // current numbers and show "good" with at least some leads.
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 20, cpl: 35, prevCpl: 0 }),
    )
    expect(result.category).toBe("good")
  })
})

// ─── Recent-window override ──────────────────────────────────────────────

describe("categorize — recent-window override (action → watch on recovery)", () => {
  it("demotes action to watch when recent CPL is back at the prev-7d baseline", () => {
    const dailyTrend = [
      ...constantTrend(11, 50, 1), // older days: high CPL drove the 7d signal
      ...constantTrend(3, 30, 3), // last 3 days: 3 leads at €10 CPL = recovery
    ]
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 14, cpl: 50, prevCpl: 30, dailyTrend }),
    )
    expect(result.category).toBe("watch")
    expect(result.insight).toMatch(/recovered/i)
  })

  it("keeps action when recent CPL is still elevated", () => {
    const dailyTrend = [
      ...constantTrend(11, 50, 1),
      ...constantTrend(3, 100, 1), // last 3 days still bad: €100 CPL
    ]
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 14, cpl: 50, prevCpl: 30, dailyTrend }),
    )
    expect(result.category).toBe("action")
  })
})

describe("categorize — recent-window override (good → watch on fresh spike)", () => {
  it("promotes good to watch when last 1-3d shows a fresh CPL spike", () => {
    // 7d window must read as "good" so the override is the only thing
    // pushing this to watch. cpl 14 vs prevCpl 13 is +7.7% — under the
    // watchPct=10 threshold (mid spend band). dailyTrend is independent
    // from the 7d totals — its last-3-days slice is what triggers the
    // fresh-spike branch.
    const dailyTrend = [
      ...constantTrend(11, 50, 4),
      // Last 3d: 3 × €100 spend, 1 lead each ⇒ €300 spend / 3 leads = €100 CPL.
      // 100 ≥ 1.5× prev-7d baseline (13 × 1.5 = 19.5) AND recentSpend ≥ €30.
      { date: "2026-05-12", spend: 100, leads: 1 },
      { date: "2026-05-13", spend: 100, leads: 1 },
      { date: "2026-05-14", spend: 100, leads: 1 },
    ]
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 50, cpl: 14, prevCpl: 13, dailyTrend }),
    )
    expect(result.category).toBe("watch")
    expect(result.insight).toMatch(/fresh CPL spike/i)
  })
})

// ─── Locale-aware insight strings ────────────────────────────────────────

describe("categorize — locale-aware insight strings", () => {
  it("defaults to English when no locale is passed (back-compat for AI prompts)", () => {
    const result = categorize(makeClient(), makeKpi({ adSpend: 100, leads: 0, cpl: 0, prevCpl: 0 }))
    expect(result.insight).toContain("spent")
    expect(result.insight).toContain("0 leads")
  })

  it("returns Dutch insight when locale='nl'", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 100, leads: 0, cpl: 0, prevCpl: 0 }),
      "nl",
    )
    expect(result.insight).toContain("uitgegeven")
    expect(result.insight).toContain("0 leads")
  })

  it("Dutch CPL up phrasing", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 14, cpl: 50, prevCpl: 30 }),
      "nl",
    )
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/CPL omhoog/i)
    expect(result.insight).toContain("vorige 7d")
  })

  it("Dutch CPL stable phrasing — within +/-10% band", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 20, cpl: 35, prevCpl: 35 }),
      "nl",
    )
    expect(result.category).toBe("good")
    expect(result.insight).toMatch(/CPL stabiel op €35\.00/i)
  })

  it("Dutch RL no-campaign reason", () => {
    const result = categorize(makeClient(), makeKpi({ rlAccountNoCampaign: true }), "nl")
    expect(result.category).toBe("no-data")
    expect(result.insight).toMatch(/geen campagnes geselecteerd/i)
  })

  it("Dutch 'no Meta ad account configured' reason", () => {
    const result = categorize(makeClient({ metaAdAccountId: "" }), makeKpi(), "nl")
    expect(result.insight).toMatch(/Geen Meta ad account/i)
  })

  it("Dutch 'running — no leads yet' phrasing", () => {
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 30, leads: 0, cpl: 0, prevCpl: 0 }),
      "nl",
    )
    expect(result.insight).toMatch(/Loopt — nog geen leads/i)
  })

  it("Dutch recent-window recovery phrasing", () => {
    const dailyTrend = [
      ...constantTrend(11, 50, 1),
      ...constantTrend(3, 30, 3),
    ]
    const result = categorize(
      makeClient(),
      makeKpi({ adSpend: 700, leads: 14, cpl: 50, prevCpl: 30, dailyTrend }),
      "nl",
    )
    expect(result.category).toBe("watch")
    expect(result.insight).toMatch(/CPL hersteld/i)
    expect(result.insight).toMatch(/Monitoren\./i)
  })
})

// ─── Tiered thresholds ───────────────────────────────────────────────────

describe("getThresholds — tiered by 7d ad spend", () => {
  it("uses the small-account band <€250 (15/40)", () => {
    expect(getThresholds(0)).toEqual({ watchPct: 15, actionPct: 40 })
    expect(getThresholds(249.99)).toEqual({ watchPct: 15, actionPct: 40 })
  })

  it("uses the mid band €250–€999 (10/30)", () => {
    expect(getThresholds(250)).toEqual({ watchPct: 10, actionPct: 30 })
    expect(getThresholds(999.99)).toEqual({ watchPct: 10, actionPct: 30 })
  })

  it("uses the high band ≥€1000 (5/20)", () => {
    expect(getThresholds(1000)).toEqual({ watchPct: 5, actionPct: 20 })
    expect(getThresholds(50_000)).toEqual({ watchPct: 5, actionPct: 20 })
  })
})

// ─── getRecentSignal ─────────────────────────────────────────────────────

describe("getRecentSignal — shortest trustworthy window", () => {
  it("returns null when there's no daily trend", () => {
    expect(getRecentSignal(makeKpi())).toBeNull()
  })

  it("picks 1d when last day has ≥2 leads and >€0 spend", () => {
    const dailyTrend = [
      ...constantTrend(13, 50, 1),
      { date: "2026-05-14", spend: 100, leads: 5 },
    ]
    const sig = getRecentSignal(makeKpi({ dailyTrend }))
    expect(sig?.windowDays).toBe(1)
    expect(sig?.recentLeads).toBe(5)
    expect(sig?.recentCpl).toBe(20)
  })

  it("falls through to 2d window when 1d has too few leads", () => {
    const dailyTrend = [
      ...constantTrend(12, 50, 1),
      { date: "2026-05-13", spend: 50, leads: 2 },
      { date: "2026-05-14", spend: 50, leads: 1 },
    ]
    const sig = getRecentSignal(makeKpi({ dailyTrend }))
    // 1d window: 1 lead (insufficient). 2d: 3 leads, €100 spend ⇒ pick 2d.
    expect(sig?.windowDays).toBe(2)
    expect(sig?.recentLeads).toBe(3)
  })

  it("returns null when even 3d doesn't reach 2 leads", () => {
    const dailyTrend = [
      ...constantTrend(11, 50, 1),
      { date: "2026-05-12", spend: 50, leads: 0 },
      { date: "2026-05-13", spend: 50, leads: 1 },
      { date: "2026-05-14", spend: 50, leads: 0 },
    ]
    const sig = getRecentSignal(makeKpi({ dailyTrend }))
    expect(sig).toBeNull()
  })
})

// ─── severityScore ───────────────────────────────────────────────────────

describe("severityScore — ranks Action/Watch by € impact", () => {
  it("3× multiplier for zero-leads-with-spend (pure waste)", () => {
    const score = severityScore(makeKpi({ adSpend: 200, leads: 0 }))
    expect(score).toBe(600) // 200 × 3
  })

  it("scales spend by max(cplDelta% / 30, 1)", () => {
    // CPL +60% over baseline → 60/30 = 2× multiplier.
    const score = severityScore(
      makeKpi({ adSpend: 1000, leads: 10, cpl: 80, prevCpl: 50 }),
    )
    expect(score).toBe(2000) // 1000 × 2
  })

  it("clamps the multiplier at 1× when CPL barely moved", () => {
    // CPL +5% → would be 0.17×, clamped to 1×.
    const score = severityScore(
      makeKpi({ adSpend: 1000, leads: 10, cpl: 52.5, prevCpl: 50 }),
    )
    expect(score).toBe(1000)
  })

  it("halves the score when recent window shows recovery", () => {
    const dailyTrend = [
      ...constantTrend(11, 50, 1),
      ...constantTrend(3, 30, 3), // recent CPL €10, baseline €50 ⇒ recovered
    ]
    const score = severityScore(
      makeKpi({ adSpend: 1000, leads: 14, cpl: 80, prevCpl: 50, dailyTrend }),
    )
    // Without recovery: 1000 × max(60/30, 1) = 2000. Halved: 1000.
    expect(score).toBe(1000)
  })
})

// ─── Live-but-dark trigger ───────────────────────────────────────────────

/** Build a dailyTrend whose last entry sits at `yesterdayDate` and the rest
 *  walk backwards from there. Lets tests construct deterministic "yesterday
 *  was €0 spend" fixtures without leaning on Date.now(). */
function trendEndingOn(yesterdayDate: string, days: Array<{ spend: number; leads: number }>) {
  const end = new Date(yesterdayDate + "T00:00:00Z").getTime()
  return days.map((d, i) => ({
    date: new Date(end - (days.length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    spend: d.spend,
    leads: d.leads,
  }))
}

describe("detectLiveButDark", () => {
  const now = new Date("2026-05-18T07:00:00Z") // yesterday = 2026-05-17
  const yesterday = "2026-05-17"

  it("fires when status=Live and yesterday's spend is exactly 0", () => {
    const kpi = makeKpi({
      adSpend: 700,
      dailyTrend: trendEndingOn(yesterday, [
        { spend: 100, leads: 5 },
        { spend: 100, leads: 5 },
        { spend: 0, leads: 0 },
      ]),
    })
    expect(detectLiveButDark(kpi, { clientStatus: "live", now })).toBe(true)
  })

  it("does NOT fire when status is on_hold (manually paused — expected)", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    expect(detectLiveButDark(kpi, { clientStatus: "on_hold", now })).toBe(false)
  })

  it("does NOT fire when status is onboarding", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    expect(detectLiveButDark(kpi, { clientStatus: "onboarding", now })).toBe(false)
  })

  it("does NOT fire when extras is omitted (back-compat)", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    expect(detectLiveButDark(kpi, undefined)).toBe(false)
  })

  it("does NOT fire when yesterday's spend is >0", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 5, leads: 0 }]),
    })
    expect(detectLiveButDark(kpi, { clientStatus: "live", now })).toBe(false)
  })

  it("does NOT fire when dailyTrend is missing (kpi cache absent — can't tell)", () => {
    expect(detectLiveButDark(undefined, { clientStatus: "live", now })).toBe(false)
    expect(detectLiveButDark(makeKpi({ dailyTrend: undefined }), { clientStatus: "live", now })).toBe(false)
  })

  it("does NOT fire when last dailyTrend entry isn't actually yesterday (stale cron)", () => {
    // Last entry is two days ago — cron didn't run yesterday, so we don't trust it.
    const twoDaysAgo = "2026-05-16"
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(twoDaysAgo, [{ spend: 0, leads: 0 }]),
    })
    expect(detectLiveButDark(kpi, { clientStatus: "live", now })).toBe(false)
  })
})

describe("categorize — live-but-dark override", () => {
  const now = new Date("2026-05-18T07:00:00Z")
  const yesterday = "2026-05-17"

  it("forces action with the live-but-dark insight when the trigger fires", () => {
    const kpi = makeKpi({
      adSpend: 700,
      leads: 20,
      dailyTrend: trendEndingOn(yesterday, [
        { spend: 100, leads: 5 },
        { spend: 100, leads: 5 },
        { spend: 0, leads: 0 },
      ]),
    })
    const result = categorize(makeClient(), kpi, "en", { clientStatus: "live", now })
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/campaign likely paused/i)
  })

  it("returns the Dutch insight when locale='nl'", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    const result = categorize(makeClient(), kpi, "nl", { clientStatus: "live", now })
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/staat waarschijnlijk uit/i)
  })

  it("beats the no-data branch — fires even when 7d spend AND leads are zero", () => {
    // A client that's been completely off for a week would normally sink into
    // no-data; live-but-dark surfaces it as urgent instead.
    const kpi = makeKpi({
      adSpend: 0,
      leads: 0,
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    const result = categorize(makeClient(), kpi, "en", { clientStatus: "live", now })
    expect(result.category).toBe("action")
    expect(result.insight).toMatch(/campaign likely paused/i)
  })

  it("does NOT override no-data when the client has no Meta ad account", () => {
    const kpi = makeKpi({
      dailyTrend: trendEndingOn(yesterday, [{ spend: 0, leads: 0 }]),
    })
    const result = categorize(
      makeClient({ metaAdAccountId: "" }),
      kpi,
      "en",
      { clientStatus: "live", now },
    )
    expect(result.category).toBe("no-data")
  })
})

describe("severityScore — live-but-dark floor", () => {
  const now = new Date("2026-05-18T07:00:00Z")
  const yesterday = "2026-05-17"

  it("applies the floor when the trigger fires (sorts above CPL-spike severity)", () => {
    const kpi = makeKpi({
      adSpend: 700,
      leads: 20,
      cpl: 35,
      prevCpl: 30,
      dailyTrend: trendEndingOn(yesterday, [
        { spend: 100, leads: 5 },
        { spend: 0, leads: 0 },
      ]),
    })
    expect(severityScore(kpi, { clientStatus: "live", now })).toBe(LIVE_BUT_DARK_SEVERITY_FLOOR)
  })

  it("keeps the existing CPL-spike score when not live-but-dark", () => {
    const kpi = makeKpi({ adSpend: 1000, leads: 10, cpl: 80, prevCpl: 50 })
    // Extras absent → original logic: 1000 × max(60/30, 1) = 2000.
    expect(severityScore(kpi)).toBe(2000)
  })
})
