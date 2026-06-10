import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { fetchClientById } from "@/lib/integrations/monday"
import { createAdminClient } from "@/lib/supabase/server"
import {
  findCompetitors,
  scrapeWinningAds,
  type CompetitorSuggestion,
} from "@/lib/onboarding/competitor-research"

// Apify scraper runs can take 60s+ per competitor; allow up to 5 min
// for a 5-7 competitor batch. Matches the brief-generation route's
// ceiling pattern.
export const maxDuration = 300

/**
 * Competitor research + winning-ads scraper for the onboarding wizard's
 * Client Brief step.
 *
 * Two POST modes driven by `action`:
 *
 *   action: "find"   — Phase 1. Body picks up brief context (sector,
 *                      country, ICP, USPs from the wizard step's stored
 *                      content). Claude returns 5-8 competitor suggestions.
 *                      AM reviews + approves, then triggers …
 *
 *   action: "scrape" — Phase 2. Body lists AM-approved competitors plus
 *                      country. Apify scrapes their currently-active ads;
 *                      every result lands in `client_competitor_ads`
 *                      with days-running. The UI fetches the rows back
 *                      via GET so the AM can pick winners.
 *
 * The split avoids paying for an Apify run before the AM has a chance to
 * trim the AI's suggestions.
 */

type FindBody = {
  action: "find"
  brief: {
    country?: string
    sector?: string
    doelgroep?: string
    aanbod?: string
    usps?: string
  }
  existingNotes?: string
}

type ScrapeBody = {
  action: "scrape"
  country: string
  competitors: CompetitorSuggestion[]
  maxAdsPerCompetitor?: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const body = (await req.json()) as FindBody | ScrapeBody

  if (body.action === "find") {
    // Pull the client's display name from Monday so the AI prompt can
    // self-exclude it. Fall back to the bare ID if Monday is briefly
    // unavailable — the AI still works, just won't filter the self-
    // match perfectly.
    const client = await fetchClientById(mondayItemId).catch(() => null)
    try {
      const competitors = await findCompetitors({
        ownCompanyName: client?.companyName || client?.name || "",
        country: body.brief.country || "NL",
        sector: body.brief.sector ?? "",
        doelgroep: body.brief.doelgroep ?? "",
        aanbod: body.brief.aanbod ?? "",
        usps: body.brief.usps ?? "",
        existingNotes: body.existingNotes,
      })
      return NextResponse.json({ competitors })
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Competitor research failed"
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  if (body.action === "scrape") {
    if (!Array.isArray(body.competitors) || body.competitors.length === 0) {
      return NextResponse.json(
        { error: "competitors array is required" },
        { status: 400 },
      )
    }
    try {
      const result = await scrapeWinningAds({
        mondayItemId,
        competitors: body.competitors,
        country: body.country || "NL",
        maxAdsPerCompetitor: body.maxAdsPerCompetitor,
      })
      return NextResponse.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Apify scrape failed"
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}

/**
 * GET — return all scraped ads for this client. UI uses this to render
 * the picker grid after a scrape completes (or on revisit). Sorted by
 * days_running desc so the strongest "winners" land at the top.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const supabase = await createAdminClient()

  const { data, error } = await supabase
    .from("client_competitor_ads")
    .select("*")
    .eq("monday_item_id", mondayItemId)
    .order("days_running", { ascending: false, nullsFirst: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ads: data ?? [] })
}

/**
 * PATCH — toggle the `selected_by_am` flag on an individual ad. The
 * UI's "save to Drive" step reads only rows where this is true.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: mondayItemId } = await params
  const body = (await req.json()) as { adId?: string; selected?: boolean }
  if (!body.adId || typeof body.selected !== "boolean") {
    return NextResponse.json({ error: "adId and selected required" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { error } = await supabase
    .from("client_competitor_ads")
    .update({
      selected_by_am: body.selected,
      selected_at: body.selected ? new Date().toISOString() : null,
      selected_by: body.selected ? session.user.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.adId)
    .eq("monday_item_id", mondayItemId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
