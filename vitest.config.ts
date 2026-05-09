import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

/**
 * Foundation-only test config — pure business logic + helpers, no React,
 * no DOM. Test surface is intentionally small: the high-impact, easy-to-
 * verify functions whose silent breakage would corrupt the whole product
 * (categorize, severityScore, agreementMonthly, mondayStatusToHub,
 * isPrevPeriodReliable, etc).
 *
 * Component / integration testing is deliberately out of scope. The cost
 * of mocking Next.js + Supabase + Claude SDKs vs the value of those tests
 * is bad — the foundation tests catch the real regressions.
 */
export default defineConfig({
  test: {
    // Co-located *.test.ts next to source files. Keeps tests obvious and
    // discoverable without a parallel /tests dir.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
})
