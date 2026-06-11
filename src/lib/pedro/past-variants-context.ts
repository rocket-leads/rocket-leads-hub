import type { createAdminClient } from "@/lib/supabase/server"

/**
 * Past-variants context block - the LEARNING half of Pedro's loop.
 *
 * Reads `pedro_variants` (enriched daily by sync-pedro-variants cron)
 * and renders the client's previous Pedro-generated variants with
 * their real-world outcomes. The creative-refresh prompt then
 * instructs Pedro to:
 *   - DOUBLE DOWN on winner directions (same hook style, same topic)
 *   - AVOID loser directions (drop that topic, change hook category)
 *   - REWORK not-shipped variants (those didn't land - figure out why)
 *
 * Without this block the loop is open: Pedro proposes, never sees the
 * outcome, repeats mistakes. With it, every refresh gets smarter
 * because the prompt grows the empirical training set in place.
 *
 * Roy 2026-06-09.
 */

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

type PastVariantRow = {
  ad_name: string
  format_hint: "Photo" | "Video"
  topic_label: string
  hook: string | null
  outcome: "pending" | "winner" | "loser" | "neutral" | "not_shipped"
  spend: number | null
  leads: number | null
  cpl: number | null
  account_avg_cpl_at_sync: number | null
  generated_at: string
}

const LOOKBACK_DAYS = 60

/** Cap per outcome category so the block doesn't balloon. We want a
 *  representative sample of winners (to repeat) and losers (to avoid)
 *  without flooding the prompt. */
const MAX_PER_OUTCOME = 4

export async function pastVariantsContextBlock(
  supabase: Supabase,
  clientId: string,
): Promise<string> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString()

  const { data, error } = await supabase
    .from("pedro_variants")
    .select(
      "ad_name, format_hint, topic_label, hook, outcome, spend, leads, cpl, account_avg_cpl_at_sync, generated_at",
    )
    .eq("client_id", clientId)
    .gte("generated_at", since)
    .order("generated_at", { ascending: false })
    .limit(50)

  if (error || !data || data.length === 0) return ""

  const rows = data as PastVariantRow[]
  const winners: PastVariantRow[] = []
  const losers: PastVariantRow[] = []
  const notShipped: PastVariantRow[] = []
  for (const r of rows) {
    if (r.outcome === "winner" && winners.length < MAX_PER_OUTCOME) winners.push(r)
    else if (r.outcome === "loser" && losers.length < MAX_PER_OUTCOME) losers.push(r)
    else if (r.outcome === "not_shipped" && notShipped.length < MAX_PER_OUTCOME) notShipped.push(r)
  }

  if (winners.length === 0 && losers.length === 0 && notShipped.length === 0) {
    // Everything's pending - nothing to learn from yet.
    return ""
  }

  function renderRow(r: PastVariantRow): string {
    const cplStr = r.cpl != null ? `€${r.cpl.toFixed(2)} CPL` : "n/a CPL"
    const leadsStr = r.leads != null ? `${r.leads} leads` : "0 leads"
    const baseline =
      r.account_avg_cpl_at_sync != null && r.account_avg_cpl_at_sync > 0
        ? ` (vs account-avg €${r.account_avg_cpl_at_sync.toFixed(2)})`
        : ""
    const hookLine = r.hook ? `\n    Hook was: "${r.hook.replace(/\s+/g, " ").slice(0, 140)}"` : ""
    return `  - "${r.ad_name}" - ${cplStr}, ${leadsStr}${baseline}${hookLine}`
  }

  const blocks: string[] = []
  blocks.push(`PAST PEDRO VARIANTS - jouw eerdere proposals voor DEZE klant + uitkomst (laatste ${LOOKBACK_DAYS}d):`)

  if (winners.length > 0) {
    blocks.push(`WINNERS (CPL ≤ 70% van account-gemiddelde, ≥3 leads - herhaal dit DNA):`)
    blocks.push(winners.map(renderRow).join("\n"))
  }
  if (losers.length > 0) {
    blocks.push(`LOSERS (te duur of geen leads - vermijd deze richting):`)
    blocks.push(losers.map(renderRow).join("\n"))
  }
  if (notShipped.length > 0) {
    blocks.push(`NIET GESHIPT (CM heeft deze niet gebruikt - ad name werd niet gevonden in Meta):`)
    blocks.push(
      notShipped
        .slice(0, MAX_PER_OUTCOME)
        .map((r) => `  - "${r.ad_name}" (${r.topic_label})`)
        .join("\n"),
    )
  }

  blocks.push(
    `LEARNING INSTRUCTIE:
- WINNERS hierboven zijn jouw empirische bewijs van wat werkt op DEZE klant. Je nieuwe proposals moeten in dezelfde DNA itereren (zelfde format, zelfde topic-richting, zelfde hook-stijl) waar het kan.
- LOSERS zijn ook bewijs: stop met proposals in die richting tenzij je een hele andere insteek hebt.
- NIET GESHIPT is feedback dat je topic-keuze of hook niet aantrekkelijk genoeg was om door de CM op te pakken. Maak nieuwe proposals herkenbaarder/scherper, geen variaties op dezelfde niet-geshipte richting.`,
  )

  return blocks.join("\n")
}
