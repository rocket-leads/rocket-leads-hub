import Anthropic from "@anthropic-ai/sdk"

/**
 * Vision-based brand color extraction.
 *
 * Roy 2026-06-11: regex-based color scoring uit `analyze-website` faalt
 * op moderne sites die alle styling via JS / Tailwind utilities
 * renderen of waar de echte brand color in een SVG fill / image overlay
 * zit (niet declaratief in CSS). Voor TMM Technology bv: het echte
 * brand color is de petrol-teal van het logo en de wave-divider, maar
 * regex pakt alleen oranje link colors en blauwe accent uit utility
 * classes. Vision lost dit op met één call op het logo.
 *
 * Returns up to 3 hex codes ranked by visual dominance + role
 * (primary/secondary/accent). Null when there's no image OR the model
 * can't extract a confident result.
 *
 * Cost: ~$0.001 per call (Haiku, ~500 tokens in + 1 image, ~150 tokens
 * out). Caller decides caching.
 */

const anthropic = new Anthropic()
const MODEL = "claude-haiku-4-5-20251001"

export type VisionBrandColors = {
  primary: string
  secondary: string | null
  accent: string | null
  /** Short justification for the CM. */
  reason: string
  computedAt: string
  model: string
}

type Tier = "logo" | "hero" | "other"

async function fetchImageAsBase64(
  url: string,
): Promise<
  | {
      base64: string
      mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    }
  | null
> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "PedroBot/1.0 brand-vision" },
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > 5 * 1024 * 1024) return null
    const headerMime = res.headers.get("content-type") ?? ""
    const mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
      headerMime.includes("png")
        ? "image/png"
        : headerMime.includes("webp")
          ? "image/webp"
          : headerMime.includes("gif")
            ? "image/gif"
            : "image/jpeg"
    return { base64: buf.toString("base64"), mediaType }
  } catch {
    return null
  }
}

function isValidHex(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s.trim())
}

function normaliseHex(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Single Haiku vision pass to extract brand colors from one or more
 * images. Pass the logo FIRST when available - it's the most
 * brand-defining input. Hero / accent images add corroboration.
 */
export async function extractBrandColorsFromImages(args: {
  websiteUrl?: string
  /** Ordered by priority: logo first, then hero, then other. The model
   *  weights earlier images more heavily. Empty / unfetchable URLs
   *  silently skipped. */
  imageUrls: Array<{ url: string; tier: Tier }>
}): Promise<VisionBrandColors | null> {
  const fetched: Array<{
    tier: Tier
    base64: string
    mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"
  }> = []
  for (const { url, tier } of args.imageUrls.slice(0, 3)) {
    const img = await fetchImageAsBase64(url)
    if (img) fetched.push({ tier, ...img })
  }
  if (fetched.length === 0) return null

  const contextLines: string[] = []
  if (args.websiteUrl) contextLines.push(`Website: ${args.websiteUrl}`)
  contextLines.push(
    `Images attached, ordered by importance: ${fetched.map((f) => f.tier).join(" → ")}.`,
  )
  contextLines.push(
    "Identify this brand's actual primary, secondary and accent colors as they appear visually. Logo color is the strongest signal.",
  )

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `You are a senior brand designer extracting the canonical color palette of a brand from its logo and hero imagery.

Output strictly this JSON shape (no markdown fences):
{"primary":"#xxxxxx","secondary":"#xxxxxx"|null,"accent":"#xxxxxx"|null,"reason":"one short sentence on what you saw"}

Rules:
- "primary" MUST be the dominant brand color of the LOGO when a logo is attached. If the logo is monochrome, primary = that single hue.
- "secondary" is the next most-defining color (often a contrasting hue or a darker/lighter shade of the same family). Null if there's only one identifiable brand color.
- "accent" is an optional pop color used for CTAs / emphasis. Null when not clearly present.
- Always return 6-digit lowercase hex codes (e.g. "#21595f"). Never return CSS color names, rgb(), or shorthand 3-digit hex.
- Ignore black / white / pure greys unless they're literally the only color in the logo. Ignore photographic background colors (sky, skin, plants) - those are NOT brand colors.
- Be confident but accurate. If you genuinely can't tell, return primary as your best guess and leave secondary + accent null.
- "reason" is one short sentence (~100 chars) the campaign manager will read - say what visual evidence drove the picks.`,
      messages: [
        {
          role: "user",
          content: [
            ...fetched.map(
              (f) =>
                ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: f.mediaType,
                    data: f.base64,
                  },
                }) as const,
            ),
            {
              type: "text",
              text: `${contextLines.join("\n")}\n\nRespond with ONLY the JSON object specified in the system prompt.`,
            },
          ],
        },
      ],
    })
    const part = message.content[0]
    raw = part?.type === "text" ? part.text.trim() : ""
  } catch (e) {
    console.error(
      "[brand-vision] Haiku call failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }

  if (!raw) return null

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
  let parsed: {
    primary?: unknown
    secondary?: unknown
    accent?: unknown
    reason?: unknown
  }
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error(
      "[brand-vision] parse failed (returning null):",
      e instanceof Error ? e.message : e,
      "\nraw:",
      raw.slice(0, 200),
    )
    return null
  }

  if (!isValidHex(parsed.primary)) return null
  const primary = normaliseHex(parsed.primary)
  const secondary = isValidHex(parsed.secondary) ? normaliseHex(parsed.secondary) : null
  const accent = isValidHex(parsed.accent) ? normaliseHex(parsed.accent) : null
  const reason =
    typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : ""

  return {
    primary,
    secondary: secondary && secondary !== primary ? secondary : null,
    accent: accent && accent !== primary && accent !== secondary ? accent : null,
    reason,
    computedAt: new Date().toISOString(),
    model: MODEL,
  }
}

export type PdfPalette = {
  hexCodes: string[]
  /** Short note from the model on how confident it is and what kind of
   *  document it parsed (color palette page, full style guide, brand
   *  book). */
  reason: string
  sourceFileName: string
  computedAt: string
  model: string
}

/**
 * Vision/document extraction of brand colors from a PDF (kleuren.pdf,
 * style-guide.pdf, brandbook.pdf). Anthropic's API ondersteunt PDFs
 * native via een `document` block; we vragen het model puur de hex
 * codes te returnen die als brand colors zijn aangewezen. Veiligheid:
 * caller moet het PDF al hebben gevalideerd als brand-asset (we
 * sturen geen contracts of CV's hierdoor).
 *
 * Roy 2026-06-11.
 */
export async function extractColorsFromBrandPdf(args: {
  pdfBytes: Buffer
  fileName: string
}): Promise<PdfPalette | null> {
  if (args.pdfBytes.byteLength === 0) return null
  // Anthropic PDF cap is 32 MB; we filter on 10 MB voor zekere latency.
  if (args.pdfBytes.byteLength > 10 * 1024 * 1024) return null

  let raw = ""
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: `You are a brand-asset parser. The attached PDF is a brand book / style guide / color palette document for a single client. Your job: extract the canonical brand color hex codes the document presents as official.

Rules:
- Return ONLY colors the document EXPLICITLY labels as brand colors (primary, secondary, accent, brand palette, kleuren, palette, etc.). Ignore body text colors, decorative tints, sample-image tones.
- Output 6-digit lowercase hex codes only (e.g. "#21595f"). Convert RGB / CMYK / Pantone callouts to their nearest sRGB hex.
- Order matters: primary first, then secondary, then accents. Max 6 colors total.
- Exclude pure black (#000000), pure white (#ffffff), and near-white off-whites (lightness > 0.96).

Output strictly this JSON shape (no markdown fences):
{"hex_codes":["#xxxxxx", "#xxxxxx", ...],"reason":"one short sentence on what kind of document this was and how confident you are"}

If you can't extract anything confidently, return {"hex_codes":[],"reason":"..."}.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document" as const,
              source: {
                type: "base64" as const,
                media_type: "application/pdf",
                data: args.pdfBytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: `File name: "${args.fileName}". Extract the canonical brand color palette.`,
            },
          ],
        },
      ],
    })
    const part = message.content[0]
    raw = part?.type === "text" ? part.text.trim() : ""
  } catch (e) {
    console.error(
      "[brand-vision] PDF extraction failed:",
      e instanceof Error ? e.message : e,
    )
    return null
  }
  if (!raw) return null

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim()
  let parsed: { hex_codes?: unknown; reason?: unknown }
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error(
      "[brand-vision] PDF parse failed (returning null):",
      e instanceof Error ? e.message : e,
      "\nraw:",
      raw.slice(0, 200),
    )
    return null
  }
  const rawCodes = Array.isArray(parsed.hex_codes) ? parsed.hex_codes : []
  const hexCodes = rawCodes
    .filter(isValidHex)
    .map(normaliseHex)
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .slice(0, 6)
  if (hexCodes.length === 0) return null

  return {
    hexCodes,
    reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 200) : "",
    sourceFileName: args.fileName,
    computedAt: new Date().toISOString(),
    model: MODEL,
  }
}

