import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { encrypt } from "@/lib/encryption"

/**
 * Step 2 of the "connect a different Google account for Calendar" flow.
 *
 * Verifies the CSRF state cookie, exchanges the OAuth code for an
 * access/refresh token pair, hits Google's userinfo endpoint to learn
 * which email the user actually picked, then overwrites the user row's
 * google_access_token / google_refresh_token / google_token_expires_at
 * and stamps google_calendar_email with that picked email.
 *
 * Errors redirect back to /account with a google_calendar_error query
 * param so the UI can render an inline message instead of a generic
 * 500 page.
 */

const OAUTH_STATE_COOKIE = "google_cal_oauth_state"

function failRedirect(req: NextRequest, code: string): NextResponse {
  const failUrl = new URL("/account", req.url)
  failUrl.searchParams.set("google_calendar_error", code)
  return NextResponse.redirect(failUrl)
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", req.url))
  }

  const code = req.nextUrl.searchParams.get("code")
  const stateParam = req.nextUrl.searchParams.get("state")
  const error = req.nextUrl.searchParams.get("error")

  if (error) {
    return failRedirect(req, error === "access_denied" ? "access_denied" : "oauth_failed")
  }
  if (!code || !stateParam) {
    return failRedirect(req, "missing_code_or_state")
  }

  // CSRF check — the state we minted in /start gets echoed back here.
  const stateCookie = req.cookies.get(OAUTH_STATE_COOKIE)?.value
  if (!stateCookie) {
    return failRedirect(req, "missing_state_cookie")
  }
  const [cookieState, cookieUserId] = stateCookie.split(":")
  if (cookieState !== stateParam) {
    return failRedirect(req, "state_mismatch")
  }
  if (cookieUserId !== session.user.id) {
    // Session changed mid-flow — refuse to attach this token to the
    // currently-signed-in user since it was minted for someone else.
    return failRedirect(req, "session_mismatch")
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return failRedirect(req, "oauth_not_configured")
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/google-calendar/callback`

  // ── Exchange code for tokens ──────────────────────────────────────
  let tokenJson: {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    })
    if (!tokenRes.ok) {
      console.error(
        "[google-calendar/callback] token exchange failed:",
        tokenRes.status,
        await tokenRes.text(),
      )
      return failRedirect(req, "exchange_failed")
    }
    tokenJson = await tokenRes.json()
  } catch (e) {
    console.error("[google-calendar/callback] token fetch threw:", e)
    return failRedirect(req, "exchange_failed")
  }

  if (!tokenJson.access_token) {
    return failRedirect(req, "exchange_failed")
  }
  // refresh_token can be absent if the user previously consented and
  // Google decided not to re-issue one. We forced prompt=consent in
  // /start to make this rare, but if it still happens we can't keep
  // calls alive past 1h — bail rather than half-connect.
  if (!tokenJson.refresh_token) {
    return failRedirect(req, "no_refresh_token")
  }

  // ── Find out which Google account the user picked ─────────────────
  let pickedEmail: string | null = null
  try {
    const infoRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
    )
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { email?: string }
      pickedEmail = info.email?.toLowerCase() ?? null
    }
  } catch (e) {
    console.error("[google-calendar/callback] userinfo fetch failed:", e)
  }
  if (!pickedEmail) {
    // Best-effort — the calendar API will still work without knowing
    // the email, we just can't show "Connected as X" in settings.
    return failRedirect(req, "userinfo_failed")
  }

  // ── Persist tokens + the picked email on the user's row ───────────
  const expiresAt = new Date(
    Date.now() + tokenJson.expires_in * 1000,
  ).toISOString()
  try {
    const supabase = await createAdminClient()
    const { error: updateError } = await supabase
      .from("users")
      .update({
        google_access_token: encrypt(tokenJson.access_token),
        google_refresh_token: encrypt(tokenJson.refresh_token),
        google_token_expires_at: expiresAt,
        google_calendar_email: pickedEmail,
      })
      .eq("id", session.user.id)
    if (updateError) {
      console.error(
        "[google-calendar/callback] supabase update error:",
        updateError,
      )
      return failRedirect(req, "store_failed")
    }
  } catch (e) {
    console.error("[google-calendar/callback] persist threw:", e)
    return failRedirect(req, "store_failed")
  }

  // Clear the state cookie + redirect back to settings with a success flag.
  const successUrl = new URL("/account", req.url)
  successUrl.searchParams.set("google_calendar_connected", pickedEmail)
  const res = NextResponse.redirect(successUrl)
  res.cookies.delete(OAUTH_STATE_COOKIE)
  return res
}
