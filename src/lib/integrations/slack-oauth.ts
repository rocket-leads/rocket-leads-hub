import crypto from "crypto"

/**
 * Slack OAuth v2 helpers + Events API signature verification.
 *
 * Required Slack app scopes (configure in api.slack.com/apps):
 *
 * Bot Token Scopes:
 *   app_mentions:read, channels:history, chat:write,
 *   groups:history, im:history, mpim:history
 *
 * User Token Scopes:
 *   chat:write, users:read
 *
 * The bot token is installed once per workspace; user tokens are issued per
 * user that runs through the Connect Slack flow on /account, and stored in
 * `user_platform_tokens`. The bot token isn't stored by us — Slack delivers
 * events directly to our webhook based on the workspace install.
 */

const BOT_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "chat:write",
  "groups:history",
  "im:history",
  "mpim:history",
]

const USER_SCOPES = [
  "chat:write",
  "users:read",
]

export type SlackOAuthResponse = {
  ok: boolean
  error?: string
  app_id?: string
  authed_user?: {
    id: string
    scope: string
    access_token: string
    token_type: string
  }
  scope?: string
  token_type?: string
  access_token?: string // bot token
  bot_user_id?: string
  team?: { id: string; name: string }
  enterprise?: { id: string; name: string } | null
}

/** Build the Slack OAuth v2 authorize URL with our scopes + state CSRF. */
export function buildSlackAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) throw new Error("SLACK_CLIENT_ID not configured")

  const params = new URLSearchParams({
    client_id: clientId,
    scope: BOT_SCOPES.join(","),
    user_scope: USER_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  })
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`
}

/** Exchange the OAuth `code` for tokens via Slack's `oauth.v2.access`. */
export async function exchangeSlackCode(
  code: string,
  redirectUri: string,
): Promise<SlackOAuthResponse> {
  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("SLACK_CLIENT_ID or SLACK_CLIENT_SECRET not configured")
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  })

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })

  const data = (await res.json()) as SlackOAuthResponse
  return data
}

/**
 * Verify a Slack Events API request signature (v0).
 *
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * Returns false on missing secret, missing headers, replay (>5min old), or
 * a non-matching HMAC. Caller should reject with 401 in any of those cases.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) {
    console.error("SLACK_SIGNING_SECRET not configured")
    return false
  }
  if (!timestamp || !signature) return false

  // Replay protection — Slack recommends rejecting requests older than 5 min.
  const ts = parseInt(timestamp, 10)
  if (!Number.isFinite(ts)) return false
  const fiveMinutes = 60 * 5
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > fiveMinutes) return false

  const baseString = `v0:${timestamp}:${rawBody}`
  const computed = "v0=" + crypto
    .createHmac("sha256", secret)
    .update(baseString)
    .digest("hex")

  // Length-mismatched buffers throw with timingSafeEqual; guard first.
  if (computed.length !== signature.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}
