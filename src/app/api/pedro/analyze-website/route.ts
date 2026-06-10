import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { analyzeWebsiteQuality } from "@/lib/pedro/website-quality";

// ── Color utilities ──

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) {
    // 3-char hex
    const m3 = hex.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (!m3) return null;
    return [parseInt(m3[1]+m3[1],16), parseInt(m3[2]+m3[2],16), parseInt(m3[3]+m3[3],16)];
  }
  return [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
}

function luminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r/255, g/255, b/255].map(c =>
    c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4)
  );
  return 0.2126*rs + 0.7152*gs + 0.0722*bs;
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r,g,b].map(c => c.toString(16).padStart(2,"0")).join("");
}

function isNearBlackOrWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const lum = luminance(...rgb);
  return lum < 0.03 || lum > 0.92; // near-black or near-white
}

function isGrayish(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;
  const [r,g,b] = rgb;
  const max = Math.max(r,g,b);
  const min = Math.min(r,g,b);
  // Low saturation = grayish
  return (max - min) < 30;
}

// Parse rgb(r,g,b) or rgba(r,g,b,a) to hex
function rgbStringToHex(str: string): string | null {
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return null;
  return rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
}

// Extract all colors from a CSS/HTML string
function extractColors(text: string): string[] {
  const colors = new Set<string>();

  // Hex colors (6-digit)
  const hexMatches = text.match(/#[0-9a-fA-F]{6}\b/g) || [];
  for (const h of hexMatches) colors.add(h.toLowerCase());

  // Hex colors (3-digit, expand to 6)
  const hex3Matches = text.match(/#[0-9a-fA-F]{3}\b/g) || [];
  for (const h of hex3Matches) {
    const expanded = "#" + h[1]+h[1] + h[2]+h[2] + h[3]+h[3];
    colors.add(expanded.toLowerCase());
  }

  // rgb/rgba
  const rgbMatches = text.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\)/g) || [];
  for (const r of rgbMatches) {
    const hex = rgbStringToHex(r);
    if (hex) colors.add(hex.toLowerCase());
  }

  return Array.from(colors);
}

// ── Color scoring: determines which colors are brand colors ──

interface ScoredColor {
  hex: string;
  score: number;
  source: string;
  luminance: number;
}

function scoreColorsFromHTML(html: string): ScoredColor[] {
  const scored: Map<string, ScoredColor> = new Map();

  function addScore(hex: string, points: number, source: string) {
    hex = hex.toLowerCase();
    if (isNearBlackOrWhite(hex) || isGrayish(hex)) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const lum = luminance(...rgb);
    const existing = scored.get(hex);
    if (existing) {
      existing.score += points;
      if (!existing.source.includes(source)) existing.source += ", " + source;
    } else {
      scored.set(hex, { hex, score: points, source, luminance: lum });
    }
  }

  // Priority 1: CTA / button background colors (highest value)
  // Look for button elements with inline styles
  const buttonStyleRegex = /<(?:button|a)[^>]*(?:class="[^"]*(?:btn|button|cta|action|submit)[^"]*"|role="button")[^>]*style="[^"]*(?:background(?:-color)?)\s*:\s*([^;"]+)/gi;
  for (const m of Array.from(html.matchAll(buttonStyleRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 50, "cta_button");
  }

  // Look for button/CTA in CSS classes
  const ctaCssRegex = /\.(?:btn|button|cta|action|submit|primary)[^{]*\{[^}]*(?:background(?:-color)?)\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(html.matchAll(ctaCssRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 50, "cta_css");
  }

  // Priority 2: Navigation / header colors
  const navRegex = /(?:nav|header|navbar|menu|topbar)[^{]*\{[^}]*(?:background(?:-color)?)\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(html.matchAll(navRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 30, "nav");
  }

  // Priority 3: Heading colors (if not black/white)
  const headingRegex = /(?:h[1-3]|\.heading|\.title|\.hero)[^{]*\{[^}]*color\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(html.matchAll(headingRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 25, "heading");
  }

  // Priority 4: Link colors
  const linkRegex = /\ba\b[^{]*\{[^}]*color\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(html.matchAll(linkRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 20, "link");
  }

  // Priority 5: Border accent colors
  const borderRegex = /border(?:-color|-left|-right|-top|-bottom)?\s*:\s*[^;}]*([#]\w+|rgb[^;)]+\))/gi;
  for (const m of Array.from(html.matchAll(borderRegex))) {
    const colors = extractColors(m[0]);
    for (const c of colors) addScore(c, 10, "border");
  }

  // Priority 6: All inline style background colors (medium value)
  const inlineBgRegex = /style="[^"]*background(?:-color)?\s*:\s*([^;"]+)/gi;
  for (const m of Array.from(html.matchAll(inlineBgRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 15, "inline_bg");
  }

  // Priority 7: CSS custom properties / variables that look like brand colors
  const varRegex = /--(?:brand|primary|secondary|accent|main|theme|color)[^:]*:\s*([^;}]+)/gi;
  for (const m of Array.from(html.matchAll(varRegex))) {
    const colors = extractColors(m[1]);
    for (const c of colors) addScore(c, 40, "css_var");
  }

  // Priority 8: General color frequency (scales with occurrence count)
  // A color that appears 50+ times is almost certainly the brand color
  const allColors = extractColors(html);
  for (const c of allColors) {
    if (!isNearBlackOrWhite(c) && !isGrayish(c)) {
      const count = (html.match(new RegExp(c.replace("#", "#?"), "gi")) || []).length;
      // Scale: 1-5 = 5pts, 6-20 = 15pts, 21-50 = 30pts, 50+ = 60pts
      const freqScore = count >= 50 ? 60 : count >= 20 ? 30 : count >= 6 ? 15 : 5;
      addScore(c, freqScore, `frequency(${count}x)`);
    }
  }

  return Array.from(scored.values()).sort((a, b) => b.score - a.score);
}

// ── Font extraction ──
// Pedro references font families in image_prompt so Gemini renders
// headline overlays in a brand-consistent typeface. We scan CSS for
// `font-family:` declarations, normalize the quoted family name, and
// score by where it's declared (heading > body > inline).
// Roy 2026-06-10.

const GENERIC_FONTS = new Set([
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "inherit",
  "initial",
  "unset",
  "revert",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

interface ScoredFont {
  family: string;
  score: number;
  source: string;
}

function normalizeFontFamily(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["']+|["']+$/g, "").trim();
  if (!trimmed) return null;
  if (GENERIC_FONTS.has(trimmed.toLowerCase())) return null;
  // Drop CSS custom-property references like `var(--font-heading)`
  if (/^var\s*\(/i.test(trimmed)) return null;
  // Reject obvious junk (urls, numbers only)
  if (/^https?:|^\d+$/.test(trimmed)) return null;
  return trimmed;
}

function extractFontFamilies(text: string): { heading: string | null; body: string | null } {
  const scored = new Map<string, ScoredFont>();
  function add(family: string, points: number, source: string) {
    const lc = family.toLowerCase();
    const existing = scored.get(lc);
    if (existing) {
      existing.score += points;
      if (!existing.source.includes(source)) existing.source += `,${source}`;
    } else {
      scored.set(lc, { family, score: points, source });
    }
  }
  function addStack(stack: string, points: number, source: string) {
    // `font-family: "Inter", "Helvetica Neue", sans-serif;` — take only
    // the first non-generic name. That's the brand font; the rest is
    // graceful fallback.
    const parts = stack.split(",");
    for (const p of parts) {
      const fam = normalizeFontFamily(p);
      if (fam) {
        add(fam, points, source);
        return;
      }
    }
  }

  // Headings — these carry brand identity (Clash Grotesk, etc.)
  const headingRegex = /(?:h[1-3]|\.heading|\.title|\.hero|\.display)\b[^{]*\{[^}]*font-family\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(text.matchAll(headingRegex))) {
    addStack(m[1], 60, "heading");
  }

  // Body / paragraphs — usually the body font (Inter, etc.)
  const bodyRegex = /(?:\bbody\b|\.body|\.text|\.content|p\b)\s*\{[^}]*font-family\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(text.matchAll(bodyRegex))) {
    addStack(m[1], 40, "body");
  }

  // CSS custom properties named --font-* or --typeface-*
  const varRegex = /--font[a-z-]*\s*:\s*([^;}]+)/gi;
  for (const m of Array.from(text.matchAll(varRegex))) {
    addStack(m[1], 50, "css_var");
  }

  // Generic font-family declarations (catch-all, lower weight)
  const generalRegex = /font-family\s*:\s*([^;}"']+)/gi;
  for (const m of Array.from(text.matchAll(generalRegex))) {
    addStack(m[1], 5, "general");
  }

  // Google Fonts <link> imports — strong signal of intentional brand font.
  const googleRegex = /fonts\.googleapis\.com\/css[^"']*family=([^&"'?]+)/gi;
  for (const m of Array.from(text.matchAll(googleRegex))) {
    const families = m[1].split("|");
    for (const f of families) {
      const fam = normalizeFontFamily(decodeURIComponent(f).split(":")[0].replace(/\+/g, " "));
      if (fam) add(fam, 70, "google_fonts");
    }
  }

  const ranked = Array.from(scored.values()).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { heading: null, body: null };

  // Prefer heading-sourced font for the heading; body-sourced for body.
  // Fall back to top-ranked overall when one role isn't distinct.
  const headingPick = ranked.find((f) => f.source.includes("heading"))
    ?? ranked.find((f) => f.source.includes("css_var"))
    ?? ranked.find((f) => f.source.includes("google_fonts"))
    ?? ranked[0];
  const bodyPick = ranked.find((f) =>
    f.source.includes("body") && f.family !== headingPick.family,
  ) ?? ranked.find((f) => f.family !== headingPick.family) ?? headingPick;

  return {
    heading: headingPick.family,
    body: bodyPick.family,
  };
}

// ── Logo / hero image / tagline scraping (Roy 2026-06-10) ──
//
// Cheap brand-fingerprint additions that piggyback on the existing
// `analyze-website` HTML fetch. We pass the raw HTML + the resolved base
// URL into these helpers and they return absolute URLs / trimmed strings,
// or null when nothing usable was found. Failure is always a soft return
// — never a thrown — so an exotic site layout never breaks the existing
// color/font extraction that's the actual gate.

/** Turn a possibly-relative URL into an absolute one against the page
 *  base. Returns null when the input is empty/unusable. Filters out
 *  data:/blob: URLs which can't be referenced from a Gemini prompt. */
function absolutizeUrl(href: string | null | undefined, baseUrl: string): string | null {
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

/** Grab a single attribute value by name from a regex-matched tag's
 *  attribute string. Handles single/double quotes; case-insensitive. */
function tagAttr(attrString: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i")
  const m = attrString.match(re)
  return m ? (m[2] ?? m[3] ?? null) : null
}

/**
 * Logo URL with a 3-tier fallback. Each tier picks the first hit so the
 * order encodes priority: explicit og:image > apple-touch-icon > favicon
 * > "logo"-named header img. og:image first because that's what most
 * brand-aware sites set as the canonical share-able representation.
 */
function extractLogoUrl(html: string, baseUrl: string): string | null {
  // og:image
  const og = html.match(/<meta[^>]+property\s*=\s*["']og:image["'][^>]*>/i)
  if (og) {
    const href = tagAttr(og[0], "content")
    const abs = absolutizeUrl(href, baseUrl)
    if (abs) return abs
  }
  // apple-touch-icon (always a square, often the brand mark)
  const apple = html.match(/<link[^>]+rel\s*=\s*["']apple-touch-icon[^"']*["'][^>]*>/i)
  if (apple) {
    const href = tagAttr(apple[0], "href")
    const abs = absolutizeUrl(href, baseUrl)
    if (abs) return abs
  }
  // favicon
  const fav = html.match(/<link[^>]+rel\s*=\s*["'](?:icon|shortcut icon)["'][^>]*>/i)
  if (fav) {
    const href = tagAttr(fav[0], "href")
    const abs = absolutizeUrl(href, baseUrl)
    if (abs) return abs
  }
  // <img> in header/nav with "logo" anywhere on the tag (class/alt/id)
  const imgRegex = /<img[^>]*>/gi
  for (const m of Array.from(html.matchAll(imgRegex))) {
    const tag = m[0]
    if (/\blogo\b/i.test(tag)) {
      const href = tagAttr(tag, "src") ?? tagAttr(tag, "data-src")
      const abs = absolutizeUrl(href, baseUrl)
      if (abs) return abs
    }
  }
  return null
}

/**
 * Hero image — first reasonably-large content image we can find in the
 * top of the document, excluding logos. We don't have layout info here
 * so we approximate "top" with "first occurrence" + skip the first few
 * tags that match the logo pattern. Good enough as a Pedro reference.
 *
 * Skip filters: anything tagged as logo/icon/avatar/sprite, and any
 * srcset-less `<img>` smaller than 200px declared width — those are
 * almost always UI chrome rather than brand content.
 */
function extractHeroImageUrl(html: string, baseUrl: string, logoUrl: string | null): string | null {
  const imgRegex = /<img[^>]*>/gi
  for (const m of Array.from(html.matchAll(imgRegex))) {
    const tag = m[0]
    if (/\b(logo|icon|avatar|sprite|favicon)\b/i.test(tag)) continue
    const widthAttr = tagAttr(tag, "width")
    const w = widthAttr ? parseInt(widthAttr, 10) : NaN
    const hasSrcset = /\bsrcset\s*=/i.test(tag)
    if (!hasSrcset && Number.isFinite(w) && w < 200) continue
    // Prefer the largest entry from srcset when present; otherwise plain src.
    const srcset = tagAttr(tag, "srcset")
    if (srcset) {
      // "url 1x, url 2x" or "url 320w, url 640w" — pick the last (largest)
      const lastEntry = srcset.split(",").pop()?.trim().split(/\s+/)[0]
      const abs = absolutizeUrl(lastEntry, baseUrl)
      if (abs && abs !== logoUrl) return abs
    }
    const href = tagAttr(tag, "src") ?? tagAttr(tag, "data-src")
    const abs = absolutizeUrl(href, baseUrl)
    if (abs && abs !== logoUrl) return abs
  }
  return null
}

/**
 * Tagline — `<h1>` plus the first `<p>` following it (typical hero copy
 * pattern). Both are stripped of HTML and trimmed. We only return them
 * when non-trivially short so Pedro's tone-of-voice analysis has
 * something concrete to work with.
 */
function extractTagline(html: string): { headline: string | null; subline: string | null } {
  const stripTags = (s: string) =>
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const headline = h1Match ? stripTags(h1Match[1]).slice(0, 200) : null

  // First `<p>` after the `<h1>` (or first overall when no h1).
  let subline: string | null = null
  if (h1Match && h1Match.index !== undefined) {
    const after = html.slice(h1Match.index + h1Match[0].length)
    const pMatch = after.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
    if (pMatch) subline = stripTags(pMatch[1]).slice(0, 400)
  } else {
    const pMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)
    if (pMatch) subline = stripTags(pMatch[1]).slice(0, 400)
  }
  return {
    headline: headline && headline.length >= 4 ? headline : null,
    subline: subline && subline.length >= 12 ? subline : null,
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { url } = await req.json();

  if (!url) {
    return NextResponse.json({ error: "URL is vereist" }, { status: 400 });
  }

  try {
    // Normalize URL
    let fetchUrl = url.trim();
    if (!fetchUrl.startsWith("http")) fetchUrl = `https://${fetchUrl}`;

    // Fetch the website HTML
    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Website niet bereikbaar (${res.status})` },
        { status: 400 }
      );
    }

    const html = await res.text();

    // Also try to fetch linked CSS files
    let fullContent = html;
    const cssLinks = Array.from(html.matchAll(/href="([^"]+\.css[^"]*)"/g))
      .map(m => m[1])
      .slice(0, 3); // Max 3 CSS files

    for (const cssHref of cssLinks) {
      try {
        let cssUrl = cssHref;
        if (cssHref.startsWith("//")) cssUrl = "https:" + cssHref;
        else if (cssHref.startsWith("/")) cssUrl = new URL(cssHref, fetchUrl).href;
        else if (!cssHref.startsWith("http")) cssUrl = new URL(cssHref, fetchUrl).href;

        const cssRes = await fetch(cssUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; PedroBot/1.0)" },
          signal: AbortSignal.timeout(5000),
        });
        if (cssRes.ok) {
          const cssText = await cssRes.text();
          fullContent += "\n" + cssText.substring(0, 50000);
        }
      } catch { /* skip failed CSS */ }
    }

    // Score all colors
    const scored = scoreColorsFromHTML(fullContent);
    // Extract fonts in parallel — fail-soft, fonts are nice-to-have.
    const fonts = extractFontFamilies(fullContent);
    // Brand-fingerprint additions (Roy 2026-06-10) — also fail-soft so
    // an exotic site layout never kills the color extraction path.
    const logoUrl = extractLogoUrl(html, fetchUrl);
    const heroImageUrl = extractHeroImageUrl(html, fetchUrl, logoUrl);
    const tagline = extractTagline(html);

    // Run the Haiku quality gate in parallel with the color/font pick
    // below. ~2-4s vision call; we await right before building the
    // response so the rest of this handler can keep working on the
    // synchronous extraction work. Null result = no signal (no image +
    // no scraped strings) — consuming code falls back to "use everything
    // by default", same behavior as pre-2026-06-10.
    const qualityVerdictPromise = analyzeWebsiteQuality({
      websiteUrl: fetchUrl,
      primaryColor: scored[0]?.hex,
      secondaryColor: scored[1]?.hex,
      headingFont: fonts.heading ?? undefined,
      bodyFont: fonts.body ?? undefined,
      logoUrl: logoUrl ?? undefined,
      heroImageUrl: heroImageUrl ?? undefined,
      taglineHeadline: tagline.headline ?? undefined,
      taglineSubline: tagline.subline ?? undefined,
    }).catch((e) => {
      console.error(
        "[analyze-website] quality verdict failed (continuing without):",
        e instanceof Error ? e.message : e,
      );
      return null;
    });

    if (scored.length === 0) {
      return NextResponse.json({
        error: "Geen brand kleuren gevonden - de website gebruikt mogelijk alleen afbeeldingen of JavaScript-gerenderde kleuren"
      }, { status: 400 });
    }

    // Pick primary: highest scoring color
    const primary = scored[0];

    // Pick secondary: 2nd highest but visually different from primary
    let secondary = scored.length > 1 ? scored[1] : null;
    // Make sure secondary is visually different (different hue)
    if (secondary) {
      const pRgb = hexToRgb(primary.hex);
      const sRgb = hexToRgb(secondary.hex);
      if (pRgb && sRgb) {
        const diff = Math.abs(pRgb[0]-sRgb[0]) + Math.abs(pRgb[1]-sRgb[1]) + Math.abs(pRgb[2]-sRgb[2]);
        if (diff < 60) {
          // Too similar, look further
          secondary = scored.find((c, i) => {
            if (i < 2) return false;
            const cRgb = hexToRgb(c.hex);
            if (!cRgb) return false;
            const d = Math.abs(pRgb[0]-cRgb[0]) + Math.abs(pRgb[1]-cRgb[1]) + Math.abs(pRgb[2]-cRgb[2]);
            return d >= 60;
          }) || scored[1];
        }
      }
    }

    // Pick accent: best color for dark background (luminance > 0.15)
    const accent = scored.find(c => c.luminance > 0.15 && c.hex !== primary.hex) || primary;

    // Extract text content for industry/tone detection
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 2000);

    // Await the quality verdict — it ran in parallel with the synchronous
    // extraction work above so this is usually already resolved.
    const qualityVerdict = await qualityVerdictPromise;

    // Return all extracted colors + top picks
    return NextResponse.json({
      brandStyle: {
        primaryColor: primary.hex,
        secondaryColor: secondary?.hex || "#ffffff",
        accentColor: accent.hex,
        tone: "professioneel",
        industry: "",
        brandKeywords: "",
        visualStyle: "",
        headingFont: fonts.heading ?? undefined,
        bodyFont: fonts.body ?? undefined,
        // Brand-fingerprint additions — Pedro references these in the
        // Gemini image prompt when the CM has "Look & feel" and/or
        // "Logo" toggled on. All optional so back-compat with
        // pre-fingerprint state rows is automatic.
        logoUrl: logoUrl ?? undefined,
        heroImageUrl: heroImageUrl ?? undefined,
        taglineHeadline: tagline.headline ?? undefined,
        taglineSubline: tagline.subline ?? undefined,
        // Quality verdict — null when there wasn't enough signal to
        // score (no hero image, no logo, no tagline). Consuming code
        // treats null as "fingerprint is fine to use", same default as
        // pre-2026-06-10.
        qualityVerdict: qualityVerdict ?? undefined,
      },
      extractedColors: scored.slice(0, 8).map(c => ({
        hex: c.hex,
        score: c.score,
        source: c.source,
        luminance: Math.round(c.luminance * 100) / 100,
      })),
      textContent: textContent.substring(0, 500),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Analyse mislukt";
    console.error("Website analysis error:", msg);

    if (msg.includes("timeout") || msg.includes("abort")) {
      return NextResponse.json(
        { error: "Website reageerde niet - probeer het opnieuw" },
        { status: 408 }
      );
    }

    return NextResponse.json(
      { error: "Website analyse mislukt - controleer de URL" },
      { status: 500 }
    );
  }
}
