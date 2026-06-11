/**
 * Pedro refresh - Rocket Leads ad-naming convention.
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
  /** Roy 2026-06-11 ad-picker flow: directe quote uit de source primary
   *  copy / headline / description die deze variant amplificeert. Pedro
   *  MOET 'm leveren voor de ad-picker flow, anders mag de variant niet
   *  bestaan. Empty string voor legacy multi-winner refreshes. Surfaced
   *  in de UI als bewijs van source-anchoring. */
  sourceHookQuote: string
  /** Roy 2026-06-11 v2: minimaal 5 zinsdelen (2-6 woorden elk) die
   *  WOORD-VOOR-WOORD uit de source-copy komen en die deze variant
   *  ook gebruikt. Bewijs dat de variant in dezelfde DNA box blijft -
   *  geen nieuwe propositie, geen nieuwe USPs, geen nieuwe doelgroep.
   *  Surfaced in de UI zodat de CM in één oogopslag ziet of de iteratie
   *  trouw is aan de source. Empty array voor legacy refreshes. */
  phrasesReused: string[]
  newHook: string
  scriptOutline: string
  primaryCopySnippet: string
  /** Primary Meta headline - pijnpunt-vraag, max ~27 char zichtbaar.
   *  Pedro genereert vanaf 2026-06-10 een aparte short headline naast
   *  de hook (de hook is langer en wordt opener van primary text). */
  headline: string
  /** 2 extra headlines voor dynamic creative - Meta laat tot 5 toe;
   *  we leveren er 3 (primary + 2 alts) zodat Meta tests kan draaien. */
  altHeadlines: string[]
  /** 2 extra primary text varianten voor dynamic creative. */
  altPrimaryTexts: string[]
  /** Optionele link description (~30 char). Mag leeg blijven -
   *  Roy 2026-06-10. */
  linkDescription: string
  /** English visual brief for the image-gen call (Gemini Nano Banana
   *  Pro). Pedro writes this; the CM optionally edits before regen. */
  imagePrompt: string
  why: string
}

/** Snapshot of every Meta-side reference we'll need for a future
 *  Push-to-Meta call. Captured at refresh-time when the winner is
 *  guaranteed to exist in Meta, so push doesn't depend on the
 *  account's current state.
 *
 *  Roy 2026-06-10: zonder deze snapshot brak push als de winner ad
 *  was verwijderd/gearchiveerd uit het 90d window. Met snapshot is
 *  push 100% deterministisch - alleen de adset-template (budget/
 *  targeting) wordt nog live opgehaald omdat die kan drift'en. */
export type WinnerSnapshot = {
  /** Campaign id van de winner - bepaalt waar de nieuwe ad set komt. */
  campaignId: string
  campaignName: string
  /** Ad set id van de winner - clone-template bron voor budget +
   *  targeting + bid strategy. */
  adsetId: string
  adsetName: string
  /** Facebook Page id - wordt object_story_spec.page_id op de
   *  nieuwe creative. */
  pageId: string
  /** Connected Instagram account, optional. */
  instagramActorId: string
  /** Voor lead-form ads (destination_type ON_AD): de form id zodat de
   *  CTA value op de nieuwe creative naar dezelfde form wijst. */
  leadGenFormId: string
  /** Destination URL voor non-lead-form ads. */
  linkUrl: string
  /** CTA label (LEARN_MORE / SIGN_UP / GET_QUOTE etc.) */
  callToActionType: string
  /** Supabase Storage path of een handmatig-geüploade screenshot van de
   *  source ad. Pedro gebruikt 'm als reference image bij image
   *  generation wanneer Meta's thumbnail leeg is. Roy 2026-06-10. */
  sourceScreenshotPath?: string
}

export type NamedProposal = {
  basedOnAd: {
    adId: string
    adName: string
    cpl: number | null
    verdict: string
    /** Roy 2026-06-10: gesnapshote Meta-metadata. Push-to-Meta leest
     *  hier vanuit ipv live Meta-lookup, zodat verwijderde winners de
     *  push niet blokkeren. Oudere refreshes hebben dit niet - push
     *  valt dan terug op de oude live-lookup pad. */
    snapshot?: WinnerSnapshot
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
    sourceHookQuote?: unknown
    phrasesReused?: unknown
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
      sourceHookQuote: (() => {
        // Roy 2026-06-11: actief filteren van de verboden fallback string
        // die Pedro voorheen produceerde ("[Primary copy niet beschikbaar
        // - afleiden uit briefing: X]"). Liever leeg dan misleidend.
        const raw =
          typeof v.sourceHookQuote === "string" ? v.sourceHookQuote.trim() : ""
        if (!raw) return ""
        if (/primary copy niet beschikbaar/i.test(raw)) return ""
        if (/afleiden uit briefing/i.test(raw)) return ""
        if (/afleiden uit usps/i.test(raw)) return ""
        return raw
      })(),
      phrasesReused: asStringArray(v.phrasesReused, 8)
        // Filter de bekende fallback strings die we expliciet verbieden
        // - als Pedro toch een fallback-zin produceert, hier strippen
        // zodat de UI er niet door wordt vervuild. Roy 2026-06-11.
        .filter((p) => !/primary copy niet beschikbaar/i.test(p))
        .filter((p) => !/afleiden uit briefing/i.test(p))
        .filter((p) => !/afleiden uit usps/i.test(p))
        // 2+ woorden minimum - losse woorden zijn geen "phrase".
        .filter((p) => p.split(/\s+/).length >= 2),
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
