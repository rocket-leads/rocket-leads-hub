"use client"

import { ApiTokensTab } from "./api-tokens-tab"
import { HealthTab } from "./health-tab"
import { EnvPosturePanel } from "./env-posture-panel"
import type { EnvPostureItem } from "@/lib/observability/env-posture"

/**
 * Integrations = the single home for "are our external connections alive?".
 *
 * Before the 2026-07 regroup this was split across three surfaces that all read
 * the same `api_tokens` rows: the API Tokens tab (the editable list), the
 * always-on ApiHealthBar at the top of Settings, and the Health tab's own
 * integrations table. That meant three places to check whether Meta/Stripe/etc.
 * were broken. Now there is one:
 *
 *   Connections  → the 11 service tokens (save + test + live status dot)
 *   System       → environment secrets posture (env vars loaded/missing) +
 *                  crons, migrations and Hub-feature rollups (the old Health tab)
 */
export function IntegrationsTab({
  statuses,
  envPosture,
}: {
  statuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  envPosture: EnvPostureItem[]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="st-label mb-3">Connections</h2>
        <ApiTokensTab statuses={statuses} />
      </section>

      <section>
        <h2 className="st-label mb-3">System</h2>
        <div className="space-y-6">
          <EnvPosturePanel items={envPosture} />
          <HealthTab />
        </div>
      </section>
    </div>
  )
}
