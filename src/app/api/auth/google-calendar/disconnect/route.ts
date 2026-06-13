import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * "Reset to sign-in account" for the Google Calendar connection.
 *
 * Wipes the stored google_* token columns AND the google_calendar_email
 * stamp so the next sign-in flow (or the next time the user re-grants
 * via the sign-in OAuth) seeds them from the sign-in Google account
 * again. We don't try to *revoke* the token at Google — that would
 * break the OAuth state for the other account if Roy ever wants to
 * reconnect — we just forget it on our side. The user can revoke from
 * https://myaccount.google.com/permissions if they want a full cut.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const supabase = await createAdminClient()
    const { error } = await supabase
      .from("users")
      .update({
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: null,
        google_calendar_email: null,
      })
      .eq("id", session.user.id)
    if (error) {
      console.error("[google-calendar/disconnect] supabase error:", error)
      return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
    }
  } catch (e) {
    console.error("[google-calendar/disconnect] threw:", e)
    return NextResponse.json({ error: "Failed to disconnect" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
