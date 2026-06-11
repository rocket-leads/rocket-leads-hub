import { after, NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { loadUserMappingsContext, filterClientsByContext } from "@/lib/clients/filter"
import { broadcastInvalidate } from "@/lib/realtime/broadcast"
import {
  COPILOT_TOOLS,
  type CopilotAction,
} from "@/lib/copilot/tools"
import { enrichTaskBody } from "@/lib/copilot/enrich"
import type { CopilotPageContext } from "@/lib/copilot/context"

/**
 * Co-pilot async queue.
 *
 * The user types a command and hits Enter - this endpoint inserts a
 * `pending` row into copilot_drafts and returns the id IMMEDIATELY so
 * the command bar can close (no spinner).
 *
 * The actual work (tool-use parse + Hub-context enrichment, 5-10s)
 * happens in an `after()` callback which keeps the serverless function
 * alive past the response. When the draft is ready, the row flips to
 * `ready` and we broadcast a React Query invalidation so the bell
 * badge bumps without polling.
 *
 * Roy 2026-05-22: "I don't want to wait every time I want to dispatch
 * a task" - this endpoint is the fix for that.
 */

export const maxDuration = 60

const anthropic = new Anthropic()

type QueueRequest = {
  input: string
  context: CopilotPageContext
}

type UserRow = { id: string; name: string | null; email: string; role: string | null }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id
  const userRole = session.user.role
  const sessionUserName = session.user.name ?? session.user.email ?? "Me"

  let body: QueueRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const input = body.input?.trim()
  if (!input) {
    return NextResponse.json({ error: "input is required" }, { status: 400 })
  }

  const supabase = await createAdminClient()

  // Insert the pending draft up-front so the user can navigate away
  // immediately. The id is the contract the UI uses to find this draft
  // again once the background work completes.
  const { data: draftRow, error: insertErr } = await supabase
    .from("copilot_drafts")
    .insert({
      user_id: userId,
      input,
      status: "pending",
    })
    .select("id")
    .single()

  if (insertErr || !draftRow) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to queue draft" },
      { status: 500 },
    )
  }

  // Process in background - the response below returns immediately.
  // `after()` is Next.js 15+ stable and keeps the serverless function
  // running past the response so the parse + enrich finishes even when
  // the user closes the tab.
  after(async () => {
    await processDraft({
      draftId: draftRow.id,
      userId,
      userRole,
      sessionUserName,
      input,
      pageContext: body.context,
      supabase,
    })
  })

  return NextResponse.json({ draftId: draftRow.id, status: "pending" }, { status: 202 })
}

async function processDraft(args: {
  draftId: string
  userId: string
  userRole: string
  sessionUserName: string
  input: string
  pageContext: CopilotPageContext
  supabase: Awaited<ReturnType<typeof createAdminClient>>
}) {
  const { draftId, userId, userRole, sessionUserName, input, pageContext, supabase } = args

  try {
    // Pull rosters in parallel - same data the sync endpoint loaded.
    const [usersResult, clientsCache] = await Promise.all([
      supabase
        .from("users")
        .select("id, name, email, role")
        .order("name", { ascending: true, nullsFirst: false }),
      readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
        "monday_boards",
        60 * 60 * 1000,
      ),
    ])

    if (usersResult.error) {
      throw new Error(`users fetch: ${usersResult.error.message}`)
    }
    const users: UserRow[] = (usersResult.data ?? []) as UserRow[]

    const boards = clientsCache ?? (await fetchBothBoards())
    const mappingsContext = await loadUserMappingsContext(userId, userRole)
    const visibleClients = [
      ...filterClientsByContext(boards.onboarding, mappingsContext),
      ...filterClientsByContext(boards.current, mappingsContext),
    ]

    const today = new Date().toISOString().slice(0, 10)

    const systemPrompt = buildSystemPrompt({
      today,
      sessionUser: { id: userId, name: sessionUserName },
      users,
      clients: visibleClients,
      pageContext,
    })

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      tools: COPILOT_TOOLS,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: input }],
    })

    const toolUse = message.content.find((c) => c.type === "tool_use")
    if (!toolUse || toolUse.type !== "tool_use") {
      const text = message.content.find((c) => c.type === "text")
      const msg =
        text?.type === "text"
          ? text.text.trim()
          : "Ik begrijp niet helemaal wat je wilt. Kun je het iets specifieker formuleren?"
      await markFailed(supabase, draftId, msg)
      return
    }

    const action = normalizeAction(toolUse.name, toolUse.input as Record<string, unknown>)
    if (!action) {
      await markFailed(supabase, draftId, `Unknown tool '${toolUse.name}'.`)
      return
    }

    // Enrichment pass - only for task creation with a real client.
    let sourcesUsed: string[] = []
    if (action.type === "create_task" && action.clientId) {
      const client = visibleClients.find((c) => c.mondayItemId === action.clientId)
      if (client) {
        const assigneeName =
          users.find((u) => u.id === action.assigneeId)?.name ??
          users.find((u) => u.id === action.assigneeId)?.email ??
          null
        const enrichment = await enrichTaskBody({
          userInput: input,
          taskTitle: action.title,
          originalBody: action.body,
          client,
          supabase,
          assigneeName,
        })
        action.body = enrichment.body || action.body
        sourcesUsed = enrichment.sourcesUsed
      }
    }

    const summary = describeAction(action, users, visibleClients)

    await supabase
      .from("copilot_drafts")
      .update({
        status: "ready",
        draft_action: action,
        summary,
        sources_used: sourcesUsed,
        ready_at: new Date().toISOString(),
      })
      .eq("id", draftId)

    // Bump every open tab's bell badge.
    await broadcastInvalidate(["copilot-drafts"])
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Processing failed"
    console.error("[copilot/queue] processDraft failed:", msg)
    await markFailed(supabase, draftId, msg)
  }
}

async function markFailed(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  draftId: string,
  error: string,
) {
  await supabase
    .from("copilot_drafts")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
    })
    .eq("id", draftId)
  await broadcastInvalidate(["copilot-drafts"])
}

// ─── Helpers (mirrors the legacy /api/copilot/parse route) ─────────────────

function buildSystemPrompt(args: {
  today: string
  sessionUser: { id: string; name: string }
  users: UserRow[]
  clients: MondayClient[]
  pageContext: CopilotPageContext
}): string {
  const userRoster = args.users
    .map((u) => `- ${u.name ?? u.email} <${u.email}> id=${u.id} role=${u.role ?? "?"}`)
    .join("\n")

  const clientRoster = args.clients
    .map((c) => `- ${c.name} id=${c.mondayItemId}`)
    .join("\n")

  const pageHint = args.pageContext.currentClientId
    ? `User is currently viewing client id=${args.pageContext.currentClientId}${
        args.pageContext.currentClientTab ? ` (tab: ${args.pageContext.currentClientTab})` : ""
      }. When the user says "this client", "here", "deze klant", they mean this one.`
    : `User is on page ${args.pageContext.pathname}. No specific client is selected.`

  return `You are the Rocket Leads Hub co-pilot. You parse natural-language commands (Dutch or English) into structured tool calls. Always call exactly one tool - never reply with prose unless the input is genuinely ambiguous or unsupported, in which case return a short clarifying question as plain text.

Today is ${args.today}. The signed-in user is ${args.sessionUser.name} (id=${args.sessionUser.id}).

${pageHint}

When resolving relative dates: "today"/"vandaag" → ${args.today}; "tomorrow"/"morgen" → ${addDays(args.today, 1)}; weekday names → the next occurrence of that weekday (or today if it matches). Always return YYYY-MM-DD.

When resolving people names: pick the best match from the roster below. "Mike", "Miek", "Maik" likely all map to whoever in the roster has "Mike" or similar. If multiple people share a first name, prefer the one who fits the role implied by the task (e.g. campaign manager for creative work).

When resolving client names: pick the best fuzzy match from the client roster. "Vlex" → "Vlex Vending". "RL" / "Rocket Leads" → the Rocket Leads client. If the user says "this client" or "deze klant" and a current client is in page context, use that id.

USER ROSTER:
${userRoster}

CLIENT ROSTER (${args.clients.length} clients):
${clientRoster}

Always return tool args with the literal id strings from these rosters - never invent ids.`
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function normalizeAction(
  name: string,
  input: Record<string, unknown>,
): CopilotAction | null {
  switch (name) {
    case "create_task":
      if (typeof input.title !== "string" || typeof input.assigneeId !== "string") return null
      return {
        type: "create_task",
        title: input.title,
        body: typeof input.body === "string" ? input.body : undefined,
        assigneeId: input.assigneeId,
        clientId: typeof input.clientId === "string" ? input.clientId : undefined,
        dueDate: typeof input.dueDate === "string" ? input.dueDate : undefined,
        priority:
          input.priority === "low" || input.priority === "normal" || input.priority === "high"
            ? input.priority
            : undefined,
      }
    case "trigger_pedro_refresh":
      if (typeof input.clientId !== "string") return null
      return {
        type: "trigger_pedro_refresh",
        clientId: input.clientId,
        days: typeof input.days === "number" ? input.days : undefined,
      }
    case "navigate_to_client":
      if (typeof input.clientId !== "string") return null
      return {
        type: "navigate_to_client",
        clientId: input.clientId,
        tab:
          input.tab === "campaigns" ||
          input.tab === "billing" ||
          input.tab === "communication" ||
          input.tab === "settings"
            ? input.tab
            : undefined,
      }
    default:
      return null
  }
}

function describeAction(
  action: CopilotAction,
  users: UserRow[],
  clients: MondayClient[],
): string {
  const userName = (id: string) =>
    users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? id
  const clientName = (id: string) => clients.find((c) => c.mondayItemId === id)?.name ?? id

  switch (action.type) {
    case "create_task": {
      const parts = [`Create task: "${action.title}"`, `Assigned to: ${userName(action.assigneeId)}`]
      if (action.clientId) parts.push(`Client: ${clientName(action.clientId)}`)
      if (action.dueDate) parts.push(`Due: ${action.dueDate}`)
      if (action.priority && action.priority !== "normal") parts.push(`Priority: ${action.priority}`)
      return parts.join(" · ")
    }
    case "trigger_pedro_refresh":
      return `Run Pedro creative refresh for ${clientName(action.clientId)}${action.days ? ` (${action.days}d lookback)` : ""}`
    case "navigate_to_client":
      return `Open ${clientName(action.clientId)}${action.tab ? ` → ${action.tab}` : ""}`
  }
}
