import { postItemUpdate } from "@/lib/integrations/monday"
import type { InboxItem, InboxComment, InboxKind } from "@/types/inbox"

/**
 * Mirror helpers forward `actorUserId` through to `postItemUpdate` so that
 * — when that user has connected their personal Monday API token in Account
 * → Connected accounts — Monday shows them as the poster instead of the
 * service-token owner (currently Roy). When the actor hasn't connected,
 * we fall back to the shared service token so automation paths still log.
 *
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
  /** Hub user id of the actor — looked up against user_platform_tokens
   *  to post as them when their personal Monday token is connected. */
  actorUserId?: string
}): Promise<string | null> {
  const tag = item.kind === "task" ? "TASK" : "UPDATE"
  const lines = [
    `[Hub: ${tag}] ${item.title}`,
    item.body?.trim() ? `\n${item.body.trim()}` : "",
    `\n— From ${item.authorName} to ${item.assigneeName}`,
  ].filter(Boolean)
  return postItemUpdate(item.clientId, lines.join("\n"), {
    actorUserId: item.actorUserId,
  })
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
  actorUserId?: string
}): Promise<string | null> {
  const trimmed = args.body.trim()
  if (args.parentMondayUpdateId) {
    return postItemUpdate(args.clientId, `${args.authorName}: ${trimmed}`, {
      parentUpdateId: args.parentMondayUpdateId,
      actorUserId: args.actorUserId,
    })
  }
  // Fallback when the original mirror failed — still log to the item timeline.
  return postItemUpdate(
    args.clientId,
    `[Hub: COMMENT on "${args.parentTitle}"]\n${trimmed}\n\n— ${args.authorName}`,
    { actorUserId: args.actorUserId },
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
  actorUserId?: string
}): Promise<void> {
  if (item.kind !== "task") return
  if (!["done", "cancelled"].includes(item.newStatus)) return

  const verb = item.newStatus === "done" ? "completed" : "cancelled"
  const body = `${item.actorName} ${verb} task: "${item.parentTitle}"`

  if (item.parentMondayUpdateId) {
    await postItemUpdate(item.clientId, body, {
      parentUpdateId: item.parentMondayUpdateId,
      actorUserId: item.actorUserId,
    })
  } else {
    await postItemUpdate(
      item.clientId,
      `[Hub: TASK ${item.newStatus.toUpperCase()}] ${body}`,
      { actorUserId: item.actorUserId },
    )
  }
}

export type InboxItemForMirror = Pick<
  InboxItem,
  "kind" | "clientId" | "title" | "body" | "authorName" | "assigneeName"
>
export type InboxCommentForMirror = Pick<InboxComment, "body" | "authorName">
