import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { loadUserMappingsContext, filterClientsByContext } from "@/lib/clients/filter"
import { mondayStatusToHub, type ClientStatus } from "@/lib/clients/status"
import { listInboxItems, listChatThreads, type ChatThreadSummary } from "@/lib/inbox/fetchers"
import { safeFetch } from "@/lib/safe-fetch"

export const dynamic = "force-dynamic"

export type GlobalSearchResults = {
  clients: {
    id: string
    name: string
    status: ClientStatus | null
    boardType: "onboarding" | "current"
  }[]
  tasks: { id: string; title: string; clientName: string | null }[]
  messages: {
    id: string
    title: string
    clientName: string | null
    preview: string | null
    scope: string
  }[]
}

/**
 * Backs the global ⌘K command palette. Returns the full accessible set of
 * clients + the signed-in user's open tasks + their visible chat threads in
 * one pass; the palette caches this on open and filters client-side so typing
 * is instant. Every source goes through the existing access-scoped fetchers
 * (client column-mapping filter, assignee-scoped tasks, chat visibility rules)
 * so search can never surface something the user isn't allowed to see.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const role = session.user.role
  const roleArg = role === "admin" ? "admin" : "member"

  const [boards, tasks, external, internal] = await Promise.all([
    readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
      "monday_boards",
      60 * 60 * 1000,
    ).then((c) => c ?? fetchBothBoards().catch(() => ({ onboarding: [], current: [] }))),
    safeFetch(
      "search:tasks",
      () => listInboxItems(userId, role, { kind: "task", assignedToMe: true, snoozed: "active" }),
      [],
    ),
    safeFetch("search:chat_ext", () => listChatThreads(userId, roleArg, "external"), [] as ChatThreadSummary[]),
    safeFetch("search:chat_int", () => listChatThreads(userId, roleArg, "internal"), [] as ChatThreadSummary[]),
  ])

  const ctx = await loadUserMappingsContext(userId, role)
  const onboarding = filterClientsByContext(boards.onboarding, ctx)
  const current = filterClientsByContext(boards.current, ctx)

  const clients: GlobalSearchResults["clients"] = [
    ...onboarding.map((c) => ({
      id: c.mondayItemId,
      name: c.name,
      status: "onboarding" as ClientStatus | null,
      boardType: "onboarding" as const,
    })),
    ...current.map((c) => ({
      id: c.mondayItemId,
      name: c.name,
      status: mondayStatusToHub(c.campaignStatus, "current"),
      boardType: "current" as const,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name))

  const taskResults: GlobalSearchResults["tasks"] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    clientName: t.clientName || null,
  }))

  const messages: GlobalSearchResults["messages"] = [...external, ...internal].map((t) => ({
    id: t.threadKey,
    title: t.channelName ? `${t.primaryName} · ${t.channelName}` : t.primaryName,
    clientName: t.clientName || null,
    preview: t.latestPreview || null,
    scope: t.scope,
  }))

  return NextResponse.json({ clients, tasks: taskResults, messages } satisfies GlobalSearchResults)
}
