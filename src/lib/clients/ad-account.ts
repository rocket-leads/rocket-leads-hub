export const ROCKET_LEADS_AD_ACCOUNT_ID = "846284186180613"

export function isRocketLeadsAdAccount(metaAdAccountId: string | null | undefined): boolean {
  if (!metaAdAccountId) return false
  const clean = metaAdAccountId.replace(/^act_/, "")
  return clean === ROCKET_LEADS_AD_ACCOUNT_ID
}
