import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import {
  sanitiseCreativeSettings,
  resolveEffectiveSettings,
  DEFAULT_CREATIVE_SETTINGS,
  type PedroCreativeSettings,
} from "@/lib/pedro/creative-settings"

/**
 * Per-client Pedro creative settings.
 *
 *   GET  → { override: PedroCreativeSettings, effective: ResolvedSettings,
 *           defaults: typeof DEFAULT_CREATIVE_SETTINGS }
 *   PUT  → merges body into existing override and re-returns the GET shape.
 *
 * Storage: `pedro_client_state.creative_settings jsonb` on the highest
 * campaign_number row (same pattern as image-source-prefs). Empty body
 * is treated as "reset" — wipes the override blob.
 *
 * Roy 2026-06-13.
 */

export const dynamic = "force-dynamic"

type DetectedBrand = {
  /** Hex codes Pedro currently uses when no `brandColors` override is set
   *  — derived from brand_style.primaryColor / secondaryColor / accentColor
   *  plus brand_style.pdfDerivedPalette when present. Used by the panel
   *  to seed the brand-colors editor with the auto-detected starting set. */
  colors: string[]
  /** Provenance label for the colours so the UI can tell the CM where they
   *  came from ("Uit website" / "Uit brand book PDF"). */
  source: "pdf" | "website" | "none"
  headingFont: string | null
  bodyFont: string | null
  brandBookFileId: string | null
  brandBookFileName: string | null
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function normaliseHex(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`
  return HEX_RE.test(withHash) ? withHash : null
}

function extractDetectedBrand(brandStyle: Record<string, unknown> | null): DetectedBrand {
  if (!brandStyle) {
    return {
      colors: [],
      source: "none",
      headingFont: null,
      bodyFont: null,
      brandBookFileId: null,
      brandBookFileName: null,
    }
  }

  // PDF palette wins when present — it's the canonical source per existing
  // generate-image precedence (`brandHexFromPdf ?? brandHexFromStyle`).
  const pdfPalette = (brandStyle.pdfDerivedPalette ?? null) as
    | { hexCodes?: unknown; sourceFileId?: unknown; sourceFileName?: unknown }
    | null
  const pdfCodes = Array.isArray(pdfPalette?.hexCodes)
    ? (pdfPalette!.hexCodes as unknown[]).map(normaliseHex).filter((h): h is string => !!h)
    : []

  if (pdfCodes.length > 0) {
    return {
      colors: pdfCodes,
      source: "pdf",
      headingFont: (brandStyle.headingFont as string | undefined) ?? null,
      bodyFont: (brandStyle.bodyFont as string | undefined) ?? null,
      brandBookFileId: (pdfPalette?.sourceFileId as string | undefined) ?? null,
      brandBookFileName: (pdfPalette?.sourceFileName as string | undefined) ?? null,
    }
  }

  // Fall back to website-scraped primary/secondary/accent.
  const candidates = [
    normaliseHex(brandStyle.primaryColor),
    normaliseHex(brandStyle.secondaryColor),
    normaliseHex(brandStyle.accentColor),
  ].filter((h): h is string => !!h)

  return {
    colors: candidates,
    source: candidates.length > 0 ? "website" : "none",
    headingFont: (brandStyle.headingFont as string | undefined) ?? null,
    bodyFont: (brandStyle.bodyFont as string | undefined) ?? null,
    brandBookFileId: null,
    brandBookFileName: null,
  }
}

async function loadOverride(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  clientId: string,
): Promise<{
  row: { id: string; creative_settings: unknown; brand_style: Record<string, unknown> | null } | null
  override: PedroCreativeSettings
  detected: DetectedBrand
}> {
  const { data } = await supabase
    .from("pedro_client_state")
    .select("id, creative_settings, brand_style")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string
      creative_settings: unknown
      brand_style: Record<string, unknown> | null
    }>()
  return {
    row: data ?? null,
    override: sanitiseCreativeSettings(data?.creative_settings),
    detected: extractDetectedBrand(data?.brand_style ?? null),
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { override, detected } = await loadOverride(supabase, clientId)
  return NextResponse.json({
    override,
    effective: resolveEffectiveSettings(override),
    defaults: DEFAULT_CREATIVE_SETTINGS,
    detected,
  })
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { clientId } = await params
  if (!clientId) {
    return NextResponse.json({ error: "clientId is verplicht" }, { status: 400 })
  }

  let body: { settings?: unknown; reset?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const { row, override: current, detected } = await loadOverride(supabase, clientId)

  let next: PedroCreativeSettings | null
  if (body.reset === true) {
    next = null
  } else {
    // Sparse merge: only keys present in the incoming patch get
    // overwritten. Sub-objects (slotStyleDefaults, inspirationSubfolders)
    // are also merged sparsely so a CM can toggle one subfolder without
    // wiping the rest.
    const patch = sanitiseCreativeSettings(body.settings)
    next = {
      ...current,
      ...patch,
      slotStyleDefaults: {
        ...(current.slotStyleDefaults ?? {}),
        ...(patch.slotStyleDefaults ?? {}),
      },
      inspirationSubfolders: {
        ...(current.inspirationSubfolders ?? {}),
        ...(patch.inspirationSubfolders ?? {}),
      },
    }
    // Drop empty sub-objects so the persisted blob stays tight.
    if (Object.keys(next.slotStyleDefaults ?? {}).length === 0) delete next.slotStyleDefaults
    if (Object.keys(next.inspirationSubfolders ?? {}).length === 0) delete next.inspirationSubfolders
  }

  if (row?.id) {
    const { error } = await supabase
      .from("pedro_client_state")
      .update({ creative_settings: next })
      .eq("id", row.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    const { error } = await supabase.from("pedro_client_state").insert({
      client_id: clientId,
      campaign_number: 1,
      creative_settings: next,
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const override = next ?? {}
  return NextResponse.json({
    override,
    effective: resolveEffectiveSettings(override),
    defaults: DEFAULT_CREATIVE_SETTINGS,
    detected,
  })
}
