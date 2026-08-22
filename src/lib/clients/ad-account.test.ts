import { describe, it, expect } from "vitest"
import { adBudgetInvoicedByRocketLeads, isRocketLeadsAdAccount } from "./ad-account"

describe("adBudgetInvoicedByRocketLeads", () => {
  it("invoices only when the payer is Rocket Leads", () => {
    expect(adBudgetInvoicedByRocketLeads("Rocket Leads")).toBe(true)
    // Tolerant of casing / stray whitespace from Monday's status text.
    expect(adBudgetInvoicedByRocketLeads("  rocket leads ")).toBe(true)
  })

  it("does NOT invoice for Client / Partner / unset payers", () => {
    expect(adBudgetInvoicedByRocketLeads("Client")).toBe(false)
    expect(adBudgetInvoicedByRocketLeads("Partner")).toBe(false)
    expect(adBudgetInvoicedByRocketLeads("To be determined")).toBe(false)
    expect(adBudgetInvoicedByRocketLeads("")).toBe(false)
    expect(adBudgetInvoicedByRocketLeads(null)).toBe(false)
    expect(adBudgetInvoicedByRocketLeads(undefined)).toBe(false)
  })

  it("is a distinct signal from the raw ad-account-id match", () => {
    // The payer status can say Rocket Leads even when the AdAcc ID text is
    // blank (the exact reason the ID-based check was unreliable for billing).
    expect(adBudgetInvoicedByRocketLeads("Rocket Leads")).toBe(true)
    expect(isRocketLeadsAdAccount("")).toBe(false)
  })
})
