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
 * Used by `/api/pedro/auto-brief` (loads brief context) and
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

  // For each campaign row, prefer EXPLICITLY SAVED versions over the
  // draft state. Two-layer storage rule: drafts are private working
  // state - cross-call context should always read from saved versions
  // first. Falls back to draft only when nothing has been committed
  // yet (matches existing behaviour for legacy clients).
  const rows = data as unknown as PastCampaignRow[]
  for (const row of rows) {
    const { data: versions } = await supabase
      .from("pedro_stage_versions")
      .select("stage, data, version_number")
      .eq("client_id", clientId)
      .eq("campaign_number", row.campaign_number)
      .order("version_number", { ascending: false })

    if (!versions || versions.length === 0) continue

    // Take latest per stage. For each stage that has a saved version,
    // overwrite the draft slot in the row.
    const latestByStage = new Map<string, unknown>()
    for (const v of versions) {
      if (!latestByStage.has(v.stage)) latestByStage.set(v.stage, v.data)
    }

    const briefV = latestByStage.get("brief")
    if (briefV) row.brief = briefV as PastCampaignRow["brief"]
    const anglesV = latestByStage.get("angles")
    if (Array.isArray(anglesV)) row.selected_angles = anglesV as PastCampaignRow["selected_angles"]
    const scriptV = latestByStage.get("script")
    if (scriptV && typeof scriptV === "object" && "script_text" in (scriptV as object)) {
      row.script_text = (scriptV as { script_text?: string }).script_text ?? null
    }
    const creativesV = latestByStage.get("creatives")
    if (creativesV) row.creatives = creativesV as PastCampaignRow["creatives"]
    const lpV = latestByStage.get("lp")
    if (lpV) row.lp = lpV as PastCampaignRow["lp"]
    const adCopyV = latestByStage.get("ad-copy")
    if (adCopyV) row.ad_copy = adCopyV as PastCampaignRow["ad_copy"]
  }

  return rows
}

export function renderPastForStage(
  stage: PedroStage,
  past: PastCampaignRow[],
): string {
  if (past.length === 0) return ""

  const blocks: string[] = []

  for (const p of past) {
    const header = `[CAMPAGNE #${p.campaign_number} - laatst bijgewerkt ${p.updated_at?.slice(0, 10) ?? ""}]`
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

  return `\n\n=== EERDERE PEDRO CAMPAGNES VOOR DEZE KLANT ===\n${blocks.join("\n\n")}\n\nGEBRUIK DEZE CONTEXT:\n- Herhaal géén angles of openers die al getest zijn (tenzij ze bewezen winnen - dan bouw verder)\n- Houd tone of voice en ICP-framing consistent met eerdere campagnes\n- Als nieuwe context (bv. recente eval) afwijkt van wat hierboven staat, ga met de NIEUWE context mee - eerdere campagnes zijn referentie, niet wet\n- Bouw progressief: nieuwe iteratie moet aanvullend of tegenvoorstellend zijn op het bestaande\n=== EINDE EERDERE CAMPAGNES ===\n`
}

export async function pastContextForStage(
  clientId: string,
  stage: PedroStage,
  limit = 2,
): Promise<string> {
  const past = await loadPastCampaigns(clientId, limit)
  return renderPastForStage(stage, past)
}
