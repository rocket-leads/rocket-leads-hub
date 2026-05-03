import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { auth } from "@/lib/auth"
import { buildSlackAuthUrl } from "@/lib/integrations/slack-oauth"

/**
 * Step 1 of the Slack OAuth flow: generate a CSRF state token, persist it in
 * an HttpOnly cookie, and 302-redirect the user to Slack's authorize URL.
 *
 * The state cookie is validated in the callback to prevent OAuth-flow
 * hijacking. Cookie also stores the user_id so the callback knows which Hub
 * user the resulting Slack user-token belongs to (the session might not be
 * available across the redirect on some platforms).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", req.url))
  }

  const state = crypto.randomBytes(24).toString("hex")
  const redirectUri = `${req.nextUrl.origin}/api/auth/slack/callback`

  const authUrl = buildSlackAuthUrl(state, redirectUri)
  const res = NextResponse.redirect(authUrl)

  // 10 minutes is plenty for the OAuth round-trip; longer leaves a stale
  // CSRF window for no benefit.
  res.cookies.set({
    name: "slack_oauth_state",
    value: `${state}:${session.user.id}`,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  })

  return res
}
