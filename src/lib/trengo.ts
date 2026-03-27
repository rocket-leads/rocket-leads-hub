import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

async function getTrengoToken(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "trengo")
    .single()
  if (!data) throw new Error("Trengo token not configured. Go to Settings → API Tokens.")
  return decrypt(data.token_encrypted)
}

async function trengoFetch<T>(path: string): Promise<T> {
  const token = (await getTrengoToken()).trim()
  const url = `https://app.trengo.com/api/v2${path}`

  // Try Bearer first, then Token prefix (Trengo PAT type determines which works)
  for (const prefix of ["Bearer", "Token"]) {
    const res = await fetch(url, {
      headers: { Authorization: `${prefix} ${token}`, Accept: "application/json" },
      cache: "no-store",
    })
    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) continue // wrong prefix, try next

    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(`Trengo API error ${res.status}: ${(data.message as string) ?? JSON.stringify(data)}`)
    }
    return res.json() as Promise<T>
  }

  throw new Error(`Trengo API returned non-JSON for ${path}. Token may be invalid or expired.`)
}

export type TrengoChannel = {
  id: number
  name: string
  type: string
}

export type TrengoConversation = {
  id: number
  status: "open" | "closed"
  subject: string | null
  channel: TrengoChannel | null
  contact: { id: number; name: string; email?: string } | null
  last_message: { body: string; created_at: string } | null
  created_at: string
  closed_at: string | null
  assignee: { name: string } | null
}

export type TrengoMessage = {
  id: number
  body: string
  author_type: "User" | "Contact" | string
  author: { id: number; name: string } | null
  created_at: string
  type: string
  attachments: Array<{ name: string; url: string }> | null
}

type ConversationPage = {
  data: TrengoConversation[]
  meta?: { current_page: number; last_page: number }
}

type MessagePage = {
  data: TrengoMessage[]
  meta?: { current_page: number; last_page: number }
}

export async function fetchConversations(contactId: string): Promise<TrengoConversation[]> {
  const all: TrengoConversation[] = []
  let page = 1

  while (true) {
    const data = await trengoFetch<ConversationPage>(
      `/contacts/${contactId}/conversations?per_page=25&page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function fetchMessages(conversationId: number): Promise<TrengoMessage[]> {
  const all: TrengoMessage[] = []
  let page = 1

  while (true) {
    const data = await trengoFetch<MessagePage>(
      `/conversations/${conversationId}/messages?per_page=50&page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}
