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

    const action = normalizeAction(
      toolUse.name,
      toolUse.input as Record<string, unknown>,
      { sessionUserId: userId },
    )
    if (!action) {
      await markFailed(supabase, draftId, `Unknown tool '${toolUse.name}'.`)
      return
    }

    // Enrichment pass - runs for both create_task and create_reminder when
    // a client is set. Roy 2026-06-12: reminders MUST capture today's
    // client snapshot in the body so future-you opening the surfaced task
    // has immediate context (CPL trend, invoice state, Pedro note) without
    // needing to re-pull anything.
    let sourcesUsed: string[] = []
    if (
      (action.type === "create_task" || action.type === "create_reminder") &&
      action.clientId
    ) {
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
          taskKind: action.type === "create_reminder" ? "reminder" : "task",
          remindAt:
            action.type === "create_reminder"
              ? action.remindAt
              : action.dueDate ?? null,
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
    .map((c) => {
      // Include companyName + firstName so the LLM can render the calendar
      // event title without needing a separate roster lookup. Falls back to
      // `name` when neither is set (matches how the panel renders it).
      const company = c.companyName?.trim()
      const first = c.firstName?.trim()
      const labelBits = [company || c.name]
      if (first) labelBits.push(`first=${first}`)
      return `- ${labelBits.join(" ")} id=${c.mondayItemId}`
    })
    .join("\n")

  const userFirstName = firstNameOf(args.sessionUser.name)

  const pageHint = args.pageContext.currentClientId
    ? `User is currently viewing client id=${args.pageContext.currentClientId}${
        args.pageContext.currentClientTab ? ` (tab: ${args.pageContext.currentClientTab})` : ""
      }. When the user says "this client", "here", "deze klant", they mean this one.`
    : `User is on page ${args.pageContext.pathname}. No specific client is selected.`

  return `You are the Rocket Leads Hub co-pilot. You parse natural-language commands (Dutch or English) into structured tool calls. Always call exactly one tool - never reply with prose unless the input is genuinely ambiguous or unsupported, in which case return a short clarifying question as plain text.

LANGUAGE MATCHING (important): Mirror the user's input language in every string field you fill (title, body, clarifying questions). If the user typed Dutch, write the title in Dutch. If the user typed English, write English. Never mix - "Check performance TMM Technology - kost per lead verlaagd?" is wrong; it should be either "Check TMM Technology performance - cost per lead dropped?" (all English) or "Check performance TMM Technology - kost per lead verlaagd?" → rewrite to "Performance TMM Technology checken - kost per lead verlaagd?" (all Dutch). For Dutch inputs, prefer Dutch verbs ("checken", "bellen", "chasen", "controleren") over English verbs.

Today is ${args.today}. The signed-in user is ${args.sessionUser.name} (id=${args.sessionUser.id}); their first name is "${userFirstName}". The Hub operates in Europe/Amsterdam time — CET (+01:00) in winter, CEST (+02:00) in summer. For dates from May through October, treat the timezone as +02:00; for November through March, +01:00; April + October are DST transition months — default to the offset the bulk of the month uses (+02:00 in April, +01:00 in October).

${pageHint}

TOOL SELECTION (the single most important rule: SELF vs OTHER):
- The signed-in user is ${args.sessionUser.name} (id=${args.sessionUser.id}). If the task / reminder belongs to THEM (phrasings like "remind me", "herinner me", "maak een taak voor mij", "voor mezelf", "task for me", "ik moet…", "stuur mezelf", "op X laat me weten", or an unattributed self-action like "bel Zumex dinsdag") → ALWAYS use create_reminder. The user is assigning themselves something. NEVER use create_task in this case, even if the phrasing literally contains "taak" or "task". EXCEPTION: inputs with the keyword "update" + a client name (e.g. "update zumex", "X update", "schrijf update voor X") are NEVER create_reminder OR create_task — they are always prepare_client_update, see below.
- Only when the task is for ANOTHER named person ("maak een taak voor Mike", "wijs aan Sanne toe", "create a task for Roy", "Lara moet X doen") → use create_task with that person's id from the roster.
- Pedro / new creatives / ad variants → trigger_pedro_refresh.
- "open / show / ga naar [client]" → navigate_to_client.
- ANY input where the keyword "update" appears next to a client name in the roster → prepare_client_update. This includes terse forms like "update zumex", "zumex update", "X update", "update voor X", and longer ones like "schrijf update voor [klant]", "stuur [klant] een update", "maak een update voor [klant]", "kort appje met update voor [klant]", "check-in [klant]", "wekelijkse update X" (still mid-week — the cron handles the Monday digest). CRITICAL: never reinterpret "update [client]" as create_task or create_reminder. The word "update" + a known client name is an unambiguous signal for this tool. Don't require a verb like "schrijf"/"maak"/"stuur" — the noun alone is enough. This is the AD-HOC MID-WEEK update — casual, AI-generated, varies in tone per send, covers multi-window performance trends + recent actions + last contact. Channel is automatic — don't pass any channel-related fields.
- "nodig [naam] uit", "plan meeting met [naam]", "invite X for a meeting", "meeting met X dinsdag 10u", "schiet een meeting in voor dinsdag 10 uur" → create_calendar_event. The host is always the signed-in user. The invitee can be (a) an existing client in the roster → set clientId, OR (b) someone NOT in the roster → set attendeeName as a free-form label. If the user pastes an email in the command, set attendeeEmail too. The action stays valid even when the named person is unknown or no person is named at all — the user fills in the missing pieces in the editor. Title defaults: clientId set → "{Company or ClientFirstName} x ${userFirstName} Meeting"; attendeeName set → "{AttendeeName} x ${userFirstName} Meeting"; neither → "Meeting". Default duration 30 min and addMeetLink=true unless the user said otherwise.

When you pick create_reminder you must still classify the 'kind' parameter:

REMINDER KIND CLASSIFIER (create_reminder.kind):
- "task" when the reminder is an action the user must DO and tick off: chase invoice, call client, send creatives, check if X happened, follow up on Y.
- "update" only when it's purely informational with no action: "remind me campaign goes live tuesday", "deadline X is friday", "Pedro launch dinsdag".
- When in doubt, pick "task" - a tickable item is safer than a read-once update that gets forgotten.

When resolving relative dates: "today"/"vandaag" → ${args.today}; "tomorrow"/"morgen" → ${addDays(args.today, 1)}; "overmorgen" → ${addDays(args.today, 2)}; weekday names ("dinsdag", "tuesday") → the next occurrence of that weekday (or today if it matches); "volgende week dinsdag" / "next tuesday" → the Tuesday of the following ISO week; "aanstaande X" → same as bare weekday name; "over N dagen" / "in N days" → today + N. Always return YYYY-MM-DD.

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

/** Strip the user's display name down to their first name for things
 *  like calendar-event titles. Falls back to the whole string when the
 *  name is a single token (e.g. just "Roy" or an email). */
function firstNameOf(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return ""
  // For email-shaped names, take the part before the @ and only its first piece.
  const beforeAt = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed
  return beforeAt.split(/[\s.]+/)[0] ?? trimmed
}

function normalizeAction(
  name: string,
  input: Record<string, unknown>,
  ctx: { sessionUserId: string },
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
    case "create_reminder":
      if (
        typeof input.title !== "string" ||
        typeof input.remindAt !== "string" ||
        (input.kind !== "task" && input.kind !== "update")
      ) {
        return null
      }
      // assigneeId is filled server-side - the LLM never picks it for
      // reminders, which are always self-targeted by definition.
      return {
        type: "create_reminder",
        kind: input.kind,
        title: input.title,
        body: typeof input.body === "string" ? input.body : undefined,
        remindAt: input.remindAt,
        assigneeId: ctx.sessionUserId,
        clientId: typeof input.clientId === "string" ? input.clientId : undefined,
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
    case "create_calendar_event":
      if (typeof input.start !== "string") return null
      return {
        type: "create_calendar_event",
        clientId: typeof input.clientId === "string" ? input.clientId : undefined,
        attendeeName: typeof input.attendeeName === "string" ? input.attendeeName : undefined,
        attendeeEmail: typeof input.attendeeEmail === "string" ? input.attendeeEmail : undefined,
        start: input.start,
        durationMin: typeof input.durationMin === "number" ? input.durationMin : undefined,
        title: typeof input.title === "string" ? input.title : undefined,
        addMeetLink: typeof input.addMeetLink === "boolean" ? input.addMeetLink : undefined,
      }
    case "prepare_client_update":
      if (typeof input.clientId !== "string") return null
      return {
        type: "prepare_client_update",
        clientId: input.clientId,
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
    case "create_reminder": {
      const label = action.kind === "task" ? "Reminder (task)" : "Reminder (update)"
      const parts = [`${label}: "${action.title}"`, `Remind: ${action.remindAt}`]
      if (action.clientId) parts.push(`Client: ${clientName(action.clientId)}`)
      return parts.join(" · ")
    }
    case "trigger_pedro_refresh":
      return `Run Pedro creative refresh for ${clientName(action.clientId)}${action.days ? ` (${action.days}d lookback)` : ""}`
    case "navigate_to_client":
      return `Open ${clientName(action.clientId)}${action.tab ? ` → ${action.tab}` : ""}`
    case "prepare_client_update":
      return `Queue weekly update for ${clientName(action.clientId)} (review + send from queue)`
    case "create_calendar_event": {
      const parts = [`Calendar invite: "${action.title ?? "Meeting"}"`]
      if (action.clientId) {
        parts.push(`Client: ${clientName(action.clientId)}`)
      } else if (action.attendeeName) {
        parts.push(`Attendee: ${action.attendeeName}`)
      }
      if (action.attendeeEmail) parts.push(`Email: ${action.attendeeEmail}`)
      parts.push(`Start: ${action.start}`, `Duration: ${action.durationMin ?? 30} min`)
      if (action.addMeetLink === false) parts.push("No Meet link")
      return parts.join(" · ")
    }
  }
}
