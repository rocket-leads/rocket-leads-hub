import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

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
