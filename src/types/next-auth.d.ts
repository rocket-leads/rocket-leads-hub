import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      image?: string
      role: "admin" | "member" | "guest"
      /** True when this user has a `finance` row in `user_column_mappings`.
       *  Drives the finance-tailored sidebar (no Watch List, billing surfaced)
       *  and unlocks finance-only automations. Independent of access role. */
      isFinance: boolean
    }
  }
}
