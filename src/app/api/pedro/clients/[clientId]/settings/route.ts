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

async function loadOverride(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  clientId: string,
): Promise<{ row: { id: string; creative_settings: unknown } | null; override: PedroCreativeSettings }> {
  const { data } = await supabase
    .from("pedro_client_state")
    .select("id, creative_settings")
    .eq("client_id", clientId)
    .order("campaign_number", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; creative_settings: unknown }>()
  return {
    row: data ?? null,
    override: sanitiseCreativeSettings(data?.creative_settings),
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
  const { override } = await loadOverride(supabase, clientId)
  return NextResponse.json({
    override,
    effective: resolveEffectiveSettings(override),
    defaults: DEFAULT_CREATIVE_SETTINGS,
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
  const { row, override: current } = await loadOverride(supabase, clientId)

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
  })
}
