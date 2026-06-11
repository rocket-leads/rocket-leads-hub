import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { buildLpPrompt } from "@/lib/pedro/prompts/build-lp"
import { anglesString, huisstijlForLp } from "@/lib/pedro/prompts/context"
import { loadPedroSystemPrompt } from "@/lib/pedro/knowledge"
import type { Angle, BriefData, BrandStyle } from "@/lib/pedro/helpers"

const anthropic = new Anthropic()

export const maxDuration = 120

/**
 * POST /api/pedro/lp-refresh - body: {
 *   clientId, stijl, lengte, pixelId?, webhookUrl?, utmStr?, steering?,
 *   brief?, selectedAngles?
 * }
 *
 * Generates the Lovable LP prompt the CM can paste straight into the
 * Lovable builder. Different shape from angles/script/creative refresh -
 * not "iterate on winners", just one-shot prompt generation.
 *
 * Order of resolution for brief + angles:
 *   1. Body-supplied values (wizard passes its kickoff_live + brief_
 *      enrichment merged brief here)
 *   2. pedro_client_state fallback (when called from the Pedro Optimize
 *      side rather than the onboarding wizard)
 */

type Body = {
  clientId?: string
  stijl?: string
  lengte?: string
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

  const stijl = body.stijl?.trim() || "Modern - clean, business"
  const lengte = body.lengte?.trim() || "Medium - hero + social proof + form"

  const supabase = await createAdminClient()

  // Pull pedro_client_state for fallback brief / angles / brand_style.
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

  const prompt = buildLpPrompt({
    brief,
    selectedAngles,
    anglesStr: anglesString(selectedAngles),
    huisstijl: huisstijlForLp({
      brandStyle: state?.brand_style ?? null,
      huisstijl: null,
      huisstijlOverride: false,
    }),
    stijl,
    lengte,
    pixelId: body.pixelId?.trim() || undefined,
    webhookUrl: body.webhookUrl?.trim() || undefined,
    utmStr: body.utmStr?.trim() || undefined,
    steering: body.steering?.trim() || undefined,
  })

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
  // Body trims overrule state where present; otherwise keep state value.
  for (const k of Object.keys(empty) as Array<keyof BriefData>) {
    merged[k] = (merged[k] ?? "").trim()
  }
  return merged
}
