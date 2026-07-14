import type Anthropic from "@anthropic-ai/sdk"

/**
 * Co-pilot tool schemas (Claude tool-use). Each tool maps to one concrete
 * Hub action the AI co-pilot can propose. The user always confirms before
 * execution - schemas are intentionally narrow so the LLM can't invent
 * shapes that the executor doesn't know how to run.
 *
 * IDs (clientId, assigneeId) are resolved server-side from the names the
 * LLM picks. The LLM sees a roster of (name, id) pairs and is instructed
 * to return the id literally.
 */

export type CreateTaskAction = {
  type: "create_task"
  title: string
  body?: string
  assigneeId: string
  clientId?: string
  dueDate?: string
  priority?: "low" | "normal" | "high"
}

/** Self-targeted scheduled reminder. Surfaces in the user's own inbox on
 *  `remindAt` (interpreted as 09:00 Europe/Amsterdam by the executor). The
 *  classifier picks `kind`: action-on-someone-else → "task" (can be ticked
 *  off), pure heads-up → "update" (read-once). assigneeId is filled
 *  server-side to the signed-in user and is not part of the LLM input. */
export type CreateReminderAction = {
  type: "create_reminder"
  kind: "task" | "update"
  title: string
  body?: string
  remindAt: string
  assigneeId: string
  clientId?: string
}

export type TriggerPedroRefreshAction = {
  type: "trigger_pedro_refresh"
  clientId: string
  days?: number
}

export type NavigateToClientAction = {
  type: "navigate_to_client"
  clientId: string
  tab?: "campaigns" | "billing" | "communication" | "settings"
}

/** Schedule a Google Calendar event with the signed-in user as host.
 *
 *  Attendee resolution (executor, in order):
 *    1. `attendeeEmail` if the parser captured one (free-form input wins).
 *    2. `clientId` → fetch `MondayClient.email` via /api/clients/[id].
 *    3. Neither → create the event without an invitee; editor surfaces a hint.
 *
 *  `attendeeName` is a free-form label used for the title default when no
 *  client roster match exists (e.g. "Meeting met Pieter dinsdag 10 uur"
 *  → attendeeName="Pieter", no clientId). The editor lets the user fill
 *  in a missing email before approving.
 *
 *  `start` is ISO-with-offset (Europe/Amsterdam unless the user said otherwise).
 *  `durationMin` defaults to 30. `addMeetLink` defaults to true. `title` is
 *  pre-filled by the parser as one of:
 *    - `{ClientCompany or ClientFirstName} x {UserFirstName} Meeting`
 *    - `{AttendeeName} x {UserFirstName} Meeting`
 *    - `Meeting` (when neither is known). */
export type CreateCalendarEventAction = {
  type: "create_calendar_event"
  /** Optional — present when the LLM matched a client in the roster. */
  clientId?: string
  /** Free-form display name for the invitee. Used for the title default
   *  when no roster match is found. */
  attendeeName?: string
  /** Optional email override. When set, the executor uses this verbatim
   *  instead of looking up the client's stored email. */
  attendeeEmail?: string
  /** ISO datetime with timezone offset (e.g. 2026-06-16T10:00:00+02:00). */
  start: string
  /** Defaults to 30 in the executor when omitted. */
  durationMin?: number
  /** Pre-filled by the parser; editable in ConfirmDialog. */
  title?: string
  /** Defaults to true. */
  addMeetLink?: boolean
}

export type CopilotAction =
  | CreateTaskAction
  | CreateReminderAction
  | TriggerPedroRefreshAction
  | NavigateToClientAction
  | CreateCalendarEventAction

export const COPILOT_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_task",
    description:
      "Create a task in the Hub inbox, assigned to a team member. Use when the user says something like 'create a task for [person]', 'maak een taak voor [persoon]', 'remind [person] to do X'. The task can optionally be tied to a client.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short, action-oriented task title (e.g. 'Nieuwe creatives maken op winning angle').",
        },
        body: {
          type: "string",
          description:
            "Optional longer description with context (the why, relevant numbers, ad names). Leave empty when the title is self-explanatory - the executor will auto-enrich with KPI/Pedro context if a clientId is set.",
        },
        assigneeId: {
          type: "string",
          description:
            "UUID of the user this task is assigned to. Pick from the provided user roster. If the user mentions a name that's ambiguous, pick the most likely match.",
        },
        clientId: {
          type: "string",
          description:
            "Monday item ID of the client this task relates to. Pick from the provided client roster. Required when a client is mentioned or implied by page context.",
        },
        dueDate: {
          type: "string",
          description:
            "Due date in YYYY-MM-DD format. Resolve relative phrases like 'today', 'tomorrow', 'vrijdag', 'next monday' against the current date provided in the system prompt.",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          description: "Task priority. Default to 'normal' if not stated.",
        },
      },
      required: ["title", "assigneeId"],
    },
  },
  {
    name: "create_reminder",
    description:
      "Schedule a reminder for the SIGNED-IN USER themselves, hidden until the target date. Use when the user says 'remind me', 'herinner me', 'reminder voor mezelf', 'op X juni laat me weten...', etc. Pick `kind`: \"task\" if the reminder is an action you need to take and tick off (chase the invoice, call the client, send creatives); \"update\" if it's pure information you want to be reminded of (campaign goes live tuesday, deadline X). When in doubt, prefer \"task\" - a tickable item is safer than an info-blip that gets read and forgotten. Do NOT use this for delegating to someone else - use create_task for that.",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["task", "update"],
          description:
            "\"task\" = something the user has to DO on/before that date (chase, check, send, call). \"update\" = a heads-up the user wants to be reminded of (event, deadline, milestone). Default to \"task\" when ambiguous.",
        },
        title: {
          type: "string",
          description: "Short reminder title in the user's voice (e.g. 'Check of factuur Vlex Vending is betaald').",
        },
        body: {
          type: "string",
          description: "Optional longer context for the reminder. Usually empty - the title is enough.",
        },
        remindAt: {
          type: "string",
          description:
            "Reminder date in YYYY-MM-DD. Resolve relative phrases like 'morgen', 'volgende week dinsdag', 'aanstaande vrijdag', 'over 3 dagen', 'dinsdag 24 juni' against the current date in the system prompt.",
        },
        clientId: {
          type: "string",
          description:
            "Monday item ID of the client this reminder relates to. Pick from the provided client roster when the user mentions a client. Required when a client is named or implied by page context.",
        },
      },
      required: ["kind", "title", "remindAt"],
    },
  },
  {
    name: "trigger_pedro_refresh",
    description:
      "Kick off a Pedro AI creative refresh for a client. Pedro analyses recent Meta ad performance and proposes 3-5 new variants on winning ads. Use when the user says 'genereer nieuwe creatives for [client]', 'pedro refresh', 'maak nieuwe ad variaties', etc.",
    input_schema: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "Monday item ID of the client. Pick from the provided client roster.",
        },
        days: {
          type: "number",
          description: "Lookback window in days for ad performance analysis. Default 30.",
        },
      },
      required: ["clientId"],
    },
  },
  {
    name: "navigate_to_client",
    description:
      "Navigate the user to a specific client's detail page. Use when the user says 'go to [client]', 'open [client]', 'show me [client]'s billing', etc.",
    input_schema: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description: "Monday item ID of the client. Pick from the provided client roster.",
        },
        tab: {
          type: "string",
          enum: ["campaigns", "billing", "communication", "settings"],
          description: "Which tab to open. Default 'campaigns' when not specified.",
        },
      },
      required: ["clientId"],
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Schedule a Google Calendar event with the signed-in user as host. The invitee can be a known client (roster match → clientId) OR an external person / lead not yet in the system (use attendeeName + optionally attendeeEmail). Use when the user says 'nodig X uit voor een meeting', 'plan een call met X', 'meeting X dinsdag 10 uur', 'invite X for a meeting', 'schiet een meeting in voor dinsdag 10 uur', etc. The executor adds a Google Meet link by default and the user reviews + fills any missing data in the editor before approving.",
    input_schema: {
      type: "object",
      properties: {
        clientId: {
          type: "string",
          description:
            "OPTIONAL. Monday item ID of an existing client when the user names someone who matches the roster (e.g. 'Vlex Vending', 'met Roy van TMM'). Omit when the user names someone who is NOT in the roster (external contact, new lead, generic person). Never invent — only set when there's a clear roster match.",
        },
        attendeeName: {
          type: "string",
          description:
            "Free-form invitee name when no roster match exists. Example: user says 'meeting met Pieter dinsdag 10 uur' → attendeeName='Pieter' (no clientId). When an email is given but no name, derive a name from the local-part (e.g. 'pieter@example.com' → 'Pieter'). Omit when clientId is set.",
        },
        attendeeEmail: {
          type: "string",
          description:
            "Email override. Set ONLY when the user explicitly types an email address in the command. Don't guess. When omitted with a clientId, the executor pulls the client's stored email. When omitted without a clientId, the editor will ask the user to fill it in before approving.",
        },
        start: {
          type: "string",
          description:
            "Start datetime in ISO 8601 with Europe/Amsterdam offset (CEST=+02:00, CET=+01:00). Resolve relative phrases like 'volgende week dinsdag om 10 uur', 'morgen 14:00', 'aanstaande dinsdag', 'next monday at 3pm' against the current date in the system prompt. Always pick the next future occurrence. Example: '2026-06-16T10:00:00+02:00'.",
        },
        durationMin: {
          type: "number",
          description: "Meeting length in minutes. Default 30 — only set explicitly when the user says e.g. '15 min', 'een uur', '45 minuten'.",
        },
        title: {
          type: "string",
          description:
            "Event title. Default format options, in priority order: (1) clientId set → '{ClientCompany or ClientFirstName} x {SignedInUserFirstName} Meeting' (e.g. 'Vlex Vending x Roy Meeting'); (2) attendeeName set → '{AttendeeName} x {SignedInUserFirstName} Meeting' (e.g. 'Pieter x Roy Meeting'); (3) neither → 'Meeting'. Override only when the user explicitly gives a title.",
        },
        addMeetLink: {
          type: "boolean",
          description: "Whether to attach a Google Meet link. Default true. Set false only when the user explicitly says 'no Meet', 'geen Meet', 'in person'.",
        },
      },
      required: ["start"],
    },
  },
]

export type CopilotParseSuccess = {
  ok: true
  action: CopilotAction
  /** Human-readable preview the UI shows in the confirmation card. */
  summary: string
  /** Source labels that contributed to the (enriched) task body - shown
   *  under the AI parsed line so the user can see what data the co-pilot
   *  actually consulted. Empty for non-enriched actions (Pedro, navigate). */
  sourcesUsed?: string[]
}

export type CopilotParseClarify = {
  ok: false
  reason: "clarify"
  message: string
}

export type CopilotParseError = {
  ok: false
  reason: "error"
  message: string
}

export type CopilotParseResult =
  | CopilotParseSuccess
  | CopilotParseClarify
  | CopilotParseError

/** Lifecycle of a draft as stored in copilot_drafts. */
export type CopilotDraftStatus = "pending" | "ready" | "approved" | "dismissed" | "failed"

/** Shape returned by /api/copilot/drafts (camelCased from the DB row). */
export type CopilotDraft = {
  id: string
  input: string
  status: CopilotDraftStatus
  /** Null while status='pending' or if processing failed before tool-use returned. */
  draftAction: CopilotAction | null
  /** Null while status='pending'. */
  summary: string | null
  sourcesUsed: string[]
  /** Populated when status='failed'. */
  error: string | null
  createdAt: string
  readyAt: string | null
  completedAt: string | null
}
