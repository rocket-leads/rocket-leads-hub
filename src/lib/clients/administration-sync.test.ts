import { describe, it, expect } from "vitest"
import { targetAdminStatus, type AdminSyncInput } from "./administration-sync"
import {
  ADMIN_LABELS,
  shouldAutoWriteAdministration,
} from "./administration"

/**
 * `targetAdminStatus` is the brain of the admin-column auto-sync - it decides
 * which label the Hub should TRY to write to Monday given the latest Stripe
 * state + campaign status + cycle date. `shouldAutoWriteAdministration` is
 * the gate that decides whether the write is ACTUALLY allowed (preserving
 * finance's manual flags). These tests pin both because their behaviour is
 * load-bearing for finance UX: a wrong precedence call would silently retag
 * a held client as "Send invoice", an over-eager overwrite would erase a
 * "Discuss first" flag finance just set.
 */

function makeInput(overrides: Partial<AdminSyncInput> = {}): AdminSyncInput {
  return {
    campaignStatus: "live",
    stripe: null,
    nextInvoiceDate: null,
    currentAdministration: "",
    today: "2026-05-19",
    ...overrides,
  }
}

describe("targetAdminStatus", () => {
  it("returns On hold when the campaign is on hold, regardless of Stripe / cycle", () => {
    const input = makeInput({
      campaignStatus: "on_hold",
      stripe: { status: "overdue" },
      nextInvoiceDate: "2026-05-19",
    })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.onHold)
  })

  it("returns Overdue when Stripe says overdue", () => {
    const input = makeInput({ stripe: { status: "overdue" } })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.overdue)
  })

  it("Stripe overdue beats cycle-reached → Send invoice", () => {
    const input = makeInput({
      stripe: { status: "overdue" },
      nextInvoiceDate: "2026-05-19",
    })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.overdue)
  })

  it("returns Invoice sent when Stripe has an open invoice", () => {
    const input = makeInput({ stripe: { status: "open" } })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.invoiceSend)
  })

  it("returns Send invoice when cycle date is today + no Stripe activity", () => {
    const input = makeInput({ nextInvoiceDate: "2026-05-19" })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.sendInvoice)
  })

  it("returns Send invoice when cycle date is in the past + no Stripe activity", () => {
    const input = makeInput({ nextInvoiceDate: "2026-05-10" })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.sendInvoice)
  })

  it("returns null when cycle date is still in the future + no Stripe activity", () => {
    const input = makeInput({ nextInvoiceDate: "2026-06-01" })
    expect(targetAdminStatus(input)).toBeNull()
  })

  it("returns Payments complete when Stripe says complete + no other signal", () => {
    const input = makeInput({ stripe: { status: "complete" } })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.paymentsComplete)
  })

  it("cycle-reached beats Stripe complete (next cycle is due even if past is paid)", () => {
    const input = makeInput({
      stripe: { status: "complete" },
      nextInvoiceDate: "2026-05-19",
    })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.sendInvoice)
  })

  it("returns null when nothing is happening (live, no Stripe, no cycle reached)", () => {
    expect(targetAdminStatus(makeInput())).toBeNull()
  })

  it("Hub-status `null` falls back to Stripe-driven targets (no on-hold override)", () => {
    const input = makeInput({
      campaignStatus: null,
      stripe: { status: "open" },
    })
    expect(targetAdminStatus(input)).toBe(ADMIN_LABELS.invoiceSend)
  })
})

describe("shouldAutoWriteAdministration", () => {
  it("Invoice sent always overwrites (Roy: Stripe shipping is objective fact)", () => {
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.discussFirst, ADMIN_LABELS.invoiceSend),
    ).toBe(true)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.debtCollection, ADMIN_LABELS.invoiceSend),
    ).toBe(true)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.overdue, ADMIN_LABELS.invoiceSend),
    ).toBe(true)
  })

  it("non-Invoice-sent targets do NOT overwrite manual flags", () => {
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.discussFirst, ADMIN_LABELS.overdue),
    ).toBe(false)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.discussFirst, ADMIN_LABELS.paymentsComplete),
    ).toBe(false)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.debtCollection, ADMIN_LABELS.sendInvoice),
    ).toBe(false)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.debtCollection, ADMIN_LABELS.onHold),
    ).toBe(false)
  })

  it("auto-managed values transition between themselves freely", () => {
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.invoiceSend, ADMIN_LABELS.overdue),
    ).toBe(true)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.overdue, ADMIN_LABELS.paymentsComplete),
    ).toBe(true)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.paymentsComplete, ADMIN_LABELS.sendInvoice),
    ).toBe(true)
  })

  it("empty current value never blocks a write", () => {
    expect(shouldAutoWriteAdministration("", ADMIN_LABELS.invoiceSend)).toBe(true)
    expect(shouldAutoWriteAdministration("", ADMIN_LABELS.overdue)).toBe(true)
    expect(shouldAutoWriteAdministration("   ", ADMIN_LABELS.sendInvoice)).toBe(true)
  })

  it("same-value writes return false (no Monday churn)", () => {
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.overdue, ADMIN_LABELS.overdue),
    ).toBe(false)
    expect(
      shouldAutoWriteAdministration(ADMIN_LABELS.invoiceSend, ADMIN_LABELS.invoiceSend),
    ).toBe(false)
  })

  it("case-insensitive on the current value (Monday case drift shouldn't trigger writes)", () => {
    expect(
      shouldAutoWriteAdministration("INVOICE SENT (UNPAID)", ADMIN_LABELS.invoiceSend),
    ).toBe(false)
    expect(
      shouldAutoWriteAdministration("discuss first", ADMIN_LABELS.overdue),
    ).toBe(false)
  })
})
