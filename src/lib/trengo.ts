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
  const token = await getTrengoToken()
  const res = await fetch(`https://app.trengo.com/api/v2${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    next: { revalidate: 0 },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Trengo API error ${res.status}: ${text}`)
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

export async function fetchConversations(contactId: string): Promise<TrengoConversation[]> {
  const all: TrengoConversation[] = []
  let page = 1

  while (true) {
    const data = await trengoFetch<ConversationPage>(
      `/conversations?contact_id=${contactId}&per_page=25&page=${page}`
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
