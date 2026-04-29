import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const SLACK_API = "https://slack.com/api"

async function getSlackToken(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "slack")
    .single()
  if (!data) throw new Error("Slack token not configured.")
  return decrypt(data.token_encrypted)
}

async function slackPost<T>(method: string, body: object): Promise<T> {
  const token = await getSlackToken()
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
  return data as T
}

/** Send a plain text DM to a Slack user by their workspace user ID (e.g. U01ABC234XY). */
export async function sendSlackDm(slackUserId: string, text: string): Promise<void> {
  await slackPost("chat.postMessage", { channel: slackUserId, text })
}

/** Look up the Slack user ID for a Hub user. Returns null if not configured. */
export async function getSlackIdForHubUser(hubUserId: string): Promise<string | null> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("users")
    .select("slack_user_id")
    .eq("id", hubUserId)
    .single()
  return data?.slack_user_id ?? null
}

/** Resolve Hub user → their stored Slack ID and send a DM. */
export async function sendDmToHubUser(hubUserId: string, text: string): Promise<void> {
  const slackId = await getSlackIdForHubUser(hubUserId)
  if (!slackId) throw new Error(`No Slack user ID configured for Hub user ${hubUserId}`)
  await sendSlackDm(slackId, text)
}
