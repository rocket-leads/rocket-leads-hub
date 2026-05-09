import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { isLocale } from "@/lib/i18n/types"
import { NextRequest, NextResponse } from "next/server"

/**
 * Persist the user's UI language choice. Called from the sidebar
 * locale toggle right after the cookie is written, so the next render
 * (or any other browser/device) sees the same preference.
 *
 * The cookie is the source of truth for the *next* render — this
 * endpoint just keeps the DB in sync. Failure here doesn't break the
 * UI; the cookie alone keeps the switch working until the next sign-in.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { locale?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  if (!isLocale(body.locale)) {
    return NextResponse.json({ error: "locale must be 'nl' or 'en'" }, { status: 400 })
  }

  try {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from("users")
      .update({ locale: body.locale })
      .eq("id", session.user.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error("[account/locale] update failed:", e instanceof Error ? e.message : e)
    return NextResponse.json({ error: "Failed to persist locale" }, { status: 500 })
  }
}
