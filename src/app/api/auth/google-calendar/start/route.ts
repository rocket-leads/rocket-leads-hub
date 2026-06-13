import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { auth } from "@/lib/auth"

/**
 * Step 1 of the "connect a different Google account for Calendar" flow.
 *
 * Separate from NextAuth's sign-in OAuth: the sign-in flow ties the user's
 * session to their Hub identity, while this flow ONLY captures calendar
 * tokens for whichever Google account the user picks (often a different
 * account from the one they sign in with — e.g. roelharst@gmail.com signs
 * in, but reads calendar from contact@rocket-leads.nl).
 *
 * Standard OAuth 2.0 dance: generate a CSRF state, stash it in an HttpOnly
 * cookie along with the Hub user_id, redirect to Google. The callback
 * verifies state, exchanges the code for tokens, and overwrites the
 * stored google_* token columns on the user's row plus stamps
 * google_calendar_email with the picked account.
 *
 * `prompt=select_account` so Google always shows the account picker even
 * when the user is already signed into a Google account in this browser —
 * that's the whole point of this flow vs sign-in.
 */

const OAUTH_STATE_COOKIE = "google_cal_oauth_state"
const STATE_COOKIE_MAX_AGE = 60 * 10 // 10 minutes

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", req.url))
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("google_calendar_error", "oauth_not_configured")
    return NextResponse.redirect(failUrl)
  }

  const state = crypto.randomBytes(24).toString("hex")
  const redirectUri = `${req.nextUrl.origin}/api/auth/google-calendar/callback`

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  authUrl.searchParams.set("client_id", clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set(
    "scope",
    "openid email https://www.googleapis.com/auth/calendar.events",
  )
  authUrl.searchParams.set("access_type", "offline")
  // Force the account-chooser AND a fresh consent so we always receive a
  // refresh_token (Google only hands one out on explicit consent).
  authUrl.searchParams.set("prompt", "consent select_account")
  authUrl.searchParams.set("state", state)
  // include_granted_scopes lets Google merge the existing sign-in grant
  // with this new one — harmless when the user picks a different account.
  authUrl.searchParams.set("include_granted_scopes", "true")

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set({
    name: OAUTH_STATE_COOKIE,
    value: `${state}:${session.user.id}`,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE,
    path: "/",
  })
  return res
}
