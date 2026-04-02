import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

let cachedToken: { value: string; expiresAt: number } | null = null

async function getTrengoToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "trengo")
    .single()
  if (!data) throw new Error("Trengo token not configured. Go to Settings → API Tokens.")
  const token = decrypt(data.token_encrypted)
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function trengoFetch<T>(path: string, retries = 3): Promise<T> {
  const token = (await getTrengoToken()).trim()
  const url = `https://app.trengo.com/api/v2${path}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      next: { revalidate: 300 },
    })

    // Retry on rate limit with exponential backoff
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "", 10)
      const delay = retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt
      await sleep(delay)
      continue
    }

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

  throw new Error("Trengo API rate limit exceeded after retries")
}

export type TrengoChannel = {
  id: number
  name: string
  type: string
}

// Trengo calls these "tickets" in their API
export type TrengoConversation = {
  id: number
  status: string
  subject: string | null
  channel: TrengoChannel | null
  contact: { id: number; name: string; email?: string } | null
  latest_message: { id: number; message: string; type: string; created_at: string } | null
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

type TicketPage = {
  data: TrengoConversation[]
  meta?: { current_page: number; last_page: number }
}

type MessagePage = {
  data: TrengoMessage[]
  meta?: { current_page: number; last_page: number }
}

const MAX_PAGES = 10

export async function fetchConversations(contactId: string): Promise<TrengoConversation[]> {
  const all: TrengoConversation[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const data = await trengoFetch<TicketPage>(
      `/tickets?contact_id=${contactId}&page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

export async function fetchMessages(ticketId: number): Promise<TrengoMessage[]> {
  const all: TrengoMessage[] = []
  let page = 1

  while (page <= MAX_PAGES) {
    const data = await trengoFetch<MessagePage>(
      `/tickets/${ticketId}/messages?page=${page}`
    )
    all.push(...data.data)
    if (!data.meta || page >= data.meta.last_page) break
    page++
  }

  return all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
}
