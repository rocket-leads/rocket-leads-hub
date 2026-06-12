import type { CopilotAction } from "./tools"

/**
 * Client-side executors. Each takes the (possibly edited) action from the
 * confirmation card and dispatches it against an existing Hub endpoint /
 * the Next.js router. Returns a result object the UI uses to show toasts
 * and follow-up navigation.
 */

export type ExecuteResult =
  | { ok: true; message: string; navigateTo?: string }
  | { ok: false; message: string }

export async function executeAction(
  action: CopilotAction,
  router: { push: (href: string) => void },
): Promise<ExecuteResult> {
  switch (action.type) {
    case "create_task":
      return executeCreateTask(action)
    case "create_reminder":
      return executeCreateReminder(action)
    case "trigger_pedro_refresh":
      return executeTriggerPedroRefresh(action)
    case "navigate_to_client":
      return executeNavigate(action, router)
  }
}

async function executeCreateTask(action: Extract<CopilotAction, { type: "create_task" }>): Promise<ExecuteResult> {
  if (!action.clientId) {
    return { ok: false, message: "Pick a client before creating the task." }
  }

  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "task",
      clientId: action.clientId,
      assigneeId: action.assigneeId,
      title: action.title,
      body: action.body,
      priority: action.priority ?? "normal",
      dueDate: action.dueDate,
      source: "manual",
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create task" }))
    return { ok: false, message: err.error ?? "Failed to create task" }
  }

  return { ok: true, message: "Task created", navigateTo: "/inbox" }
}

async function executeCreateReminder(
  action: Extract<CopilotAction, { type: "create_reminder" }>,
): Promise<ExecuteResult> {
  if (!action.clientId) {
    return { ok: false, message: "Pick a client before scheduling the reminder." }
  }

  const res = await fetch("/api/inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: action.kind,
      clientId: action.clientId,
      assigneeId: action.assigneeId,
      title: action.title,
      body: action.body,
      priority: action.kind === "task" ? "normal" : undefined,
      // due_date and snoozed_until both point at the reminder day for tasks
      // so the row sorts correctly in the Tasks list once it surfaces.
      dueDate: action.kind === "task" ? action.remindAt : undefined,
      snoozedUntil: action.remindAt,
      source: "manual",
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to schedule reminder" }))
    return { ok: false, message: err.error ?? "Failed to schedule reminder" }
  }

  return { ok: true, message: "Reminder scheduled", navigateTo: "/inbox" }
}

async function executeTriggerPedroRefresh(
  action: Extract<CopilotAction, { type: "trigger_pedro_refresh" }>,
): Promise<ExecuteResult> {
  const res = await fetch("/api/pedro/creative-refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: action.clientId, days: action.days ?? 30 }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Pedro refresh failed" }))
    return { ok: false, message: err.error ?? "Pedro refresh failed" }
  }

  return {
    ok: true,
    message: "Pedro refresh complete",
    navigateTo: `/clients/${encodeURIComponent(action.clientId)}?tab=campaigns`,
  }
}

function executeNavigate(
  action: Extract<CopilotAction, { type: "navigate_to_client" }>,
  router: { push: (href: string) => void },
): ExecuteResult {
  const url = `/clients/${encodeURIComponent(action.clientId)}${action.tab ? `?tab=${action.tab}` : ""}`
  router.push(url)
  return { ok: true, message: "Opening client…" }
}
