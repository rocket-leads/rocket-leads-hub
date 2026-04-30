import { postItemUpdate } from "@/lib/integrations/monday"
import type { InboxItem, InboxComment, InboxKind } from "@/types/inbox"

/**
 * Mirror an inbox item to Monday as an update on the client item.
 *
 * Format:
 *   [Hub: TASK] Title
 *   Body...
 *
 *   — From {{author}} to {{assignee}}
 *
 * Failures don't propagate — the Supabase row is the source of truth and
 * Monday is a best-effort log.
 */
export async function mirrorItemToMonday(item: {
  kind: InboxKind
  clientId: string
  title: string
  body: string | null
  authorName: string
  assigneeName: string
}): Promise<string | null> {
  const tag = item.kind === "task" ? "TASK" : "UPDATE"
  const lines = [
    `[Hub: ${tag}] ${item.title}`,
    item.body?.trim() ? `\n${item.body.trim()}` : "",
    `\n— From ${item.authorName} to ${item.assigneeName}`,
  ].filter(Boolean)
  return postItemUpdate(item.clientId, lines.join("\n"))
}

/**
 * Mirror a comment as a reply under the parent item's Monday update (when
 * we have the parent's monday_update_id), falling back to a top-level
 * update on the item when we don't.
 */
export async function mirrorCommentToMonday(args: {
  clientId: string
  parentMondayUpdateId: string | null
  parentTitle: string
  authorName: string
  body: string
}): Promise<string | null> {
  const trimmed = args.body.trim()
  if (args.parentMondayUpdateId) {
    return postItemUpdate(
      args.clientId,
      `${args.authorName}: ${trimmed}`,
      args.parentMondayUpdateId,
    )
  }
  // Fallback when the original mirror failed — still log to the item timeline.
  return postItemUpdate(
    args.clientId,
    `[Hub: COMMENT on "${args.parentTitle}"]\n${trimmed}\n\n— ${args.authorName}`,
  )
}

/**
 * Mirror a status change on a task (done / cancelled). Updates only — the
 * "read" transition on plain updates isn't mirrored to keep Monday's timeline
 * clean (it's meaningless to anyone outside the Hub).
 */
export async function mirrorStatusChangeToMonday(item: {
  kind: InboxKind
  clientId: string
  parentMondayUpdateId: string | null
  parentTitle: string
  newStatus: string
  actorName: string
}): Promise<void> {
  if (item.kind !== "task") return
  if (!["done", "cancelled"].includes(item.newStatus)) return

  const verb = item.newStatus === "done" ? "completed" : "cancelled"
  const body = `${item.actorName} ${verb} task: "${item.parentTitle}"`

  if (item.parentMondayUpdateId) {
    await postItemUpdate(item.clientId, body, item.parentMondayUpdateId)
  } else {
    await postItemUpdate(item.clientId, `[Hub: TASK ${item.newStatus.toUpperCase()}] ${body}`)
  }
}

export type InboxItemForMirror = Pick<
  InboxItem,
  "kind" | "clientId" | "title" | "body" | "authorName" | "assigneeName"
>
export type InboxCommentForMirror = Pick<InboxComment, "body" | "authorName">
