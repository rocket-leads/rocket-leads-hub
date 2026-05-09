import type { Angle, BrandStyle } from "@/lib/pedro/helpers"
import type { ClientData } from "@/lib/pedro/client-database"

/**
 * Pure context helpers shared by every stage prompt.
 *
 * Each one returns a string fragment that the builder can splice into
 * its template. Empty string when the input is missing — never null —
 * so prompts can use unconditional `${...}` interpolation without
 * branching on undefined.
 *
 * These were inline in `pedro-campaign.tsx` as closures over component
 * state. Pulling them out so the prompt builders can be tested without
 * mounting the whole React tree, and so the same context shape can be
 * reused by future server-side prompt callers (e.g. a future Pedro
 * batch endpoint).
 */

export function anglesString(selected: Angle[]): string {
  return selected.map((a) => `- "${a.titel}": ${a.beschrijving}`).join("\n")
}

export function scriptContext(opts: { script: string; scriptSkipped: boolean }): string {
  if (opts.scriptSkipped || !opts.script) return ""
  return `\nVideo script context:\n${opts.script.substring(0, 800)}`
}

export function styleReference(metaStyleRef: string | null | undefined): string {
  if (!metaStyleRef) return ""
  return `\n\nAltijd baseer nieuwe creatives op de stijl en structuur van deze bestaande Rocket Leads campagnes (toon, hook-formaat, visuele compositie):\n${metaStyleRef}\n\nVoeg creatieve variatie en frisse ideeën toe bovenop deze basis.`
}

type HuisstijlOpts = {
  brandStyle: BrandStyle | null | undefined
  huisstijl: string | null | undefined
  huisstijlOverride: boolean
}

/**
 * Default huisstijl block — used by angles / script / ad-copy prompts.
 * When the AM has overridden via the manual textarea, that's authoritative.
 * Otherwise we render the structured BrandStyle if extracted from the
 * client website. Final fallback: any free-text the AM did paste.
 */
export function huisstijlContext(opts: HuisstijlOpts): string {
  if (opts.huisstijlOverride && opts.huisstijl) {
    return `\nHuisstijl klant: ${opts.huisstijl}`
  }
  if (!opts.brandStyle) {
    return opts.huisstijl ? `\nHuisstijl klant: ${opts.huisstijl}` : ""
  }
  const bs = opts.brandStyle
  return `\nClient brand style (geëxtraheerd van hun website):
- Primaire kleur: ${bs.primaryColor}
- Secundaire kleur: ${bs.secondaryColor}
- Toon: ${bs.tone}
- Visuele stijl: ${bs.visualStyle}
- Brand keywords: ${bs.brandKeywords}`
}

/**
 * Variant for the Manus creatives prompt — adds the explicit instruction
 * "use this as the visual basis for the creatives".
 */
export function huisstijlForManus(opts: HuisstijlOpts): string {
  if (opts.huisstijlOverride && opts.huisstijl) {
    return `\nHuisstijl klant: ${opts.huisstijl}\nGebruik dit als visuele basis voor de creatives.`
  }
  if (!opts.brandStyle) {
    return opts.huisstijl
      ? `\nHuisstijl klant: ${opts.huisstijl}\nGebruik dit als visuele basis voor de creatives.`
      : ""
  }
  const bs = opts.brandStyle
  return `\nClient brand style (geëxtraheerd van hun website):
- Primaire kleur: ${bs.primaryColor}
- Toon: ${bs.tone}
- Visuele stijl: ${bs.visualStyle}
- Brand keywords: ${bs.brandKeywords}
Gebruik dit als visuele basis voor de creatives.`
}

/**
 * Variant for the Lovable LP prompt — emphasises matching brand identity
 * rather than visual creative basis.
 */
export function huisstijlForLp(opts: HuisstijlOpts): string {
  if (opts.huisstijlOverride && opts.huisstijl) {
    return `\nHuisstijl klant: ${opts.huisstijl}`
  }
  if (!opts.brandStyle) {
    return opts.huisstijl ? `\nHuisstijl klant: ${opts.huisstijl}` : ""
  }
  const bs = opts.brandStyle
  return `\nMatch de bestaande merkidentiteit van de klant:
- Primaire kleur: ${bs.primaryColor}, secundair: ${bs.secondaryColor}
- Toon: ${bs.tone}
- Visuele stijl: ${bs.visualStyle}`
}

/**
 * Tail-of-prompt reference back to the most recent Manus prompt for this
 * client — keeps creatives visually consistent across refreshes. Reads
 * the last campaign in the client DB and truncates from the end so the
 * output spec (which lives at the bottom of past prompts) is preserved.
 */
export function previousManusReference(clientDB: ClientData | null | undefined): string {
  if (!clientDB || clientDB.campaigns.length === 0) return ""
  const lastPrompt = [...clientDB.campaigns]
    .reverse()
    .find((c) => c.manusPrompt && c.manusPrompt !== "-")?.manusPrompt
  if (!lastPrompt) return ""
  const truncated = lastPrompt.length > 1500 ? lastPrompt.substring(lastPrompt.length - 1500) : lastPrompt
  return `\n\nPrevious creative direction for this client (maintain visual consistency):\n${truncated}`
}
