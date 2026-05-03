import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { exchangeSlackCode } from "@/lib/integrations/slack-oauth"
import { setUserPlatformToken } from "@/lib/inbox/user-platform-tokens"

/**
 * Step 2 of the Slack OAuth flow: Slack redirects here with `code` + `state`.
 * We validate the state CSRF cookie, exchange the code for tokens, and store
 * the user-token in `user_platform_tokens` so future replies can post as the
 * user (not as the system bot).
 *
 * The bot-token returned alongside is intentionally NOT stored by us — Slack's
 * own install state is enough for Events API delivery. We only need the
 * user-token for impersonation when sending replies.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const error = url.searchParams.get("error")

  // Slack will append ?error=access_denied if the user cancels.
  if (error || !code || !state) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", error ?? "missing_code_or_state")
    return NextResponse.redirect(failUrl)
  }

  // CSRF guard: state cookie must match the state Slack returned. The cookie
  // also tells us which Hub user this token belongs to.
  const cookie = req.cookies.get("slack_oauth_state")?.value
  if (!cookie) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", "missing_state_cookie")
    return NextResponse.redirect(failUrl)
  }
  const [cookieState, cookieUserId] = cookie.split(":")
  if (!cookieState || !cookieUserId || cookieState !== state) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", "state_mismatch")
    return NextResponse.redirect(failUrl)
  }

  // Belt-and-braces: also confirm an authenticated session exists and matches
  // the cookie user — refuses to install someone else's token.
  const session = await auth()
  if (!session?.user?.id || session.user.id !== cookieUserId) {
    return NextResponse.redirect(new URL("/auth/signin", req.url))
  }

  const redirectUri = `${url.origin}/api/auth/slack/callback`

  let oauth
  try {
    oauth = await exchangeSlackCode(code, redirectUri)
  } catch (e) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", e instanceof Error ? e.message : "exchange_failed")
    return NextResponse.redirect(failUrl)
  }

  if (!oauth.ok || !oauth.authed_user?.access_token) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", oauth.error ?? "oauth_failed")
    return NextResponse.redirect(failUrl)
  }

  try {
    await setUserPlatformToken(
      session.user.id,
      "slack",
      oauth.authed_user.access_token,
      {
        slack_user_id: oauth.authed_user.id,
        team_id: oauth.team?.id ?? null,
        team_name: oauth.team?.name ?? null,
        scope: oauth.authed_user.scope ?? null,
      },
    )
  } catch (e) {
    const failUrl = new URL("/account", req.url)
    failUrl.searchParams.set("slack_error", e instanceof Error ? e.message : "store_failed")
    return NextResponse.redirect(failUrl)
  }

  // Clear the state cookie now that we're done with it.
  const successUrl = new URL("/account", req.url)
  successUrl.searchParams.set("slack", "connected")
  const res = NextResponse.redirect(successUrl)
  res.cookies.delete("slack_oauth_state")
  return res
}
