import { NextRequest, NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { readCache } from "@/lib/cache"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { loadUserMappingsContext, filterClientsByContext } from "@/lib/clients/filter"
import {
  COPILOT_TOOLS,
  type CopilotAction,
  type CopilotParseResult,
} from "@/lib/copilot/tools"
import type { CopilotPageContext } from "@/lib/copilot/context"

// Tool-use parsing is fast on Sonnet — ~2-5s round-trips. The 30s ceiling
// is well above expected, and matches Vercel's per-route default safety net.
export const maxDuration = 30

const anthropic = new Anthropic()

type ParseRequestBody = {
  input: string
  context: CopilotPageContext
}

type UserRow = { id: string; name: string | null; email: string; role: string | null }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id || !session.user.role) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: ParseRequestBody
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
    return NextResponse.json({ error: usersResult.error.message }, { status: 500 })
  }
  const users: UserRow[] = (usersResult.data ?? []) as UserRow[]

  const boards = clientsCache ?? (await fetchBothBoards())
  const mappingsContext = await loadUserMappingsContext(session.user.id, session.user.role)
  const visibleClients = [
    ...filterClientsByContext(boards.onboarding, mappingsContext),
    ...filterClientsByContext(boards.current, mappingsContext),
  ]

  const today = new Date().toISOString().slice(0, 10)

  const systemPrompt = buildSystemPrompt({
    today,
    sessionUser: { id: session.user.id, name: session.user.name ?? session.user.email ?? "Me" },
    users,
    clients: visibleClients,
    pageContext: body.context,
  })

  try {
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
      // Model chose not to call a tool — typically means it needs clarification
      // or the input wasn't actionable. Return its text as a clarify message.
      const text = message.content.find((c) => c.type === "text")
      const msg =
        text?.type === "text"
          ? text.text.trim()
          : "Ik begrijp niet helemaal wat je wilt. Kun je het iets specifieker formuleren?"
      const result: CopilotParseResult = { ok: false, reason: "clarify", message: msg }
      return NextResponse.json(result)
    }

    const action = normalizeAction(toolUse.name, toolUse.input as Record<string, unknown>)
    if (!action) {
      const result: CopilotParseResult = {
        ok: false,
        reason: "error",
        message: `Unknown tool '${toolUse.name}'.`,
      }
      return NextResponse.json(result)
    }

    const summary = describeAction(action, users, visibleClients)
    const result: CopilotParseResult = { ok: true, action, summary }
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Parse failed"
    console.error("Copilot parse error:", msg)
    return NextResponse.json(
      { ok: false, reason: "error", message: msg } satisfies CopilotParseResult,
      { status: 500 },
    )
  }
}

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

  return `You are the Rocket Leads Hub co-pilot. You parse natural-language commands (Dutch or English) into structured tool calls. Always call exactly one tool — never reply with prose unless the input is genuinely ambiguous or unsupported, in which case return a short clarifying question as plain text.

Today is ${args.today}. The signed-in user is ${args.sessionUser.name} (id=${args.sessionUser.id}).

${pageHint}

When resolving relative dates: "today"/"vandaag" → ${args.today}; "tomorrow"/"morgen" → ${addDays(args.today, 1)}; weekday names → the next occurrence of that weekday (or today if it matches). Always return YYYY-MM-DD.

When resolving people names: pick the best match from the roster below. "Mike", "Miek", "Maik" likely all map to whoever in the roster has "Mike" or similar. If multiple people share a first name, prefer the one who fits the role implied by the task (e.g. campaign manager for creative work).

When resolving client names: pick the best fuzzy match from the client roster. "Vlex" → "Vlex Vending". "RL" / "Rocket Leads" → the Rocket Leads client. If the user says "this client" or "deze klant" and a current client is in page context, use that id.

USER ROSTER:
${userRoster}

CLIENT ROSTER (${args.clients.length} clients):
${clientRoster}

Always return tool args with the literal id strings from these rosters — never invent ids.`
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
