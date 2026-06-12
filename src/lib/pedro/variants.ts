import type { createAdminClient } from "@/lib/supabase/server"
import type { NamedProposal } from "./refresh-naming"

/**
 * Variant-outcome persistence + scoring for Pedro's learning loop.
 *
 * Two halves:
 *   - `fanOutVariantsToTable` - runs when a refresh persists. Writes one
 *     row per variant into `pedro_variants`, deduped on
 *     (client_id, ad_name). This is what makes the sync cron able to
 *     find the variant later.
 *   - `scoreVariantOutcome` - pure function the cron calls when a Meta
 *     match is found. Maps spend/leads/CPL to {winner|loser|neutral}.
 *
 * Roy 2026-06-09.
 */

type Supabase = Awaited<ReturnType<typeof createAdminClient>>

/**
 * Insert one `pedro_variants` row per variant in the proposals array.
 *
 * Roy 2026-06-12 bug fix: previously this used
 * `{ onConflict: "client_id,ad_name", ignoreDuplicates: true }`. Pedro's
 * ad_names are deterministic ("Photo 1 | <topic>") so a second refresh
 * on the same source ad SILENTLY DROPPED its rows. The enrich step
 * (which filters by the new refresh_id) found nothing → UI received
 * `variantId: null` → inline edits + image-gen were disabled.
 *
 * Fix: drop `ignoreDuplicates` and drop `outcome` from the payload.
 *   - On INSERT: row is created with outcome = DB default 'pending'.
 *   - On CONFLICT (client_id, ad_name): Supabase emits
 *     `DO UPDATE SET col = EXCLUDED.col` for each column in the payload.
 *     Since `outcome` (+ meta_ad_id, leads, spend, cpl, ctr,
 *     account_avg_cpl_at_sync) are NOT in the payload, they are
 *     preserved - so the learning history the cron wrote stays intact
 *     while the row's refresh_id + content fields get refreshed.
 *
 * Errors are caught + logged because a learning-loop write failure
 * should not tank the refresh response itself.
 */
export async function fanOutVariantsToTable(args: {
  supabase: Supabase
  refreshId: string
  clientId: string
  stage: "creatives" | "angles" | "script" | "ad_copy"
  proposals: NamedProposal[]
}): Promise<{ inserted: number }> {
  const rows: Array<Record<string, unknown>> = []
  for (const [pi, p] of args.proposals.entries()) {
    for (const [vi, v] of p.variants.entries()) {
      if (!v.adName) continue
      rows.push({
        refresh_id: args.refreshId,
        client_id: args.clientId,
        stage: args.stage,
        ad_name: v.adName,
        format_hint: v.formatHint,
        topic_label: v.topicLabel,
        proposal_index: pi,
        variant_index: vi,
        hook: v.newHook || null,
        script_outline: v.scriptOutline || null,
        primary_copy_snippet: v.primaryCopySnippet || null,
        // Stored on initial fan-out so the CM can "Genereer image"
        // without an extra round-trip to fetch the prompt back.
        image_prompt: v.imagePrompt || null,
        // Full Meta ad-copy package (Roy 2026-06-10). Pedro now writes
        // a primary headline + 2 alt headlines + 2 alt primary texts so
        // Push-to-Meta can launch a complete dynamic-creative ad in one
        // shot - no manual tuning in Ads Manager.
        headline: v.headline || null,
        alt_headlines: v.altHeadlines.length > 0 ? v.altHeadlines : null,
        alt_primary_texts: v.altPrimaryTexts.length > 0 ? v.altPrimaryTexts : null,
        link_description: v.linkDescription || null,
        // outcome intentionally omitted - see header comment.
      })
    }
  }
  if (rows.length === 0) return { inserted: 0 }

  try {
    const { error } = await args.supabase
      .from("pedro_variants")
      .upsert(rows, { onConflict: "client_id,ad_name" })
    if (error) throw error
    return { inserted: rows.length }
  } catch (e) {
    console.error(
      "[pedro/variants] fan-out failed:",
      e instanceof Error ? e.message : e,
    )
    return { inserted: 0 }
  }
}

// ─── Outcome scoring (pure) ─────────────────────────────────────────────

export type VariantOutcomeInput = {
  /** Spend on the matched Meta ad in the lookback window. */
  spend: number
  /** Leads attributed to the ad. */
  leads: number
  /** Computed cost-per-lead (or null when leads=0). */
  cpl: number | null
  /** Account-wide avg CPL at sync time - gives the verdict context. */
  accountAvgCpl: number | null
}

export type VariantOutcome = "winner" | "loser" | "neutral"

/**
 * Map a Meta-derived variant snapshot to a verdict. Same brackets as
 * `watchlist/categorize` so the LEARNING block reads consistent with
 * the Watch List the CM already trusts.
 *
 * Edge cases:
 *  - leads = 0 AND spend > €50 → loser (burning money, no result)
 *  - account_avg_cpl missing/zero → neutral (no anchor to compare against)
 *  - leads < 3 → neutral (too noisy to call)
 */
export function scoreVariantOutcome(input: VariantOutcomeInput): VariantOutcome {
  if (input.leads === 0 && input.spend > 50) return "loser"
  if (input.accountAvgCpl == null || input.accountAvgCpl <= 0) return "neutral"
  if (input.cpl == null) return "neutral"
  if (input.leads < 3) return "neutral"
  if (input.cpl <= 0.7 * input.accountAvgCpl) return "winner"
  if (input.cpl >= 1.4 * input.accountAvgCpl) return "loser"
  return "neutral"
}

/** Days since generation before we mark an unsync'd variant as
 *  `not_shipped`. Two weeks is enough that "AM will get to it Monday"
 *  blow-ups don't false-flag; longer than that means the CM either
 *  forgot or chose not to ship. */
export const NOT_SHIPPED_AFTER_DAYS = 14
