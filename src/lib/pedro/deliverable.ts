import type { SupabaseClient } from "@supabase/supabase-js"
import { loadLatestSavedVersion, type SavedVersionRow } from "@/lib/pedro/saved-versions"

/**
 * Per-client Pedro deliverable assembler.
 *
 * Reads the latest saved version of each stage out of pedro_stage_versions
 * and bakes them into one human-readable markdown document. This is the
 * "Deliverable #1" we hand to the client - a single doc covering brief,
 * research, angles, script, creatives, LP and ad copy, with per-section
 * version provenance so the CM can tell at a glance "built from brief v3,
 * lp v2".
 *
 * Stage versions are the source of truth - this assembly is purely a
 * baked rendering. Re-generating after a stage edit is cheap and safe.
 */

type Brief = {
  bedrijf?: string
  sector?: string
  doel?: string
  pijn?: string
  aanbod?: string
  usps?: string
  hooksAM?: string
  hooksExtra?: string
}

type Angle = { nummer: number; titel: string; beschrijving: string }

type ScriptVideo = {
  angle?: string
  hooks?: string[]
  body?: string
  cta?: string
}

type ScriptData = { script_text?: string; script_videos?: ScriptVideo[] }

type CreativesData = {
  qty?: number
  formats?: string[]
  driveLink?: string
  brandbookName?: string
  huisstijl?: string
  manusPrompt?: string
}

type LpData = {
  stijl?: string
  lengte?: string
  pixelId?: string
  webhookUrl?: string
  utmStr?: string
  lpPrompt?: string
}

type AdCopyData = {
  variantA?: string
  variantB?: string
  headlines?: string
  beschrijving?: string
}

export type DeliverableMetadata = {
  brief_version: number | null
  research_version: number | null
  angles_version: number | null
  script_version: number | null
  creatives_version: number | null
  lp_version: number | null
  ad_copy_version: number | null
}

export type DeliverableResult = {
  contentMd: string
  metadata: DeliverableMetadata
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function provenanceLine(row: SavedVersionRow | null, fallback: string): string {
  if (!row) return `_${fallback}_`
  return `_Versie ${row.version_number} - opgeslagen ${fmtDate(row.saved_at)}${row.label ? ` · ${row.label}` : ""}_`
}

function renderBrief(row: SavedVersionRow | null, clientName: string): string {
  const data = (row?.data ?? {}) as Brief
  const lines: string[] = ["## 1. Brief", provenanceLine(row, "Nog niet opgeslagen"), ""]
  const fields: Array<[string, string | undefined]> = [
    ["Bedrijf", data.bedrijf || clientName],
    ["Sector", data.sector],
    ["Doelgroep", data.doel],
    ["Pijnpunt", data.pijn],
    ["Aanbod", data.aanbod],
    ["USP's", data.usps],
    ["Hooks (kick-off)", data.hooksAM],
    ["Hooks (extra)", data.hooksExtra],
  ]
  for (const [label, value] of fields) {
    if (value && value.trim()) {
      lines.push(`**${label}:** ${value.trim()}`)
    }
  }
  return lines.join("\n") + "\n"
}

function renderResearch(row: SavedVersionRow | null): string {
  if (!row) return `## 2. Research\n_Nog geen research opgeslagen voor deze campagne._\n`
  // Research payload shape varies - render as fenced JSON for transparency
  // rather than guessing keys. The CM rarely shows research to clients
  // anyway; this is mostly internal reference.
  const json = JSON.stringify(row.data, null, 2)
  return `## 2. Research\n${provenanceLine(row, "")}\n\n\`\`\`json\n${json}\n\`\`\`\n`
}

function renderAngles(row: SavedVersionRow | null): string {
  if (!row) return `## 3. Marketing angles\n_Nog geen angles opgeslagen._\n`
  const data = (row.data ?? []) as Angle[]
  const lines: string[] = ["## 3. Marketing angles", provenanceLine(row, ""), ""]
  for (const a of data) {
    lines.push(`### Angle ${a.nummer}: ${a.titel}`)
    lines.push(a.beschrijving)
    lines.push("")
  }
  return lines.join("\n")
}

function renderScript(row: SavedVersionRow | null): string {
  if (!row) return `## 4. Video scripts\n_Geen scripts opgeslagen - stap overgeslagen of nog niet uitgevoerd._\n`
  const data = (row.data ?? {}) as ScriptData
  const lines: string[] = ["## 4. Video scripts", provenanceLine(row, ""), ""]
  const videos = data.script_videos ?? []
  if (videos.length === 0 && data.script_text) {
    lines.push("```")
    lines.push(data.script_text)
    lines.push("```")
    return lines.join("\n") + "\n"
  }
  videos.forEach((v, i) => {
    lines.push(`### Video ${i + 1}${v.angle ? ` - ${v.angle}` : ""}`)
    if (v.hooks && v.hooks.length > 0) {
      lines.push("**Hooks:**")
      v.hooks.forEach((h, hi) => lines.push(`${hi + 1}. ${h}`))
    }
    if (v.body) {
      lines.push("\n**Body:**")
      lines.push(v.body)
    }
    if (v.cta) {
      lines.push("\n**CTA:**")
      lines.push(v.cta)
    }
    lines.push("")
  })
  return lines.join("\n")
}

function renderCreatives(row: SavedVersionRow | null): string {
  if (!row) return `## 5. Creatives (Manus prompt)\n_Nog geen Manus prompt opgeslagen._\n`
  const data = (row.data ?? {}) as CreativesData
  const lines: string[] = ["## 5. Creatives (Manus prompt)", provenanceLine(row, ""), ""]
  if (data.qty || data.formats?.length) {
    lines.push(`**Aantal:** ${data.qty ?? "?"}  ·  **Formaten:** ${(data.formats ?? []).join(", ") || "-"}`)
  }
  if (data.driveLink) lines.push(`**Drive:** ${data.driveLink}`)
  if (data.brandbookName) lines.push(`**Brandbook:** ${data.brandbookName}`)
  if (data.huisstijl) {
    lines.push(`\n**Huisstijl notes:**`)
    lines.push(data.huisstijl)
  }
  if (data.manusPrompt) {
    lines.push("\n### Volledige Manus prompt\n")
    lines.push("```")
    lines.push(data.manusPrompt)
    lines.push("```")
  }
  return lines.join("\n") + "\n"
}

function renderLp(row: SavedVersionRow | null): string {
  if (!row) return `## 6. Landingspagina (Lovable prompt)\n_Nog geen LP opgeslagen._\n`
  const data = (row.data ?? {}) as LpData
  const lines: string[] = ["## 6. Landingspagina (Lovable prompt)", provenanceLine(row, ""), ""]
  const meta: string[] = []
  if (data.stijl) meta.push(`**Stijl:** ${data.stijl}`)
  if (data.lengte) meta.push(`**Lengte:** ${data.lengte}`)
  if (data.pixelId) meta.push(`**Meta Pixel:** ${data.pixelId}`)
  if (data.webhookUrl) meta.push(`**Webhook:** ${data.webhookUrl}`)
  if (data.utmStr) meta.push(`**UTM:** ${data.utmStr}`)
  if (meta.length > 0) lines.push(meta.join("  ·  "))
  if (data.lpPrompt) {
    lines.push("\n### Volledige Lovable prompt\n")
    lines.push("```")
    lines.push(data.lpPrompt)
    lines.push("```")
  }
  return lines.join("\n") + "\n"
}

function renderAdCopy(row: SavedVersionRow | null): string {
  if (!row) return `## 7. Ad copy (Meta)\n_Nog geen ad copy opgeslagen._\n`
  const data = (row.data ?? {}) as AdCopyData
  const lines: string[] = ["## 7. Ad copy (Meta)", provenanceLine(row, ""), ""]
  if (data.variantA) {
    lines.push("### Primaire tekst - variant A")
    lines.push(data.variantA)
    lines.push("")
  }
  if (data.variantB) {
    lines.push("### Primaire tekst - variant B")
    lines.push(data.variantB)
    lines.push("")
  }
  if (data.headlines) {
    lines.push("### Headlines")
    lines.push("```")
    lines.push(data.headlines)
    lines.push("```")
  }
  if (data.beschrijving) {
    lines.push("### Beschrijvingen")
    lines.push("```")
    lines.push(data.beschrijving)
    lines.push("```")
  }
  return lines.join("\n") + "\n"
}

/**
 * Reads the latest saved version of every stage for (clientId,
 * campaignNumber) and assembles them into a single markdown document.
 * Missing stages are noted inline rather than omitted so the CM (and
 * the receiving client) can see which steps were skipped or pending.
 */
export async function assembleDeliverable(
  supabase: SupabaseClient,
  clientId: string,
  clientName: string,
  campaignNumber: number = 1,
): Promise<DeliverableResult> {
  // Research is stored in pedro_stage_versions under the literal "research"
  // value (migration 20240036 allows it) but PedroStage's TS union excludes
  // it because it's never an input to /api/pedro/claude. Cast through here
  // since the DB-side check constraint accepts the value.
  const researchStage = "research" as unknown as Parameters<typeof loadLatestSavedVersion>[2]
  const [brief, research, angles, script, creatives, lp, adCopy] = await Promise.all([
    loadLatestSavedVersion(supabase, clientId, "brief", campaignNumber),
    loadLatestSavedVersion(supabase, clientId, researchStage, campaignNumber),
    loadLatestSavedVersion(supabase, clientId, "angles", campaignNumber),
    loadLatestSavedVersion(supabase, clientId, "script", campaignNumber),
    loadLatestSavedVersion(supabase, clientId, "creatives", campaignNumber),
    loadLatestSavedVersion(supabase, clientId, "lp", campaignNumber),
    loadLatestSavedVersion(supabase, clientId, "ad-copy", campaignNumber),
  ])

  const generatedAt = new Date().toLocaleString("nl-NL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  const header = `# Pedro Campaign Deliverable - ${clientName}

> Campagne ${campaignNumber} · Gegenereerd op ${generatedAt}
>
> Dit document bundelt alle output van de Pedro AI campagne-pipeline:
> brief, research, marketing angles, video scripts, creative briefs,
> landingspagina-prompt en ad copy. Elke sectie toont van welke
> opgeslagen versie hij gebouwd is.

---

`

  const sections = [
    renderBrief(brief, clientName),
    renderResearch(research),
    renderAngles(angles),
    renderScript(script),
    renderCreatives(creatives),
    renderLp(lp),
    renderAdCopy(adCopy),
  ].join("\n---\n\n")

  return {
    contentMd: header + sections,
    metadata: {
      brief_version: brief?.version_number ?? null,
      research_version: research?.version_number ?? null,
      angles_version: angles?.version_number ?? null,
      script_version: script?.version_number ?? null,
      creatives_version: creatives?.version_number ?? null,
      lp_version: lp?.version_number ?? null,
      ad_copy_version: adCopy?.version_number ?? null,
    },
  }
}
