import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/server"
import { runFacebookAdsScraper, type FacebookAdScrapeResult } from "@/lib/integrations/apify"

/**
 * Competitor research orchestrator for the onboarding wizard's Client
 * Brief step (step 3, competitor analysis sub-action).
 *
 * Two-phase flow:
 *   1. `findCompetitors`     - Claude takes the brief (sector, country,
 *                              ICP, USPs) and proposes 5-8 plausible
 *                              competitors. Each comes with a relevance
 *                              note so the AM understands the pick.
 *   2. `scrapeWinningAds`    - For the AM-confirmed competitors, run the
 *                              Apify Facebook Ads Scraper with their
 *                              brand names as search terms, then store
 *                              every returned ad in `client_competitor_ads`
 *                              with a `days_running` score. Caller picks
 *                              the winners via `selected_by_am=true`.
 *
 * Kept as a single lib module so the API route can stay thin and a
 * future cron / batch job can reuse the same code path. Same pattern
 * Pedro's auto-brief follows.
 */

const anthropic = new Anthropic()

export type CompetitorBriefInput = {
  /** RL client's own company name - used to exclude self-matches in
   *  the AI prompt. */
  ownCompanyName: string
  /** Country code: NL / BE / DE / … - drives both the AI prompt's
   *  geographic scope and the Apify scraper's country filter. */
  country: string
  /** From the brief - used by Claude to anchor what "similar
   *  competitor" means. */
  sector: string
  doelgroep: string
  aanbod: string
  usps: string
  /** Optional - extra context (raw competitor analysis text the AM
   *  may already have typed) so the model doesn't suggest competitors
   *  the AM has already considered. */
  existingNotes?: string
}

export type CompetitorSuggestion = {
  name: string
  /** One-line reason the AI suggested this competitor - surfaced in
   *  the UI so the AM can sanity-check before approving. */
  relevance: string
  /** Best-effort Meta page URL the AI knows about. Often missing -
   *  we fall back to search-terms in that case. */
  facebookPageUrl?: string
  /** Best-effort general website URL. Informational only. */
  websiteUrl?: string
}

const FIND_COMPETITORS_SYSTEM = `You are an expert in performance marketing competitor research for the Dutch / Belgian SMB market. Given a Rocket Leads client brief, identify 5-8 plausible direct competitors in the same country and sector. Output JSON only - no prose.

Rules:
- Only suggest competitors that operate in the specified country.
- Skip generic megabrands (e.g. don't say "Google" for an agency client).
- Don't suggest the client's own company.
- If you know the competitor's Facebook page URL with high confidence, include it. Otherwise omit (the scraper falls back to search terms).
- "relevance" must be a single concrete reason (e.g. "same target audience: renovating homeowners 35-55, similar price tier").

Output schema:
{
  "competitors": [
    { "name": string, "relevance": string, "facebookPageUrl"?: string, "websiteUrl"?: string }
  ]
}`

/**
 * Phase 1 - ask Claude for plausible competitors based on the brief.
 * Returns 5-8 entries. Caller surfaces these to the AM for approval
 * before kicking off the (paid) Apify scrape.
 */
export async function findCompetitors(
  input: CompetitorBriefInput,
): Promise<CompetitorSuggestion[]> {
  const userPrompt = `RL client brief:

Country: ${input.country || "NL"}
Sector: ${input.sector}
Own company: ${input.ownCompanyName}
Target audience (ICP): ${input.doelgroep}
Offer / proposition: ${input.aanbod}
USPs: ${input.usps}
${input.existingNotes ? `\nExisting competitor notes (don't repeat):\n${input.existingNotes}` : ""}

Suggest 5-8 direct competitors.`

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: FIND_COMPETITORS_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  })

  const raw = message.content[0]?.type === "text" ? message.content[0].text : ""
  const cleaned = raw.replace(/```json|```/g, "").trim()
  let parsed: { competitors?: CompetitorSuggestion[] }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error("AI gaf een ongeldig antwoord terug bij competitor research.")
  }

  return (parsed.competitors ?? []).filter(
    (c): c is CompetitorSuggestion =>
      Boolean(c && typeof c.name === "string" && typeof c.relevance === "string"),
  )
}

/**
 * Phase 2 - for an AM-approved set of competitors, run the Apify
 * Facebook Ads Scraper and persist every returned ad to
 * `client_competitor_ads`. Returns the number of ads stored per
 * competitor so the UI can show a quick summary ("scraped 47 ads
 * across 5 competitors").
 *
 * Ranking happens in the UI layer - this function stores everything
 * raw + `days_running` so the AM can sort/filter in the picker.
 */
export async function scrapeWinningAds(args: {
  mondayItemId: string
  competitors: CompetitorSuggestion[]
  country: string
  /** Cap per-competitor - Apify charges per ad scraped. Default 30. */
  maxAdsPerCompetitor?: number
}): Promise<{
  scrapedCount: number
  perCompetitor: Array<{ name: string; ads: number }>
}> {
  if (args.competitors.length === 0) {
    return { scrapedCount: 0, perCompetitor: [] }
  }

  const supabase = await createAdminClient()
  const perCompetitor: Array<{ name: string; ads: number }> = []
  let total = 0

  // Run per-competitor instead of one big batch - keeps memory bounded
  // and lets a single bad URL not nuke the whole scrape.
  for (const comp of args.competitors) {
    let results: FacebookAdScrapeResult[] = []
    try {
      results = await runFacebookAdsScraper({
        // Apify accepts either page URLs or search terms; we prefer
        // explicit URLs when the AI knew them, fall back to search
        // terms otherwise.
        pageUrls: comp.facebookPageUrl
          ? [comp.facebookPageUrl]
          : [`https://www.facebook.com/ads/library/?q=${encodeURIComponent(comp.name)}`],
        country: args.country,
        maxAds: args.maxAdsPerCompetitor ?? 30,
        activeOnly: true,
      })
    } catch (e) {
      // Don't blow up the whole run - record the failure per competitor
      // and move on. The UI shows partial results so the AM still gets
      // value from the competitors that did succeed.
      console.error(
        `[competitor-research] Apify scrape failed for ${comp.name}:`,
        e instanceof Error ? e.message : e,
      )
      perCompetitor.push({ name: comp.name, ads: 0 })
      continue
    }

    const rows = results
      .map((r) => mapApifyResultToRow(args.mondayItemId, comp, r))
      .filter((r): r is NonNullable<ReturnType<typeof mapApifyResultToRow>> => r !== null)

    if (rows.length > 0) {
      // Upsert - re-scraping the same competitor later refreshes
      // `days_running` + `was_active_at_scrape` without duplicating
      // rows (the unique key is monday_item_id + ad_archive_id).
      const { error } = await supabase
        .from("client_competitor_ads")
        .upsert(rows, { onConflict: "monday_item_id,ad_archive_id" })
      if (error) {
        console.error(
          `[competitor-research] Upsert failed for ${comp.name}:`,
          error.message,
        )
      }
    }

    perCompetitor.push({ name: comp.name, ads: rows.length })
    total += rows.length
  }

  return { scrapedCount: total, perCompetitor }
}

/** Project a single Apify result into the `client_competitor_ads` row
 *  shape. Returns null when the result is missing the critical
 *  `ad_archive_id` (without that we can't enforce uniqueness). */
function mapApifyResultToRow(
  mondayItemId: string,
  competitor: CompetitorSuggestion,
  r: FacebookAdScrapeResult,
) {
  if (!r.ad_archive_id) return null

  const startedAt = r.start_date ? new Date(r.start_date * 1000) : null
  const endedAt = r.end_date ? new Date(r.end_date * 1000) : null
  const daysRunning = startedAt
    ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24)))
    : null

  // Pick the first available creative - Apify nests them differently per
  // ad format; we surface the primary and stash the rest in
  // `extra_creatives` so a future carousel-aware UI can use them.
  const snap = r.snapshot ?? {}
  const primaryVideo = snap.videos?.[0]
  const primaryImage = snap.images?.[0]
  const creativeType = primaryVideo
    ? "video"
    : (snap.cards?.length ?? 0) > 1
      ? "carousel"
      : primaryImage
        ? "image"
        : "unknown"
  const creativeUrl =
    primaryVideo?.video_hd_url ??
    primaryVideo?.video_sd_url ??
    primaryImage?.original_image_url ??
    primaryImage?.resized_image_url ??
    null
  const creativePreviewUrl =
    primaryVideo?.video_preview_image_url ??
    primaryImage?.resized_image_url ??
    primaryImage?.original_image_url ??
    null

  return {
    monday_item_id: mondayItemId,
    competitor_name: competitor.name,
    competitor_page_id: r.page_id ?? null,
    competitor_page_url: r.page_url ?? competitor.facebookPageUrl ?? null,
    ad_archive_id: r.ad_archive_id,
    was_active_at_scrape: r.is_active ?? true,
    headline: snap.title ?? null,
    body: snap.body?.text ?? null,
    cta_text: snap.cta_text ?? null,
    cta_type: snap.cta_type ?? null,
    creative_type: creativeType,
    creative_url: creativeUrl,
    creative_preview_url: creativePreviewUrl,
    extra_creatives:
      (snap.cards?.length ?? 0) > 1
        ? snap.cards?.map((c) => ({
            title: c.title ?? null,
            body: c.body ?? null,
            image_url: c.image_url ?? null,
            video_url: c.video_hd_url ?? null,
            link_url: c.link_url ?? null,
          }))
        : null,
    platforms: r.publisher_platform ?? null,
    ad_started_at: startedAt?.toISOString() ?? null,
    ad_ended_at: endedAt?.toISOString() ?? null,
    days_running: daysRunning,
    raw_payload: r,
    scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
