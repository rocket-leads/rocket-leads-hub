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
 * Global Pedro creative defaults — the layer between hardcoded defaults
 * and the per-klant override. Admin-managed via /settings → Pedro.
 *
 *   GET → { global: PedroCreativeSettings, effective: ResolvedSettings,
 *          hardcoded: DEFAULT_CREATIVE_SETTINGS }
 *   PUT body: { settings?: PedroCreativeSettings, reset?: boolean }
 *
 * Storage: settings table, key `pedro_global_creative_defaults`, value
 * = sanitised jsonb. Same shape as the per-klant override blob so the
 * three-layer resolver can treat them uniformly.
 *
 * Roy 2026-06-13.
 */

export const dynamic = "force-dynamic"

const SETTINGS_KEY = "pedro_global_creative_defaults"

async function loadGlobal(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
): Promise<PedroCreativeSettings> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle<{ value: unknown }>()
  return sanitiseCreativeSettings(data?.value)
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const supabase = await createAdminClient()
  const global = await loadGlobal(supabase)
  return NextResponse.json({
    global,
    effective: resolveEffectiveSettings(null, global),
    hardcoded: DEFAULT_CREATIVE_SETTINGS,
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { settings?: unknown; reset?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const supabase = await createAdminClient()
  const current = await loadGlobal(supabase)

  let next: PedroCreativeSettings | null
  if (body.reset === true) {
    next = null
  } else {
    // Same sparse merge as the per-klant settings endpoint — sub-objects
    // merge field-by-field so toggling one slot style globally doesn't
    // wipe the rest of the slot styles.
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
    if (Object.keys(next.slotStyleDefaults ?? {}).length === 0) delete next.slotStyleDefaults
    if (Object.keys(next.inspirationSubfolders ?? {}).length === 0) delete next.inspirationSubfolders
  }

  try {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: SETTINGS_KEY, value: next ?? {} }, { onConflict: "key" })
    if (error) throw error
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 500 },
    )
  }

  const global = next ?? {}
  return NextResponse.json({
    global,
    effective: resolveEffectiveSettings(null, global),
    hardcoded: DEFAULT_CREATIVE_SETTINGS,
  })
}
