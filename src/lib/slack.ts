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

async function slackGet<T>(method: string, params: Record<string, string>): Promise<T> {
  const token = await getSlackToken()
  const url = new URL(`${SLACK_API}/${method}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!data.ok) throw new Error(`Slack ${method} failed: ${data.error}`)
  return data as T
}

/** Look up a Slack user by their email address. Returns null if not in workspace. */
export async function lookupSlackUserByEmail(email: string): Promise<string | null> {
  try {
    const data = await slackGet<{ user: { id: string } }>("users.lookupByEmail", { email })
    return data.user.id
  } catch (err) {
    if (err instanceof Error && err.message.includes("users_not_found")) return null
    throw err
  }
}

/** Send a plain text DM to a Slack user by their user ID. */
export async function sendSlackDm(slackUserId: string, text: string): Promise<void> {
  await slackPost("chat.postMessage", { channel: slackUserId, text })
}

/** Resolve email → Slack user ID, then send a DM. Throws if not found in workspace. */
export async function sendDmToEmail(email: string, text: string): Promise<{ slackUserId: string }> {
  const userId = await lookupSlackUserByEmail(email)
  if (!userId) throw new Error(`No Slack user found for email: ${email}`)
  await sendSlackDm(userId, text)
  return { slackUserId: userId }
}
