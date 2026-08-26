import { describe, it, expect } from "vitest"
import { isInvoicedAdmin, ADMIN_LABELS } from "./administration"

describe("isInvoicedAdmin", () => {
  it("is true for the 'Invoice sent (unpaid)' family (drops from the send list)", () => {
    expect(isInvoicedAdmin(ADMIN_LABELS.invoiceSend)).toBe(true) // "Invoice sent (unpaid)"
    expect(isInvoicedAdmin("Invoice sent")).toBe(true) // onboarding subitem variant
    expect(isInvoicedAdmin("  invoice sent (unpaid)  ")).toBe(true) // tolerant of case/space
  })

  it("is false for statuses a genuinely-upcoming client can still carry", () => {
    // Not excluded - excluding these would hide invoices that still need sending.
    expect(isInvoicedAdmin(ADMIN_LABELS.sendInvoice)).toBe(false)
    expect(isInvoicedAdmin(ADMIN_LABELS.paymentsComplete)).toBe(false)
    expect(isInvoicedAdmin(ADMIN_LABELS.partiallyPaid)).toBe(false)
    expect(isInvoicedAdmin(ADMIN_LABELS.discussFirst)).toBe(false)
    expect(isInvoicedAdmin(ADMIN_LABELS.onHold)).toBe(false)
    expect(isInvoicedAdmin(ADMIN_LABELS.overdue)).toBe(false)
    expect(isInvoicedAdmin("")).toBe(false)
    expect(isInvoicedAdmin(null)).toBe(false)
    expect(isInvoicedAdmin(undefined)).toBe(false)
  })
})
