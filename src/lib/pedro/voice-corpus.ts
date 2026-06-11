import type { MetaAdDetail } from "@/lib/integrations/meta"

/**
 * Pedro client voice corpus builder.
 *
 * Roy 2026-06-11: klanten zijn vaak picky op hoe hun product/dienst
 * beschreven wordt. Zumex praat over "sappenautomaat", "verse sappen",
 * "Nederlandse service" - Pedro mag NIET een "sappenmachine" of
 * "sapmachine" verzinnen. Dit blok bouwt een vocabulary-anchor uit alle
 * ads die de klant in het verleden gedraaid heeft.
 *
 * Strategie:
 *  1. Pull bodies/titles/descriptions uit alle ads in het venster
 *     (default: 180 dagen - vaak hebben klanten in 30d maar 2-3 ads
 *     gehad).
 *  2. Dedupe op normalized text.
 *  3. Cap totale corpus op ~3500 chars zodat de prompt niet bloated.
 *  4. Format als geannoteerd blok dat Pedro instrueert om dit als
 *     vocabulary-wet te behandelen - geen vrije variatie op
 *     productnamen of dienstomschrijvingen.
 */

/** Normalize whitespace + drop very short / boilerplate strings. */
function normalize(text: string | null | undefined): string {
  if (!text) return ""
  return text.replace(/\s+/g, " ").trim()
}

/** Heuristic: drop strings that are too short (<15 chars) - usually
 *  truncations or non-informative. */
function meaningful(text: string): boolean {
  return text.length >= 15
}

/**
 * Build the voice corpus block for the prompt. Returns "" when there's
 * nothing usable - caller's prompt then skips the section gracefully.
 */
export function buildVoiceCorpus(
  ads: MetaAdDetail[],
  options: { maxChars?: number } = {},
): string {
  if (ads.length === 0) return ""
  const maxChars = options.maxChars ?? 3500

  // Collect unique texts. Use a Map keyed on the lowercased trimmed
  // version so casing differences merge.
  const bodies = new Map<string, string>()
  const titles = new Map<string, string>()
  const descriptions = new Map<string, string>()

  for (const ad of ads) {
    const body = normalize(ad.body)
    if (meaningful(body)) bodies.set(body.toLowerCase(), body)
    const title = normalize(ad.title)
    if (meaningful(title)) titles.set(title.toLowerCase(), title)
    const desc = normalize(ad.description)
    if (meaningful(desc)) descriptions.set(desc.toLowerCase(), desc)
    // asset_feed_spec dynamic creatives → extra bodies/titles in
    // assetFeedSummary. Parse them out best-effort: lines like
    // `    1. "actual text"` and `    2. "..."`.
    if (ad.assetFeedSummary) {
      const quoted = ad.assetFeedSummary.matchAll(/"([^"]{15,800})"/g)
      for (const m of quoted) {
        const t = normalize(m[1])
        if (meaningful(t)) bodies.set(t.toLowerCase(), t)
      }
    }
  }

  // Compose block, capped at maxChars.
  const sections: string[] = []
  if (titles.size > 0) {
    sections.push(
      `Headlines die de klant gebruikt:\n${[...titles.values()]
        .map((t) => `- "${t}"`)
        .join("\n")}`,
    )
  }
  if (bodies.size > 0) {
    sections.push(
      `Primary copy die de klant gebruikt (woordkeuze + opbouw):\n${[...bodies.values()]
        .map((b) => `- "${b}"`)
        .join("\n")}`,
    )
  }
  if (descriptions.size > 0) {
    sections.push(
      `Link descriptions die de klant gebruikt:\n${[...descriptions.values()]
        .map((d) => `- "${d}"`)
        .join("\n")}`,
    )
  }
  if (sections.length === 0) return ""

  const raw = sections.join("\n\n")
  const truncated =
    raw.length > maxChars
      ? raw.slice(0, maxChars) + "\n[…corpus afgekapt voor token budget]"
      : raw

  return `KLANT VOICE CORPUS - woordkeuze + productnamen die deze klant zelf gebruikt in advertenties van de afgelopen periode. Hou je strikt aan deze terminologie wanneer je over het product/dienst spreekt. Gebruik NIET een woord dat hier niet voorkomt om het product te beschrijven (bv. als de klant "sappenautomaat" zegt, gebruik je nooit "sappenmachine" of "sapmachine"). Je mag wel creatief zijn met hooks/angles/openers - maar product- en dienstomschrijvingen moeten woord-voor-woord matchen.

${truncated}`
}
