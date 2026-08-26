import { describe, it, expect } from "vitest"
import { isRocketLeadsAdAccount, ROCKET_LEADS_AD_ACCOUNT_ID } from "./ad-account"

describe("isRocketLeadsAdAccount", () => {
  it("matches the RL ad account id, with or without the act_ prefix", () => {
    expect(isRocketLeadsAdAccount(ROCKET_LEADS_AD_ACCOUNT_ID)).toBe(true)
    expect(isRocketLeadsAdAccount(`act_${ROCKET_LEADS_AD_ACCOUNT_ID}`)).toBe(true)
  })

  it("is false for other / empty / missing ids", () => {
    expect(isRocketLeadsAdAccount("123456789")).toBe(false)
    expect(isRocketLeadsAdAccount("")).toBe(false)
    expect(isRocketLeadsAdAccount(null)).toBe(false)
    expect(isRocketLeadsAdAccount(undefined)).toBe(false)
  })
})
