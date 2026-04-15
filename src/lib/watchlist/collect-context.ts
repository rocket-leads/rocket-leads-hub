import { fetchClientBoardItemsWithUpdates } from "@/lib/integrations/monday"
import { fetchConversations, fetchMessages } from "@/lib/integrations/trengo"
import type { MondayClient } from "@/lib/integrations/monday"
import type { TrengoMessage } from "@/lib/integrations/trengo"

export type ClientContext = {
  mondayUpdates: string
  trengoSummary: string
  collectedAt: string
}

// --- Monday Updates ---

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Collect Monday CRM updates for a client's board.
 * Groups by UTM, extracts lead status patterns and recent update text.
 * Returns a condensed summary string (max ~600 chars).
 */
export async function collectMondayContext(client: MondayClient): Promise<string> {
  if (!client.clientBoardId) return ""

  try {
    const items = await fetchClientBoardItemsWithUpdates(client.clientBoardId)
    if (items.length === 0) return ""

    const cutoff = daysAgo(14)

    // Collect all updates from the last 14 days
    const recentUpdates: Array<{ utm: string; text: string; status: string }> = []
    const statusCounts: Record<string, number> = {}

    for (const item of items) {
      // Count lead statuses
      if (item.leadStatus) {
        statusCounts[item.leadStatus] = (statusCounts[item.leadStatus] || 0) + 1
      }

      // Only include updates from the last 14 days
      for (const update of item.updates) {
        if (update.createdAt >= cutoff && update.text.trim()) {
          recentUpdates.push({
            utm: item.utm || "unknown",
            text: update.text.trim().slice(0, 200),
            status: item.leadStatus,
          })
        }
      }
    }

    const parts: string[] = []

    // Lead status distribution
    const statusSummary = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", ")
    if (statusSummary) parts.push(`Lead statuses: ${statusSummary}`)

    // Recent update texts (most recent first, deduplicated, max 8)
    const seen = new Set<string>()
    const uniqueUpdates = recentUpdates
      .filter((u) => {
        const key = u.text.slice(0, 50).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)

    if (uniqueUpdates.length > 0) {
      const updateLines = uniqueUpdates.map((u) => {
        const prefix = u.status ? `[${u.status}]` : ""
        return `${prefix} ${u.text.slice(0, 120)}`
      })
      parts.push(`Recent updates (${uniqueUpdates.length}):\n${updateLines.join("\n")}`)
    }

    return parts.join("\n") || ""
  } catch (e) {
    console.error(`Monday context error for ${client.name}:`, e instanceof Error ? e.message : String(e))
    return ""
  }
}

// --- Trengo Conversations ---

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Collect recent Trengo conversations for a client.
 * Fetches last 3 conversations (within 14 days) with their messages.
 * Returns a condensed summary of inbound + outbound communication.
 */
export async function collectTrengoContext(client: MondayClient): Promise<string> {
  if (!client.trengoContactId) return ""

  try {
    const conversations = await fetchConversations(client.trengoContactId)
    if (conversations.length === 0) return ""

    const cutoff = daysAgo(14)

    // Take the last 3 recent conversations
    const recent = conversations
      .filter((c) => c.created_at >= cutoff || (c.latest_message && c.latest_message.created_at >= cutoff))
      .slice(0, 3)

    if (recent.length === 0) return ""

    const parts: string[] = []

    for (const conv of recent) {
      let messages: TrengoMessage[]
      try {
        messages = await fetchMessages(conv.id)
      } catch {
        continue
      }

      // Take last 10 messages
      const recentMessages = messages.slice(-10)
      if (recentMessages.length === 0) continue

      const msgLines: string[] = []
      for (const msg of recentMessages) {
        const body = stripHtml(msg.body).slice(0, 200)
        if (!body) continue

        const who = msg.author_type === "Contact" ? "CLIENT" : "RL"
        const date = msg.created_at.slice(0, 10)
        msgLines.push(`[${date}] ${who}: ${body}`)
      }

      if (msgLines.length > 0) {
        const channel = conv.channel?.type ?? "unknown"
        parts.push(`Conversation (${channel}, ${conv.status}):\n${msgLines.join("\n")}`)
      }
    }

    return parts.join("\n---\n") || ""
  } catch (e) {
    console.error(`Trengo context error for ${client.name}:`, e instanceof Error ? e.message : String(e))
    return ""
  }
}

/**
 * Collect both Monday updates and Trengo conversations for a client.
 */
export async function collectClientContext(client: MondayClient): Promise<ClientContext> {
  const [mondayUpdates, trengoSummary] = await Promise.all([
    collectMondayContext(client),
    collectTrengoContext(client),
  ])

  return {
    mondayUpdates,
    trengoSummary,
    collectedAt: new Date().toISOString(),
  }
}
