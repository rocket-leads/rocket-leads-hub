import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET/PATCH /api/clients/[id]/meta-push-config
 *
 * Tiny Supabase-only endpoint for the Push-to-Meta config fields that
 * don't live on Monday boards. Right now: `facebook_page_id`. Bypasses
 * the full Monday-mirror edit pipeline because Monday doesn't carry
 * these fields and we don't want to thread them through monday_boards
 * cache patching.
 *
 * Roy 2026-06-09.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params

  try {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
      .from("clients")
      .select("facebook_page_id")
      .eq("monday_item_id", id)
      .maybeSingle<{ facebook_page_id: string | null }>()
    if (error) throw error
    return NextResponse.json({
      facebookPageId: data?.facebook_page_id ?? "",
    })
  } catch (e) {
    console.error(
      "[clients/meta-push-config GET] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load config" },
      { status: 500 },
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { id } = await params

  let body: { facebookPageId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Trim + accept empty string to clear the field.
  const value =
    typeof body.facebookPageId === "string" ? body.facebookPageId.trim() : null
  if (value === null) {
    return NextResponse.json({ error: "facebookPageId is required (string)" }, { status: 400 })
  }
  if (value && !/^\d{8,20}$/.test(value)) {
    return NextResponse.json(
      { error: "Facebook Page ID moet uit cijfers bestaan (8-20 digits). Vind je page id in Meta Business Manager → Pages → page settings." },
      { status: 400 },
    )
  }

  try {
    const supabase = await createAdminClient()
    // Upsert by monday_item_id — handles both "client row exists" and
    // legacy cases where it doesn't yet.
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("monday_item_id", id)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase
        .from("clients")
        .update({ facebook_page_id: value || null })
        .eq("monday_item_id", id)
      if (error) throw error
    } else {
      const { error } = await supabase
        .from("clients")
        .insert({ monday_item_id: id, facebook_page_id: value || null })
      if (error) throw error
    }

    return NextResponse.json({ facebookPageId: value })
  } catch (e) {
    console.error(
      "[clients/meta-push-config PATCH] failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 500 },
    )
  }
}
