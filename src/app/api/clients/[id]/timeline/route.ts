import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { fetchItemUpdates } from "@/lib/integrations/monday"
import { fetchConversations, type TrengoConversation } from "@/lib/integrations/trengo"
import { cachedFetch } from "@/lib/cache"

/**
 * Per-client timeline (Phase C.8). Returns inbox events + meetings for this
 * client, merged into one chronological list. Newest first, capped at 200.
 *
 * Each entry has a uniform shape so the renderer can be a single component:
 *   { id, kind, source, title, body, occurred_at, link_url, meta }
 *
 * 2026-05: extended with live Monday item-updates + Trengo conversations as
 * a fallback so clients with sparse `inbox_events` (webhook gaps, recently
 * onboarded, etc.) still get a populated timeline. Dedup'd by source_msg_id
 * against inbox_events where the id is available; Monday updates have no
 * stable id from the GraphQL response so we de-dup by (source, occurred_at,
 * title-prefix) — good enough to avoid the common case of double-rendering
 * the exact same update once it lands in inbox_events later.
 */

export type TimelineEntry = {
  id: string
  /** What category of activity — drives the icon and label. */
  kind: "update" | "task" | "chat" | "meeting"
  /** Origin platform / system. */
  source: "monday" | "trengo" | "slack" | "meeting" | "manual" | "watchlist" | "automation"
  scope?: "internal" | "external" | null
  title: string
  /** Optional preview / body text. Already truncated server-side. */
  body: string | null
  /** Author-side label, e.g. "Roy" or "Klant via Trengo". */
  author: string | null
  /** ISO timestamp used for sorting. */
  occurred_at: string
  /** Optional outbound link (e.g. Fathom share URL, Monday item URL). */
  link_url: string | null
  meta: Record<string, unknown> | null
}

const MAX_ENTRIES = 200
const BODY_PREVIEW_LEN = 280
const LIVE_FETCH_CACHE_MS = 5 * 60 * 1000

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: "Missing client id" }, { status: 400 })

  const supabase = await createAdminClient()

  // Resolve the secondary IDs (Trengo contact, client board) we need for the
  // live-fetch fallbacks. One round-trip, joined to the Supabase clients row
  // we already key by `id` (== mondayItemId on the URL).
  const { data: clientRow } = await supabase
    .from("clients")
    .select("trengo_contact_id, monday_client_board_id")
    .eq("monday_item_id", id)
    .maybeSingle()
  const trengoContactId = clientRow?.trengo_contact_id ?? null

  const [eventsRes, meetingsRes, mondayUpdates, trengoConversations] = await Promise.all([
    supabase
      .from("inbox_events")
      .select(
        "id, kind, source, scope, title, body, status, author_kind, author_name_cached, source_thread, source_msg_id, created_at_src, created_at",
      )
      .eq("client_id", id)
      .order("created_at_src", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(MAX_ENTRIES),
    supabase
      .from("meetings")
      .select(
        "id, fathom_recording_id, title, scheduled_at, share_url, recorded_by_name, meeting_type, link_status, summary, action_items",
      )
      .eq("client_id", id)
      .order("scheduled_at", { ascending: false, nullsFirst: false })
      .limit(50),
    // Live Monday item updates (board-level commentary on the client's own
    // Monday item, not the lead board). Cached 5 min so opening the tab
    // repeatedly doesn't hammer the Monday API.
    cachedFetch(
      `timeline_monday_item_updates:${id}`,
      // 365-day cutoff so the timeline goes back further than the 14d
      // default — the timeline view is meant to show long-term history.
      () => fetchItemUpdates(id, 365),
      LIVE_FETCH_CACHE_MS,
    ).catch((e) => {
      console.error(`[timeline] Monday item updates failed for ${id}:`, e instanceof Error ? e.message : e)
      return [] as Awaited<ReturnType<typeof fetchItemUpdates>>
    }),
    // Live Trengo conversations — skipped when the client has no Trengo
    // contact id linked.
    trengoContactId
      ? cachedFetch(
          `timeline_trengo_conversations:${trengoContactId}`,
          () => fetchConversations(trengoContactId),
          LIVE_FETCH_CACHE_MS,
        ).catch((e) => {
          console.error(`[timeline] Trengo conversations failed for ${trengoContactId}:`, e instanceof Error ? e.message : e)
          return [] as TrengoConversation[]
        })
      : Promise.resolve<TrengoConversation[]>([]),
  ])

  if (eventsRes.error) {
    return NextResponse.json({ error: eventsRes.error.message }, { status: 500 })
  }
  if (meetingsRes.error) {
    return NextResponse.json({ error: meetingsRes.error.message }, { status: 500 })
  }

  const eventEntries: TimelineEntry[] = (eventsRes.data ?? []).map((e) => ({
    id: `event:${e.id}`,
    kind: (e.kind ?? "chat") as TimelineEntry["kind"],
    source: (e.source ?? "manual") as TimelineEntry["source"],
    scope: (e.scope ?? null) as TimelineEntry["scope"],
    title: e.title ?? "(no title)",
    body: e.body ? truncate(e.body, BODY_PREVIEW_LEN) : null,
    author: e.author_name_cached ?? null,
    occurred_at: e.created_at_src ?? e.created_at,
    link_url: null,
    meta: {
      status: e.status,
      author_kind: e.author_kind,
      source_thread: e.source_thread,
      source_msg_id: e.source_msg_id,
    },
  }))

  const meetingEntries: TimelineEntry[] = (meetingsRes.data ?? []).map((m) => ({
    id: `meeting:${m.id}`,
    kind: "meeting",
    source: "meeting",
    scope: null,
    title: m.title ?? "Untitled meeting",
    body: m.summary ? truncate(m.summary, BODY_PREVIEW_LEN) : null,
    author: m.recorded_by_name ?? null,
    occurred_at: m.scheduled_at ?? new Date(0).toISOString(),
    link_url: m.share_url ?? null,
    meta: {
      meeting_type: m.meeting_type,
      link_status: m.link_status,
      action_items_count: Array.isArray(m.action_items) ? m.action_items.length : 0,
      fathom_recording_id: m.fathom_recording_id,
    },
  }))

  // Live Monday updates → TimelineEntry. fetchClientItemUpdates doesn't return
  // a stable id, so the entry id uses the createdAt + a hash slice of the
  // text — stable enough that React-key collisions don't fire on re-fetch.
  const mondayUpdateEntries: TimelineEntry[] = mondayUpdates.map((u, idx) => {
    const previewSrc = u.text.trim()
    const oneLine = previewSrc.split("\n")[0] ?? ""
    const title = oneLine.length > 90 ? oneLine.slice(0, 90).trimEnd() + "…" : oneLine || "Monday update"
    return {
      id: `monday-live:${u.createdAt}:${idx}`,
      kind: "update",
      source: "monday",
      scope: "internal",
      title,
      body: previewSrc.length > BODY_PREVIEW_LEN ? truncate(previewSrc, BODY_PREVIEW_LEN) : previewSrc,
      author: u.creatorName || null,
      occurred_at: u.createdAt,
      link_url: null,
      meta: { live: true, kind: "monday_item_update" },
    }
  })

  // Live Trengo conversations → TimelineEntry. One entry per conversation
  // (not per message), so the timeline doesn't drown in individual replies.
  // Latest-message timestamp wins for ordering when available.
  const trengoEntries: TimelineEntry[] = trengoConversations.map((c) => {
    const latest = c.latest_message
    const occurred_at = latest?.created_at ?? c.created_at
    const subject = c.subject?.trim() || "Trengo conversation"
    const preview = latest?.message ? stripHtml(latest.message).trim() : null
    const channelName = c.channel?.name ?? c.channel?.type ?? null
    return {
      id: `trengo-live:${c.id}`,
      kind: "chat",
      source: "trengo",
      scope: "external",
      title: subject,
      body: preview ? truncate(preview, BODY_PREVIEW_LEN) : null,
      author: channelName ? `via ${channelName}` : null,
      occurred_at,
      link_url: null,
      meta: { live: true, conversation_id: c.id, channel_id: c.channel?.id ?? null },
    }
  })

  // Dedup: drop any live entry whose source_msg_id already exists in the
  // inbox_events entries (so once a Trengo conversation lands in
  // inbox_events via webhook, the live copy disappears automatically).
  const eventMsgIds = new Set<string>()
  for (const e of eventEntries) {
    const msgId = e.meta?.source_msg_id
    if (typeof msgId === "string" && msgId) eventMsgIds.add(`${e.source}:${msgId}`)
  }
  const dedupedTrengo = trengoEntries.filter((t) => !eventMsgIds.has(`trengo:${t.meta?.conversation_id}`))
  // Monday updates: no source_msg_id from fetchClientItemUpdates, so de-dup
  // by (source=monday, kind=update, occurred_at exact match, title-prefix).
  // Conservative — only drops the live copy when an inbox_event clearly
  // looks like the same message.
  const eventMondayKeys = new Set<string>()
  for (const e of eventEntries) {
    if (e.source === "monday" && e.kind === "update") {
      eventMondayKeys.add(`${e.occurred_at}|${(e.title ?? "").slice(0, 60)}`)
    }
  }
  const dedupedMonday = mondayUpdateEntries.filter(
    (m) => !eventMondayKeys.has(`${m.occurred_at}|${(m.title ?? "").slice(0, 60)}`),
  )

  // Merge + sort by occurred_at desc, cap to MAX_ENTRIES so a noisy client
  // doesn't flood the page.
  const merged = [...eventEntries, ...meetingEntries, ...dedupedMonday, ...dedupedTrengo]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .slice(0, MAX_ENTRIES)

  return NextResponse.json({ entries: merged })
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n).trimEnd() + "…"
}

/** Cheap HTML strip for Trengo email message previews. Doesn't try to render —
 *  just collapses tags so we don't show raw `<p>` markup in the timeline body. */
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}
