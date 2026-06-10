/**
 * Pedro refresh — Rocket Leads ad-naming convention.
 *
 * Per knowledge/campaigns.md:
 *   - Campaign:  RL | {{country}} | {{initials}} | {{company}} | {{LF/LP}}
 *   - Ad set:    {{LF/LP}} | Open targeting | {{date}}
 *   - **Ad**:    Photo/Video {{nr}} | {{Topic creative}}
 *
 * This is the bridge that lets Pedro later learn which generated
 * creatives worked: when the CM ships an ad named "Video 7 | Subsidie",
 * Meta's UTM ties incoming leads back to that ad. The same name lives
 * in `pedro_refreshes.envelope.proposals[].variants[].adName` so we can
 * join: ad performance ←→ Pedro proposal that birthed it.
 *
 * Roy 2026-06-09: "die add name moet je één op één kunnen kopiëren."
 */

export type AdFormatHint = "Photo" | "Video"

/**
 * Parse the trailing number per format from existing ads on the account.
 * Example input names:
 *   - "Photo 3 | Pricelist"           → format=Photo, n=3
 *   - "Video 12 | Guarantee subsidie" → format=Video, n=12
 *   - "Static creative 5"             → no match
 *
 * Returns the MAX number found per format. Used to derive the next number
 * for newly proposed variants. Defaults to 0 when no ads match (so the
 * first new variant becomes "Video 1 | …").
 */
export function getMaxAdNumberByFormat(
  adNames: Iterable<string>,
): Record<AdFormatHint, number> {
  const max: Record<AdFormatHint, number> = { Photo: 0, Video: 0 }
  // Anchored at the start so "Photo carousel 2" doesn't pollute the count.
  // Number is the bare integer between "Photo "/"Video " and the next
  // separator (pipe or end of name).
  const re = /^(Photo|Video)\s+(\d+)\b/i
  for (const name of adNames) {
    const m = name.match(re)
    if (!m) continue
    const fmt = (m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) as AdFormatHint
    const n = parseInt(m[2], 10)
    if (Number.isFinite(n) && n > max[fmt]) max[fmt] = n
  }
  return max
}

/**
 * Assemble a canonical RL ad name. Topic is trimmed + collapsed to a
 * single line, no double pipes (would confuse a future parser).
 */
export function formatAdName(args: {
  format: AdFormatHint
  number: number
  topic: string
}): string {
  const topic = (args.topic || "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "/")
    .trim()
    || "Untitled"
  return `${args.format} ${args.number} | ${topic}`
}

/** Variant shape after we've assigned an adName. Reused across the
 *  generation flow + the inbox/Drive renderers. */
export type NamedVariant = {
  label: string
  /** Canonical name per the convention. CM copies this 1:1 into Meta. */
  adName: string
  formatHint: AdFormatHint
  topicLabel: string
  newHook: string
  scriptOutline: string
  primaryCopySnippet: string
  /** Primary Meta headline — pijnpunt-vraag, max ~27 char zichtbaar.
   *  Pedro genereert vanaf 2026-06-10 een aparte short headline naast
   *  de hook (de hook is langer en wordt opener van primary text). */
  headline: string
  /** 2 extra headlines voor dynamic creative — Meta laat tot 5 toe;
   *  we leveren er 3 (primary + 2 alts) zodat Meta tests kan draaien. */
  altHeadlines: string[]
  /** 2 extra primary text varianten voor dynamic creative. */
  altPrimaryTexts: string[]
  /** Optionele link description (~30 char). Mag leeg blijven —
   *  Roy 2026-06-10. */
  linkDescription: string
  /** English visual brief for the image-gen call (Gemini Nano Banana
   *  Pro). Pedro writes this; the CM optionally edits before regen. */
  imagePrompt: string
  why: string
}

export type NamedProposal = {
  basedOnAd: {
    adId: string
    adName: string
    cpl: number | null
    verdict: string
  }
  preserve: { hook: string; angle: string; format: string }
  variants: NamedVariant[]
}

/**
 * Take Pedro's raw variants (with format/topic hints but no number yet)
 * and assign sequential adName values per format. Numbers are taken
 * from `nextByFormat` and incremented as we go, so the returned variants
 * are unique across the whole refresh run.
 *
 * Mutates `nextByFormat` in place so the caller can chain across
 * multiple proposals (Photo 5, Photo 6, Photo 7…).
 */
export function assignAdNamesToVariants(
  variants: Array<{
    label?: unknown
    formatHint?: unknown
    topicLabel?: unknown
    newHook?: unknown
    scriptOutline?: unknown
    primaryCopySnippet?: unknown
    headline?: unknown
    altHeadlines?: unknown
    altPrimaryTexts?: unknown
    linkDescription?: unknown
    imagePrompt?: unknown
    why?: unknown
  }>,
  nextByFormat: Record<AdFormatHint, number>,
): NamedVariant[] {
  const result: NamedVariant[] = []
  // Helper: turn an unknown into a clean string[] of max length, dropping
  // empties and trimming whitespace. Keeps the JSON parser tolerant when
  // Pedro returns a single string or skips the field entirely.
  const asStringArray = (raw: unknown, max: number): string[] => {
    if (!Array.isArray(raw)) return []
    const out: string[] = []
    for (const v of raw) {
      if (typeof v !== "string") continue
      const trimmed = v.replace(/\s+/g, " ").trim()
      if (trimmed) out.push(trimmed)
      if (out.length >= max) break
    }
    return out
  }
  for (const v of variants) {
    const formatHint: AdFormatHint =
      typeof v.formatHint === "string" && /^video$/i.test(v.formatHint) ? "Video" : "Photo"
    const topic = typeof v.topicLabel === "string" ? v.topicLabel.trim() : ""
    const number = nextByFormat[formatHint]
    nextByFormat[formatHint] = number + 1
    result.push({
      label: typeof v.label === "string" ? v.label : "Variant",
      formatHint,
      topicLabel: topic || "Untitled",
      adName: formatAdName({ format: formatHint, number, topic }),
      newHook: typeof v.newHook === "string" ? v.newHook : "",
      scriptOutline: typeof v.scriptOutline === "string" ? v.scriptOutline : "",
      primaryCopySnippet: typeof v.primaryCopySnippet === "string" ? v.primaryCopySnippet : "",
      headline: typeof v.headline === "string" ? v.headline.trim() : "",
      altHeadlines: asStringArray(v.altHeadlines, 2),
      altPrimaryTexts: asStringArray(v.altPrimaryTexts, 2),
      linkDescription: typeof v.linkDescription === "string" ? v.linkDescription.trim() : "",
      imagePrompt: typeof v.imagePrompt === "string" ? v.imagePrompt : "",
      why: typeof v.why === "string" ? v.why : "",
    })
  }
  return result
}
