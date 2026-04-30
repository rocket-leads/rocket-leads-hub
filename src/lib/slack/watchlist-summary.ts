import { categorize } from "@/lib/watchlist/categorize"
import type { MondayClient } from "@/lib/integrations/monday"
import type { KpiSummary } from "@/app/api/kpi-summaries/route"

const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL ?? "https://hub.rocketleads.com"

/**
 * Build the morning Slack DM body for a single user, given the clients
 * that user can see (already filtered by column mapping).
 */
export function buildWatchlistSummary(
  clients: MondayClient[],
  kpiMap: Record<string, KpiSummary>,
  userName: string | null,
): string {
  const action: string[] = []
  const watch: string[] = []
  let goodCount = 0
  let noDataCount = 0

  for (const client of clients) {
    const kpi = kpiMap[client.mondayItemId]
    const { category, insight } = categorize(client, kpi)
    if (category === "action") action.push(`• *${client.name}* — ${insight}`)
    else if (category === "watch") watch.push(`• ${client.name} — ${insight}`)
    else if (category === "good") goodCount++
    else noDataCount++
  }

  const firstName = (userName ?? "team").split(" ")[0]
  const lines: string[] = []
  lines.push(`🌅 Goedemorgen ${firstName}!`)
  lines.push("")

  if (action.length > 0) {
    lines.push(`🔴 *Action Needed — ${action.length} ${action.length === 1 ? "client" : "clients"}*`)
    lines.push(...action.slice(0, 8))
    if (action.length > 8) lines.push(`_…and ${action.length - 8} more_`)
    lines.push("")
  }

  if (watch.length > 0) {
    lines.push(`🟡 *Watch — ${watch.length} ${watch.length === 1 ? "client" : "clients"}*`)
    lines.push(...watch.slice(0, 6))
    if (watch.length > 6) lines.push(`_…and ${watch.length - 6} more_`)
    lines.push("")
  }

  if (action.length === 0 && watch.length === 0) {
    lines.push("✨ Geen urgente issues — alle accounts gezond.")
    lines.push("")
  }

  const summaryParts = [`🟢 ${goodCount} healthy`]
  if (noDataCount > 0) summaryParts.push(`⚪ ${noDataCount} idle`)
  lines.push(summaryParts.join(" · "))
  lines.push("")
  lines.push(`<${HUB_URL}/watchlist|→ View full watchlist>`)

  return lines.join("\n")
}
