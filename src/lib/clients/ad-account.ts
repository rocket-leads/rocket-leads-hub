export const ROCKET_LEADS_AD_ACCOUNT_ID = "846284186180613"

export function isRocketLeadsAdAccount(metaAdAccountId: string | null | undefined): boolean {
  if (!metaAdAccountId) return false
  const clean = metaAdAccountId.replace(/^act_/, "")
  return clean === ROCKET_LEADS_AD_ACCOUNT_ID
}

/**
 * Whether the ad budget should be INVOICED to the client - true only when
 * Rocket Leads fronts the media spend (ads run through OUR account, so we
 * pay Meta and bill it back). This reads Monday's "Ad account" status column
 * (`color` on the current board, `color5` on onboarding), whose options are
 * "Rocket Leads" / "Client" / "Partner" / "To be determined".
 *
 * Only "Rocket Leads" triggers an ad-budget invoice line. "Client" (client
 * pays Meta directly) and "Partner" (a partner account) both mean RL does NOT
 * front the spend, so nothing is invoiced for ads. This is the authoritative
 * payer signal - distinct from `isRocketLeadsAdAccount`, which matches the raw
 * ad-account ID text field and is often blank/unreliable.
 */
export function adBudgetInvoicedByRocketLeads(adAccountPayer: string | null | undefined): boolean {
  return (adAccountPayer ?? "").trim().toLowerCase() === "rocket leads"
}
