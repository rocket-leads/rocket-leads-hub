import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  buildLpPrompt,
  buildLpOptimizePrompt,
} from "@/lib/pedro/prompts/build-lp"
import { anglesString, huisstijlForLp } from "@/lib/pedro/prompts/context"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import { scrapeWebsiteForBrief } from "@/lib/pedro/website-scrape"
import type { Angle, BriefData, BrandStyle } from "@/lib/pedro/helpers"

const anthropic = new Anthropic()

export const maxDuration = 120

/**
 * POST /api/pedro/lp-refresh
 *
 * Two modes:
 *
 *   1. mode="optimize-existing" (preferred for live clients)
 *      body: { clientId, currentLpUrl, steering, pixelId?, webhookUrl?, utmStr? }
 *      → Scrapes the live LP HTML, asks Pedro to generate a Lovable prompt
 *        that recreates the page with the requested changes baked in.
 *
 *   2. mode="scratch" (onboarding / no LP yet)
 *      body: { clientId, stijl, lengte, pixelId?, webhookUrl?, utmStr?, steering?,
 *              brief?, selectedAngles? }
 *      → Generates a new Lovable prompt from brief + angles.
 *
 * Brief + angles fallback in both modes: body values overrule
 * `pedro_client_state` row, which overrides empty.
 */

type Body = {
  mode?: "scratch" | "optimize-existing"
  clientId?: string
  // scratch-only
  stijl?: string
  lengte?: string
  // optimize-existing-only
  currentLpUrl?: string
  // shared
  pixelId?: string
  webhookUrl?: string
  utmStr?: string
  steering?: string
  brief?: Partial<BriefData>
  selectedAngles?: Angle[]
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const clientId = String(body.clientId ?? "")
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const mode = body.mode ?? "scratch"

  const supabase = await createAdminClient()
  const { data: state } = await supabase
    .from("pedro_client_state")
    .select("brief, selected_angles, brand_style")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{
      brief: Partial<BriefData> | null
      selected_angles: Angle[] | null
      brand_style: BrandStyle | null
    }>()

  const brief = mergeBrief(body.brief, state?.brief)
  const selectedAngles =
    body.selectedAngles && body.selectedAngles.length > 0
      ? body.selectedAngles
      : (state?.selected_angles ?? [])
  const huisstijl = huisstijlForLp({
    brandStyle: state?.brand_style ?? null,
    huisstijl: null,
    huisstijlOverride: false,
  })

  let prompt: string

  if (mode === "optimize-existing") {
    const currentLpUrl = body.currentLpUrl?.trim() ?? ""
    const steering = body.steering?.trim() ?? ""
    if (!currentLpUrl) {
      return NextResponse.json(
        { error: "currentLpUrl is verplicht in optimize-existing modus" },
        { status: 400 },
      )
    }
    if (!steering) {
      return NextResponse.json(
        { error: "steering is verplicht in optimize-existing modus — beschrijf wat je wil veranderen" },
        { status: 400 },
      )
    }

    const scraped = await scrapeWebsiteForBrief(currentLpUrl)
    if (!scraped || !scraped.homepageText) {
      return NextResponse.json(
        { error: `Kon ${currentLpUrl} niet ophalen — check de URL of de pagina is offline.` },
        { status: 400 },
      )
    }

    prompt = buildLpOptimizePrompt({
      brief,
      selectedAngles,
      anglesStr: anglesString(selectedAngles),
      huisstijl,
      currentLpUrl: scraped.finalUrl,
      currentLpText: scraped.homepageText,
      steering,
      pixelId: body.pixelId?.trim() || undefined,
      webhookUrl: body.webhookUrl?.trim() || undefined,
      utmStr: body.utmStr?.trim() || undefined,
    })
  } else {
    const stijl = body.stijl?.trim() || "Modern - clean, business"
    const lengte = body.lengte?.trim() || "Medium - hero + social proof + form"
    prompt = buildLpPrompt({
      brief,
      selectedAngles,
      anglesStr: anglesString(selectedAngles),
      huisstijl,
      stijl,
      lengte,
      pixelId: body.pixelId?.trim() || undefined,
      webhookUrl: body.webhookUrl?.trim() || undefined,
      utmStr: body.utmStr?.trim() || undefined,
      steering: body.steering?.trim() || undefined,
    })
  }

  const system = await loadPedroSystemPrompt()

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 5000,
      system,
      messages: [{ role: "user", content: prompt }],
    })
    const lpPrompt = message.content[0]?.type === "text" ? message.content[0].text.trim() : ""
    return NextResponse.json({
      mode,
      lpPrompt,
      anglesUsed: selectedAngles.length,
      briefSource: body.brief ? "wizard" : "pedro_client_state",
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Claude API fout" },
      { status: 500 },
    )
  }
}

function mergeBrief(
  fromBody: Partial<BriefData> | undefined,
  fromState: Partial<BriefData> | null | undefined,
): BriefData {
  const empty: BriefData = {
    bedrijf: "",
    sector: "",
    doel: "",
    pijn: "",
    aanbod: "",
    usps: "",
    hooksAM: "",
    hooksExtra: "",
  }
  const merged: BriefData = { ...empty, ...(fromState ?? {}), ...(fromBody ?? {}) }
  for (const k of Object.keys(empty) as Array<keyof BriefData>) {
    merged[k] = (merged[k] ?? "").trim()
  }
  return merged
}
