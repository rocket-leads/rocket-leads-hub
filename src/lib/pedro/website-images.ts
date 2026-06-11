/**
 * Pull non-logo, non-icon content images out of a homepage HTML. Used
 * by `analyze-website` to surface real client photos that Pedro can
 * reference in Gemini prompts - hero shots, team photos, office b-roll
 * etc. Scraped URLs are persisted on `brand_style.websiteImages` so
 * the image-gen route can download them at variant time without
 * re-fetching the page.
 *
 * Roy 2026-06-11: tot nu toe gebruikte Pedro alleen Drive photos +
 * winner thumbnail als reference. Maar veel klanten hebben hun beste
 * foto's al op de website staan - en die zijn vaak professioneel
 * geshoot. Negeren ervan dwingt Pedro naar stock / AI-gegenereerd
 * terwijl het echte materiaal vlak naast 'm ligt.
 */

const MIN_WIDTH = 400
const SKIP_PATTERNS = [
  /\blogo\b/i,
  /\bfavicon\b/i,
  /\bicon\b/i,
  /\bavatar\b/i,
  /\bsprite\b/i,
  /\bbadge\b/i,
  /\barrow\b/i,
  /\bbutton\b/i,
  /\bdivider\b/i,
  /\bbg-pattern\b/i,
]

type ScrapedImage = {
  url: string
  /** Approximated width when declared. null = unknown but accepted via
   *  srcset (modern responsive sites). */
  width: number | null
  /** Where in the document we found it (best-effort). Helps the CM
   *  understand what role it plays. */
  context: "hero" | "section" | "about" | "other"
}

function absolutize(href: string | null | undefined, baseUrl: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  if (/^(data|blob|javascript|mailto|tel):/i.test(trimmed)) return null
  try {
    return new URL(trimmed, baseUrl).href
  } catch {
    return null
  }
}

function tagAttr(attrString: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")
  const m = attrString.match(re)
  return m ? (m[2] ?? m[3] ?? null) : null
}

function shouldSkip(tag: string, url: string): boolean {
  const haystack = (tag + " " + url).toLowerCase()
  return SKIP_PATTERNS.some((p) => p.test(haystack))
}

function pickFromSrcset(srcset: string, baseUrl: string): string | null {
  // "url 1x, url 2x" or "url 320w, url 1920w". Pick the largest.
  let best: { url: string; weight: number } | null = null
  for (const part of srcset.split(",")) {
    const [rawUrl, descriptor] = part.trim().split(/\s+/, 2)
    if (!rawUrl) continue
    const abs = absolutize(rawUrl, baseUrl)
    if (!abs) continue
    let weight = 1
    if (descriptor) {
      const w = parseInt(descriptor.replace(/[wx]$/, ""), 10)
      if (Number.isFinite(w)) weight = w
    }
    if (!best || weight > best.weight) best = { url: abs, weight }
  }
  return best?.url ?? null
}

export type WebsiteImagesResult = {
  images: ScrapedImage[]
}

export function extractHomepageImages(
  html: string,
  baseUrl: string,
  opts: { excludeUrls?: string[]; maxImages?: number } = {},
): WebsiteImagesResult {
  const excludeSet = new Set((opts.excludeUrls ?? []).map((u) => u.toLowerCase()))
  const maxImages = Math.max(1, Math.min(20, opts.maxImages ?? 8))
  const seen = new Set<string>()
  const collected: ScrapedImage[] = []

  // Rough position-based context inference: assume the first usable
  // image in the document is the hero. Subsequent ones are body. Crude
  // but good enough for prompt-time labelling.
  let firstFound = false

  const imgRegex = /<img[^>]*>/gi
  for (const m of Array.from(html.matchAll(imgRegex))) {
    if (collected.length >= maxImages) break
    const tag = m[0]
    const indexInDoc = m.index ?? 0

    const widthAttr = tagAttr(tag, "width")
    const w = widthAttr ? parseInt(widthAttr, 10) : NaN
    const srcset = tagAttr(tag, "srcset")

    // Decision: skip when there's no srcset AND a tiny declared width
    // (UI chrome). Modern responsive sites use srcset without `width`
    // attributes, so srcset-present is the strongest "real content"
    // signal.
    if (!srcset && Number.isFinite(w) && w < MIN_WIDTH) continue

    const url =
      (srcset ? pickFromSrcset(srcset, baseUrl) : null) ??
      absolutize(tagAttr(tag, "src") ?? tagAttr(tag, "data-src"), baseUrl)
    if (!url) continue
    if (excludeSet.has(url.toLowerCase())) continue
    if (seen.has(url)) continue
    if (shouldSkip(tag, url)) continue
    seen.add(url)

    // Try to label position. About sections are common Dutch / English
    // patterns - "over-ons", "about-us", etc. - around the image.
    const surroundingStart = Math.max(0, indexInDoc - 400)
    const surrounding = html.slice(surroundingStart, indexInDoc + 400).toLowerCase()
    let context: ScrapedImage["context"] = "section"
    if (!firstFound) {
      context = "hero"
      firstFound = true
    } else if (/over-ons|over_ons|about-us|aboutus|about\b|team\b/.test(surrounding)) {
      context = "about"
    }
    collected.push({ url, width: Number.isFinite(w) ? w : null, context })
  }

  return { images: collected }
}
