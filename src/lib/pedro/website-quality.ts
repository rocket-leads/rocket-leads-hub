import Anthropic from "@anthropic-ai/sdk"

/**
 * Website quality verdict for the Pedro brand-fingerprint quality gate.
 *
 * Roy 2026-06-10: scraping a client's site for brand colors / fonts /
 * hero imagery is only useful when that site is itself well-designed.
 * Pulling style cues from a Shopify-template-with-stock-photos drags
 * Pedro's creatives down to the same bar. This helper looks at the
 * scrape output (+ the hero image when available) with Haiku vision
 * and returns a 0-100 score plus a flag list so the prompt builder
 * can decide how aggressively to apply the fingerprint.
 *
 * Thresholds the consuming code applies:
 *   - score >= 70 → full fingerprint (colors, fonts, layout, logo)
 *   - score 40-69 → only objective data (colors + fonts)
 *   - score <  40 → fingerprint disabled, fall back to standard fonts
 *                   + winner-ad + Drive photos
 *
 * Cost: ~$0.001 per call (Haiku, ~1k tokens in, ~300 tokens out plus
 * one image). Cached on `brand_style.qualityVerdict` so re-running the
 * analyze-website endpoint within the same campaign cycle won't pay
 * for it twice.
 */

const anthropic = new Anthropic()
const MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 600

export type WebsiteQualityVerdict = {
  /** Aggregated 0-100 score. The consuming code reads this exclusively;
   *  the per-axis breakdown is only for the CM's UI explanation. */
  score: number
  /** 0-100 per axis. Avg ≠ score because we down-weight when an axis
   *  couldn't be evaluated (e.g. no hero image visible → photo_quality
   *  is reported as null in the axes but doesn't drag the score down). */
  axes: {
    design_quality: number | null
    photo_quality: number | null
    brand_consistency: number | null
    completeness: number | null
  }
  /** Short tags Pedro / the CM can scan in one glance:
   *  "shopify_template", "wix_template", "amateurphoto", "stock_only",
   *  "no_branding", "broken_images". Free-form so the model isn't
   *  constrained to our list. */
  flags: string[]
  /** 1-2 sentence human-readable reason - shown verbatim in the brief
   *  modal banner when score < 40 so the CM knows WHY Pedro is being
   *  conservative. */
  summary: string
  /** ISO timestamp so the CM can see when this was last evaluated. */
  computedAt: string
  /** Model identifier - bumps to a newer Haiku version invalidate the
   *  cache via equality check in `analyzeWebsiteQualityCached`. */
  model: string
}

export type WebsiteQualityInput = {
  websiteUrl: string
  primaryColor?: string
  secondaryColor?: string
  headingFont?: string
  bodyFont?: string
  logoUrl?: string
  heroImageUrl?: string
  taglineHeadline?: string
  taglineSubline?: string
}

/**
 * Run the Haiku vision call and return a parsed verdict. Returns null
 * when there's no usable signal (no image + no scraped strings) - the
 * caller should treat null as "skip the gate, use everything by default"
 * rather than penalising the client for an indeterminate verdict.
 */
export async function analyzeWebsiteQuality(
  input: WebsiteQualityInput,
): Promise<WebsiteQualityVerdict | null> {
  // Cheap-bail: no scraped strings AND no image → nothing to score.
  const hasText = !!(
    input.primaryColor ||
    input.taglineHeadline ||
    input.taglineSubline ||
    input.headingFont
  )
  const imageUrl = input.heroImageUrl || input.logoUrl
  if (!hasText && !imageUrl) return null

  let imageBlock:
    | { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" }
    | null = null
  if (imageUrl) {
    try {
      const res = await fetch(imageUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { "User-Agent": "PedroBot/1.0 brand-quality" },
      })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        // Drop huge images - Haiku has a hard cap and a 5 MB hero blowing
        // the vision call up is pointless when 500 KB resolves the same.
        if (buf.byteLength <= 5 * 1024 * 1024) {
          const headerMime = res.headers.get("content-type") ?? ""
          const mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
            headerMime.includes("png")
              ? "image/png"
              : headerMime.includes("webp")
                ? "image/webp"
                : headerMime.includes("gif")
                  ? "image/gif"
                  : "image/jpeg"
          imageBlock = { base64: buf.toString("base64"), mediaType }
        }
      }
    } catch {
      // Image fetch is best-effort - fall back to text-only scoring.
    }
  }

  const contextLines: string[] = []
  contextLines.push(`Website: ${input.websiteUrl}`)
  if (input.primaryColor) contextLines.push(`Scraped primary color: ${input.primaryColor}`)
  if (input.secondaryColor) contextLines.push(`Scraped secondary color: ${input.secondaryColor}`)
  if (input.headingFont) contextLines.push(`Scraped heading font: ${input.headingFont}`)
  if (input.bodyFont) contextLines.push(`Scraped body font: ${input.bodyFont}`)
  if (input.taglineHeadline) contextLines.push(`H1 / hero headline: "${input.taglineHeadline}"`)
  if (input.taglineSubline) contextLines.push(`Hero subline: "${input.taglineSubline}"`)
  if (imageBlock) {
    contextLines.push(
      `Attached image: ${input.heroImageUrl ? "hero image from page" : "logo / brand mark"} (use this as the primary visual evidence).`,
    )
  } else if (imageUrl) {
    contextLines.push("(no image available - score on text/color/font evidence only)")
  }

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: `You are a senior brand designer evaluating a client website's brand fingerprint quality. Your job: decide how aggressively a generative-image system should mirror this brand identity in ad creatives.

Scoring rules (0-100 per axis, integer):
- design_quality: typography hierarchy, spacing, visual rhythm. 80+ = pro magazine-style. 60-79 = competent SaaS template, fine to copy. 40-59 = generic Shopify/Wix template. <40 = broken or beginner.
- photo_quality: hero imagery. 80+ = pro photography or carefully directed. 60-79 = decent stock or in-house. 40-59 = obvious stock. <40 = pixelated, amateur smartphone, broken. NULL when no image attached.
- brand_consistency: colors palette cohesion + logo clarity + visual identity. 80+ = clear single brand voice. 50-79 = mostly consistent. <50 = inconsistent or no identity.
- completeness: nothing broken (no lorem-ipsum, no placeholder images, no error pages). 80+ = polished. 50-79 = minor gaps. <50 = visibly unfinished.

Aggregate score = weighted average favoring design_quality and brand_consistency (each 30%), photo_quality and completeness (20% each). When an axis is NULL, redistribute its weight to the other three.

Output strictly this JSON shape (no markdown fences):
{"design_quality":N|null,"photo_quality":N|null,"brand_consistency":N|null,"completeness":N|null,"score":N,"flags":["..."],"summary":"1-2 sentence verdict"}

Flags should be short snake_case tags (e.g. "shopify_template","amateur_photo","stock_only","no_branding","broken_images","wix_template","no_hero","good_typography"). Max 5 flags.
Summary: 1-2 sentences explaining the score, plain English, suitable for showing the campaign manager verbatim.`,
      messages: [
        {
          role: "user",
          content: [
            ...(imageBlock
              ? ([
                  {
                    type: "image" as const,
                    source: {
                      type: "base64" as const,
                      media_type: imageBlock.mediaType,
                      data: imageBlock.base64,
                    },
                  },
                ] as const)
              : []),
            {
              type: "text",
              text: `Evaluate this website's brand fingerprint quality. Context:\n${contextLines.join("\n")}\n\nRespond with ONLY the JSON object specified in the system prompt.`,
            },
          ],
        },
      ],
    })
    const part = message.content[0]
    raw = part?.type === "text" ? part.text.trim() : ""
  } catch (e) {
    console.error(
      "[website-quality] Haiku call failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }

  if (!raw) return null

  // Strip possible markdown fences (model occasionally ignores the
  // "no fences" instruction). Then JSON.parse.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
  let parsed: {
    design_quality?: number | null
    photo_quality?: number | null
    brand_consistency?: number | null
    completeness?: number | null
    score?: number
    flags?: string[]
    summary?: string
  }
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error(
      "[website-quality] verdict parse failed (returning null):",
      e instanceof Error ? e.message : e,
      "\nraw:",
      raw.slice(0, 300),
    )
    return null
  }

  const clamp = (n: unknown): number | null =>
    typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
  const score = clamp(parsed.score)
  if (score === null) return null

  return {
    score,
    axes: {
      design_quality: clamp(parsed.design_quality),
      photo_quality: clamp(parsed.photo_quality),
      brand_consistency: clamp(parsed.brand_consistency),
      completeness: clamp(parsed.completeness),
    },
    flags: Array.isArray(parsed.flags)
      ? parsed.flags
          .filter((f): f is string => typeof f === "string")
          .slice(0, 5)
          .map((f) => f.trim())
      : [],
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary.trim().slice(0, 400)
        : "",
    computedAt: new Date().toISOString(),
    model: MODEL,
  }
}
