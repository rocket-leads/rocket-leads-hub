/**
 * Lightweight website scraper for Pedro's brief generator. Pulls plain
 * text from the homepage + (best-effort) the about page so Claude can
 * extract positioning, hooks, USPs and ICP from the client's own copy
 * instead of relying solely on Monday updates and Fathom transcripts.
 *
 * Roy 2026-06-11: when no brief exists yet AND there's no kick-off or
 * eval meeting in the system, the website is often the only available
 * source of truth about the business. We had this earlier in the
 * onboarding flow but it dropped out during the auto-brief refactor.
 * Bringing it back as an opt-in for `/api/pedro/auto-brief` so the CM
 * can type a URL and Pedro pulls fresh context.
 *
 * Intentionally NOT a wrapper around `/api/pedro/analyze-website` -
 * that endpoint does the brand fingerprint (colors / fonts / logo /
 * hero) and is called separately from the BriefRequiredModal. Splitting
 * keeps each call timeboxed and lets the brand fingerprint persist to
 * `pedro_client_state.brand_style` without waiting on Claude.
 */

const MAX_HOMEPAGE_CHARS = 3500
const MAX_ABOUT_CHARS = 1500
const FETCH_TIMEOUT_MS = 8000

const ABOUT_PATH_CANDIDATES = [
  "/over-ons",
  "/over",
  "/about",
  "/about-us",
  "/aboutus",
  "/wie-zijn-wij",
] as const

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function cleanHtml(html: string, maxChars: number): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars)
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; PedroBot/1.0; +https://hub.rocketleads.com)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export type WebsiteScrapeResult = {
  finalUrl: string
  homepageText: string
  aboutText: string
  /** Combined block ready to drop into a Claude prompt. Empty when both
   *  fetches failed. */
  promptBlock: string
}

export async function scrapeWebsiteForBrief(
  rawUrl: string,
): Promise<WebsiteScrapeResult | null> {
  const url = normalizeUrl(rawUrl)
  if (!url) return null

  const homepageHtml = await fetchPage(url)
  if (!homepageHtml) return null

  const homepageText = cleanHtml(homepageHtml, MAX_HOMEPAGE_CHARS)

  // Try to also pull an about page - best effort, parallel, short timeout.
  // First about-path that returns non-empty text wins.
  let aboutText = ""
  for (const path of ABOUT_PATH_CANDIDATES) {
    try {
      const u = new URL(path, url).toString()
      const html = await fetchPage(u)
      if (!html) continue
      const text = cleanHtml(html, MAX_ABOUT_CHARS)
      if (text.length >= 200) {
        aboutText = text
        break
      }
    } catch {
      /* skip invalid URL */
    }
  }

  const sections: string[] = []
  if (homepageText) sections.push(`Homepage tekst:\n${homepageText}`)
  if (aboutText) sections.push(`\nOver-ons tekst:\n${aboutText}`)

  return {
    finalUrl: url,
    homepageText,
    aboutText,
    promptBlock: sections.join("\n"),
  }
}
