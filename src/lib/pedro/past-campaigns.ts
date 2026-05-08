import { createAdminClient } from "@/lib/supabase/server"

/**
 * Past-campaign context for Pedro. Every Pedro deliverable is stored in
 * `pedro_client_state` per (client_id, campaign_number). When a CM runs
 * Pedro on a returning client we load the most recent N campaigns and
 * compress them into stage-relevant text blocks so Claude can:
 *
 *  - avoid repeating angles / scripts / copy that already ran
 *  - build on what worked instead of starting from scratch
 *  - keep tone, USPs, ICP framing consistent across campaigns
 *
 * Used by `/api/pedro/auto-brief` (loads brief + angles for context) and
 * `/api/pedro/claude` (loads stage-relevant context per stage).
 */

export type PedroStage =
  | "brief"
  | "angles"
  | "script"
  | "creatives"
  | "lp"
  | "ad-copy"

type PastCampaignRow = {
  campaign_number: number
  brief: Record<string, unknown> | null
  selected_angles: Array<{ titel?: string; beschrijving?: string }> | null
  script_text: string | null
  creatives: { manusPrompt?: string; formats?: string[]; qty?: number } | null
  lp: { lpPrompt?: string; stijl?: string; lengte?: string } | null
  ad_copy: { variantA?: string; variantB?: string; headlines?: string } | null
  updated_at: string
}

function trim(s: string | null | undefined, max: number): string {
  if (!s) return ""
  return s.length <= max ? s : s.slice(0, max) + "…"
}

/**
 * Load the most recent N campaigns for a client (default 2). Pulls only
 * what's needed for context; safe to call from any Pedro endpoint.
 */
export async function loadPastCampaigns(
  clientId: string,
  limit = 2,
): Promise<PastCampaignRow[]> {
  if (!clientId) return []

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("pedro_client_state")
    .select(
      "campaign_number, brief, selected_angles, script_text, creatives, lp, ad_copy, updated_at",
    )
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(limit)

  if (error || !data) return []
  return data as unknown as PastCampaignRow[]
}

/**
 * Render a past-campaigns block tailored to a specific stage. Each stage
 * needs different context:
 *  - brief:    prior brief snapshot — tone, ICP framing, what changed
 *  - angles:   list of every angle we already tested (avoid repetition)
 *  - script:   prior script summaries (don't reuse openers)
 *  - creatives:prior Manus prompts (don't repeat formats/visual concepts)
 *  - lp:       prior LP styles + length (variation pressure)
 *  - ad-copy:  prior copy variants (avoid same hooks/CTAs)
 *
 * Returns "" when there are no past campaigns or nothing relevant for the
 * stage — caller can safely concatenate.
 */
export function renderPastForStage(
  stage: PedroStage,
  past: PastCampaignRow[],
): string {
  if (past.length === 0) return ""

  const blocks: string[] = []

  for (const p of past) {
    const header = `[CAMPAGNE #${p.campaign_number} — laatst bijgewerkt ${p.updated_at?.slice(0, 10) ?? ""}]`
    const parts: string[] = [header]

    if (stage === "brief" && p.brief) {
      const b = p.brief as Record<string, string>
      parts.push(
        `Brief van toen:\n` +
          `- Sector: ${trim(b.sector, 200)}\n` +
          `- Doelgroep: ${trim(b.doel ?? b.doelgroep, 400)}\n` +
          `- Pijnpunten: ${trim(b.pijn ?? b.pijnpunten, 400)}\n` +
          `- Aanbod: ${trim(b.aanbod, 400)}\n` +
          `- USPs: ${trim(b.usps, 400)}`,
      )
    }

    if (stage === "angles" && Array.isArray(p.selected_angles)) {
      const lines = p.selected_angles
        .filter((a) => a?.titel)
        .map((a) => `- "${a.titel}": ${trim(a.beschrijving ?? "", 200)}`)
      if (lines.length > 0) parts.push(`Eerder gekozen angles:\n${lines.join("\n")}`)
    }

    if (stage === "script" && p.script_text) {
      // Keep just the first chunk so Claude knows the opener/tone, not the full doc.
      parts.push(`Eerder script (eerste 600 chars):\n${trim(p.script_text, 600)}`)
    }

    if (stage === "creatives" && p.creatives?.manusPrompt) {
      parts.push(
        `Eerdere creatives: ${p.creatives.qty ?? "?"} stuks, formats ${(p.creatives.formats ?? []).join(", ") || "?"}.\n` +
          `Manus prompt (eerste 500 chars):\n${trim(p.creatives.manusPrompt, 500)}`,
      )
    }

    if (stage === "lp" && p.lp?.lpPrompt) {
      parts.push(
        `Eerdere LP: stijl ${p.lp.stijl ?? "?"}, lengte ${p.lp.lengte ?? "?"}.\n` +
          `Prompt (eerste 500 chars):\n${trim(p.lp.lpPrompt, 500)}`,
      )
    }

    if (stage === "ad-copy" && p.ad_copy) {
      const a = p.ad_copy
      parts.push(
        `Eerdere ad copy:\n` +
          `Variant A: ${trim(a.variantA, 400)}\n` +
          `Variant B: ${trim(a.variantB, 400)}\n` +
          `Headlines: ${trim(a.headlines, 200)}`,
      )
    }

    if (parts.length > 1) blocks.push(parts.join("\n"))
  }

  if (blocks.length === 0) return ""

  return `\n\n=== EERDERE PEDRO CAMPAGNES VOOR DEZE KLANT ===\n${blocks.join("\n\n")}\n\nGEBRUIK DEZE CONTEXT:\n- Herhaal géén angles of openers die al getest zijn (tenzij ze bewezen winnen — dan bouw verder)\n- Houd tone of voice en ICP-framing consistent met eerdere campagnes\n- Als nieuwe context (bv. recente eval) afwijkt van wat hierboven staat, ga met de NIEUWE context mee — eerdere campagnes zijn referentie, niet wet\n- Bouw progressief: nieuwe iteratie moet aanvullend of tegenvoorstellend zijn op het bestaande\n=== EINDE EERDERE CAMPAGNES ===\n`
}

/**
 * Convenience: load + render in one call. Server-side use only.
 */
export async function pastContextForStage(
  clientId: string,
  stage: PedroStage,
  limit = 2,
): Promise<string> {
  const past = await loadPastCampaigns(clientId, limit)
  return renderPastForStage(stage, past)
}
