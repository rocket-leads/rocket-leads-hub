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

export type CopilotAction =
  | CreateTaskAction
  | CreateReminderAction
  | TriggerPedroRefreshAction
  | NavigateToClientAction

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
