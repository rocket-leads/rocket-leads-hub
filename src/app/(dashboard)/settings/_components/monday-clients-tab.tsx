"use client"

import { BoardConfigTab } from "./board-config-tab"
import { ClientsTab } from "./clients-tab"

/**
 * Monday & Clients = every Monday-canonical config in one place. Before the
 * 2026-07 regroup this was two tabs: Board Config (board IDs + column mappings
 * + webhooks) and Clients (the per-client connection audit). They belong
 * together — the column mappings are what the audit reads to know where each
 * client's IDs live.
 *
 *   Board configuration → board IDs, column mappings, webhook registration
 *   Client connections   → the per-client connection audit (the strictness
 *                          workstream: needs-linking, broken links, N/A marks)
 */
export function MondayClientsTab({
  config,
  defaults,
}: {
  config: React.ComponentProps<typeof BoardConfigTab>["config"]
  defaults: React.ComponentProps<typeof BoardConfigTab>["defaults"]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="st-label mb-3">Client connections</h2>
        <ClientsTab />
      </section>

      <section>
        <h2 className="st-label mb-3">Board configuration</h2>
        <BoardConfigTab config={config} defaults={defaults} />
      </section>
    </div>
  )
}
