import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getInspirationFolderId } from "@/lib/pedro/visual-reference-library"

/**
 * GET  /api/pedro/inspiration-folder  → { folderId: string | null }
 * POST /api/pedro/inspiration-folder  body: { folderId: string }
 *   Sets the Drive folder id for the AD CREATIVES INSPIRATION root.
 *   Admin-only. Stored in settings(key="pedro_inspiration_folder_id").
 *
 * Roy 2026-06-12: lightweight endpoint zonder een nieuwe Settings-tab
 * te bouwen. CM kan ook direct via Supabase SQL setten:
 *   INSERT INTO settings (key, value)
 *   VALUES ('pedro_inspiration_folder_id', '"FOLDER_ID"'::jsonb)
 *   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
 */

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const folderId = await getInspirationFolderId()
  return NextResponse.json({ folderId })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 })
  }
  let body: { folderId?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const folderId = typeof body.folderId === "string" ? body.folderId.trim() : ""
  if (!folderId) {
    return NextResponse.json(
      { error: "folderId is required (Drive folder id, not URL)" },
      { status: 400 },
    )
  }
  try {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "pedro_inspiration_folder_id", value: folderId }, { onConflict: "key" })
    if (error) throw error
    return NextResponse.json({ folderId })
  } catch (e) {
    console.error(
      "[pedro/inspiration-folder] save failed:",
      e instanceof Error ? e.message : e,
    )
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 500 },
    )
  }
}
