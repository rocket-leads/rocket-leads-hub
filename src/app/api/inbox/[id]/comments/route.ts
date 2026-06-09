import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { getInboxItem, listInboxComments } from "@/lib/inbox/fetchers"
import { sendPushToUser } from "@/lib/notifications/push"
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const comments = await listInboxComments(id)
  return NextResponse.json({ comments })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const item = await getInboxItem(id, session.user.id, session.user.role)
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (item.kind !== "task") {
    return NextResponse.json({ error: "Comments are only available on tasks" }, { status: 400 })
  }

  let parsed: { body?: string }
  try {
    parsed = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const text = parsed.body?.trim()
  if (!text) return NextResponse.json({ error: "Comment body required" }, { status: 400 })

  const supabase = await createAdminClient()
  const { data, error } = await supabase
    .from("inbox_comments")
    .insert({
      item_id: id,
      author_id: session.user.id,
      body: text,
    })
    .select("id")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Failed to add comment" }, { status: 500 })
  }

  // @-mentions inside comments: when an AM types "@Danny check this out",
  // Danny needs to know about it. Match `@FirstName` patterns against the
  // users.name column, lookup user ids, and fan out:
  //   - One inbox_event (kind=update) per mentioned user — lands in their
  //     Updates tab with the parent task title + the comment text
  //   - A push notification (best-effort, fail silently)
  // Self-mentions are skipped (no point pinging yourself). The author is
  // also skipped just in case they @themselves accidentally.
  const mentionedUserIds = await resolveMentionedUserIds(
    supabase,
    text,
    session.user.id,
  )
  if (mentionedUserIds.length > 0) {
    const authorName = session.user.name ?? session.user.email ?? "Iemand"
    const parentTitle = item.title.length > 80 ? item.title.slice(0, 77) + "…" : item.title
    const notificationTitle = `${authorName} mentioned you in: ${parentTitle}`
    const bodyPreview = text.length > 240 ? text.slice(0, 237) + "…" : text

    for (const mentionedId of mentionedUserIds) {
      const { data: notif, error: notifErr } = await supabase
        .from("inbox_events")
        .insert({
          kind: "update",
          client_id: item.clientId,
          author_id: session.user.id,
          assignee_id: mentionedId,
          title: notificationTitle,
          body: bodyPreview,
          status: "unread",
          source: "manual",
          source_ref: {
            mention_in_item_id: id,
            mention_in_comment_id: data.id,
          },
          author_kind: "rl_team",
          classify_method: "manual",
        })
        .select("id")
        .single()
      if (notifErr) {
        console.error("Mention notification insert failed:", notifErr.message)
        continue
      }
      if (notif?.id) {
        sendPushToUser(mentionedId, {
          title: notificationTitle,
          body: bodyPreview,
          url: `/inbox`,
          tag: `mention-${notif.id}`,
        }).catch((e) => console.error("Mention push failed:", e))
      }
    }
  }

  return NextResponse.json({ id: data.id }, { status: 201 })
}

/**
 * Parse @-mentions out of a comment body. The picker inserts `@FirstName`
 * when the AM clicks a teammate; we round-trip back to user ids by matching
 * the captured name against the users table case-insensitively. First name
 * is the primary key (most common pattern) but we also fall back to a full
 * name match in case the picker inserted both parts.
 *
 * Skips the actor's own id so a self-mention doesn't ping themselves, and
 * dedupes when the same user is @'d twice in the same comment.
 */
async function resolveMentionedUserIds(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  body: string,
  actorUserId: string,
): Promise<string[]> {
  // Match @ followed by 1+ name-ish chars. Stops at whitespace, punctuation
  // (not . - or ' which appear in some names), or end-of-string.
  const matches = Array.from(body.matchAll(/@([A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+)?)/g))
  if (matches.length === 0) return []
  const names = Array.from(new Set(matches.map((m) => m[1].trim()))).filter(Boolean)
  if (names.length === 0) return []

  const { data: rows } = await supabase
    .from("users")
    .select("id, name")
    .not("name", "is", null)
  if (!rows) return []

  const ids = new Set<string>()
  for (const name of names) {
    const needle = name.toLowerCase()
    for (const row of rows) {
      const userName = (row.name as string | null)?.toLowerCase() ?? ""
      if (!userName) continue
      // Match on first name OR full name. First-name match is the common
      // case (the picker inserts "@Roy"); full-name match catches the
      // less common "@Roy Vosters" insertion.
      const firstName = userName.split(/\s+/)[0]
      if (firstName === needle || userName === needle) {
        if (row.id !== actorUserId) ids.add(row.id as string)
      }
    }
  }
  return Array.from(ids)
}
