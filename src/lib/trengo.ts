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

let cachedTrengoToken: string | null = null

async function trengoFetch<T>(path: string): Promise<T> {
  if (!cachedTrengoToken) {
    cachedTrengoToken = (await getTrengoToken()).trim()
  }
  const token = cachedTrengoToken
  const url = `https://app.trengo.com/api/v2${path}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  })
  const contentType = res.headers.get("content-type") ?? ""

  if (!contentType.includes("application/json")) {
    throw new Error(`Trengo endpoint not found: ${path}`)
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new Error(`Trengo API error ${res.status}: ${(data.message as string) ?? JSON.stringify(data)}`)
  }
  return res.json() as Promise<T>
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

async function fetchConversationsFromPath(
  pathFn: (page: number) => string
): Promise<TrengoConversation[]> {
  const all: TrengoConversation[] = []
  let page = 1
  while (true) {
    const data = await trengoFetch<ConversationPage>(pathFn(page))
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }
  return all
}

export async function fetchConversations(contactId: string): Promise<TrengoConversation[]> {
  // Try endpoint patterns in order — Trengo API varies by account/plan
  const patterns: Array<(page: number) => string> = [
    (p) => `/contacts/${contactId}/conversations?per_page=25&page=${p}`,
    (p) => `/conversations?contact_id=${contactId}&per_page=25&page=${p}`,
    (p) => `/tickets?contact_id=${contactId}&per_page=25&page=${p}`,
  ]

  for (const pattern of patterns) {
    try {
      const all = await fetchConversationsFromPath(pattern)
      return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) continue
      throw e // real API error — don't try next
    }
  }

  throw new Error("Could not load conversations — no working Trengo endpoint found for this account.")
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
