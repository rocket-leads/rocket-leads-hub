"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, Send, Calendar, AlertCircle, Loader2, Mail, MessageSquare, Hash, ListTodo, Inbox as InboxIcon, MessagesSquare, Link2Off, Link2, Check, ChevronDown, Sparkles, Pencil, X } from "lucide-react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DismissButton } from "@/components/ui/dismiss-button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { InboxComment, InboxItem, InboxKind, InboxSource, TaskStatus } from "@/types/inbox"
import type { CurrentUser, InboxUser } from "./inbox-view"
import { LinkTrengoContactDialog } from "./link-trengo-dialog"
import { SourcePill } from "./source-pill"
import { TimelineTab } from "@/app/(dashboard)/clients/[id]/_components/timeline-tab"

type Props = {
  itemId: string
  currentUser: CurrentUser
  users: InboxUser[]
  onClose: () => void
  onChanged: () => void
  /** Layout mode. `overlay` (default) is the original right-side slide-over
   *  with a backdrop — used on narrow viewports where the list can't fit
   *  alongside the detail. `docked` renders inline as a column inside a
   *  flex split, with no portal/backdrop, so the list stays interactive
   *  next to the open ticket. The body content is identical in both modes;
   *  only the outer shell differs. */
  mode?: "overlay" | "docked"
  /** When docked and butted up against the list on the left, drop the
   *  left radius + left border so the two cards read as one continuous
   *  panel (email-client style). Roy: same visual language across Tasks /
   *  Updates / Client Inbox / Now — no floating side-panels, one merged
   *  surface. */
  mergedLeftEdge?: boolean
}

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string; cls: string }> = [
  { value: "open", label: "Open", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  { value: "in_progress", label: "In progress", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { value: "done", label: "Done", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { value: "cancelled", label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
]

/**
 * Render a comment body with `@FirstName` patterns highlighted as inline
 * chips. Names that match a Hub user (case-insensitive first-name OR full-
 * name) get a violet tint; everything else (e.g. `@example.com` slipping
 * through, or names that don't match anyone) renders as plain text so we
 * never falsely promote a non-mention to a mention.
 *
 * Self-mentions get an extra `bg-primary/30` so the AM can immediately
 * spot when they're the one being tagged.
 */
function renderMentions(
  body: string,
  users: InboxUser[],
  currentUserId: string,
): React.ReactNode {
  // Defensive guard: a sufficiently long body or one with hundreds of
  // `@` patterns (e.g. a pasted email thread, log dump) would create
  // thousands of React nodes here and could contribute to a renderer
  // crash. Beyond ~10K chars, fall back to plain text.
  if (body.length > 10_000) return body
  // Same regex as the backend mention resolver — keep them in sync so
  // visual styling matches what the server actually fans out to.
  const re = /@([A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+)?)/g
  const out: React.ReactNode[] = []
  let lastIdx = 0
  let key = 0
  const MAX_MENTIONS = 200
  let mentionCount = 0
  for (const match of body.matchAll(re)) {
    if (++mentionCount > MAX_MENTIONS) {
      // Stop chip-rendering past the cap; emit the remainder as plain text.
      out.push(body.slice(lastIdx))
      lastIdx = body.length
      break
    }
    const idx = match.index ?? 0
    if (idx > lastIdx) out.push(body.slice(lastIdx, idx))
    const captured = match[1].trim()
    const needle = captured.toLowerCase()
    const matchedUser = users.find((u) => {
      const name = (u.name ?? "").toLowerCase()
      if (!name) return false
      const firstName = name.split(/\s+/)[0]
      return firstName === needle || name === needle
    })
    if (matchedUser) {
      const isMe = matchedUser.id === currentUserId
      out.push(
        <span
          key={`m-${key++}`}
          className={cn(
            "inline-flex items-center rounded-md px-1 py-0.5 font-medium text-[0.92em]",
            isMe
              ? "bg-violet-500/30 text-violet-700 dark:text-violet-200"
              : "bg-violet-500/15 text-violet-700 dark:text-violet-300",
          )}
          title={matchedUser.email}
        >
          @{captured}
        </span>,
      )
    } else {
      // No Hub-user match — leave as plain text so a stray `@example.com`
      // or unknown name doesn't get falsely styled like a real mention.
      out.push(`@${captured}`)
    }
    lastIdx = idx + match[0].length
  }
  if (lastIdx < body.length) out.push(body.slice(lastIdx))
  return out
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ItemDetailDialog({ itemId, currentUser, users, onClose, onChanged, mode = "overlay", mergedLeftEdge }: Props) {
  const queryClient = useQueryClient()
  const [commentBody, setCommentBody] = useState("")
  const [submittingComment, setSubmittingComment] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

  const detailQuery = useQuery<{ item: InboxItem; comments: InboxComment[] }>({
    queryKey: ["inbox-item", itemId],
    queryFn: () => fetch(`/api/inbox/${itemId}`).then((r) => r.json()),
  })

  const item = detailQuery.data?.item
  const comments = detailQuery.data?.comments ?? []

  async function setStatus(status: string) {
    if (!item) return
    setUpdatingStatus(true)
    try {
      await fetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
      onChanged()
    } finally {
      setUpdatingStatus(false)
    }
  }

  /**
   * Edit a meta field on the item (title / body / dueDate). Optimistic on
   * the detail-query cache so the new value sticks the moment the user
   * blurs out of the input — without that, an Enter-to-save flashes back to
   * the old text for half a second while the round-trip completes. We
   * also invalidate the list queries so the row in the inbox view picks
   * up the fresh title.
   */
  async function setMeta(patch: { title?: string; body?: string | null; dueDate?: string }) {
    if (!item) return
    const prev = detailQuery.data
    queryClient.setQueryData<{ item: InboxItem; comments: InboxComment[] }>(
      ["inbox-item", itemId],
      (data) => (data ? { ...data, item: { ...data.item, ...patch } } : data),
    )
    try {
      const res = await fetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`)
      queryClient.invalidateQueries({ queryKey: ["inbox"] })
      onChanged()
    } catch (err) {
      // Roll back the optimistic change on the detail query.
      if (prev) queryClient.setQueryData(["inbox-item", itemId], prev)
      console.error("setMeta failed, rolled back", err)
    }
  }

  // Reassign — open to anyone with visibility, since handing a task off is a
  // routine team operation. We optimistically refresh on success but don't
  // close the dialog: the user might want to keep working with the item.
  const [reassigning, setReassigning] = useState(false)
  async function reassign(userId: string) {
    if (!item || userId === item.assigneeId) return
    setReassigning(true)
    try {
      const res = await fetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: userId }),
      })
      if (!res.ok) return
      await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
      await queryClient.invalidateQueries({ queryKey: ["inbox"] })
      await queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
      onChanged()
    } finally {
      setReassigning(false)
    }
  }

  // Reclassify the item to a different kind. The server resets status +
  // priority for the new kind, so we close the dialog after — the item moves
  // to a different tab and the user picks it back up there if needed.
  const [reclassifying, setReclassifying] = useState(false)
  async function reclassify(kind: "task" | "update" | "chat") {
    if (!item || kind === item.kind) return
    setReclassifying(true)
    try {
      const res = await fetch(`/api/inbox/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      })
      if (!res.ok) return
      await queryClient.invalidateQueries({ queryKey: ["inbox"] })
      await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
      await queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
      onChanged()
      onClose()
    } finally {
      setReclassifying(false)
    }
  }

  async function addComment() {
    if (!commentBody.trim() || !item) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/inbox/${itemId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim() }),
      })
      if (res.ok) {
        setCommentBody("")
        await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
        onChanged()
      }
    } finally {
      setSubmittingComment(false)
    }
  }

  async function deleteItem() {
    if (!item) return
    if (!confirm(`Delete this ${item.kind}? This cannot be undone.`)) return
    const res = await fetch(`/api/inbox/${itemId}`, { method: "DELETE" })
    if (res.ok) {
      onChanged()
      onClose()
    }
  }

  // --- Platform reply (Trengo / Slack) -------------------------------------
  const [replyBody, setReplyBody] = useState("")
  const [replyPrefilledFromAi, setReplyPrefilledFromAi] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)
  const [needsConnect, setNeedsConnect] = useState<"trengo" | "slack" | "monday" | null>(null)

  async function sendPlatformReply() {
    if (!replyBody.trim() || !item) return
    setSendingReply(true)
    setReplyError(null)
    setNeedsConnect(null)
    try {
      const res = await fetch(`/api/inbox/${itemId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: replyBody.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        needsConnect?: "trengo" | "slack" | "monday"
        error?: string
      }
      if (!res.ok) {
        if (data.needsConnect) setNeedsConnect(data.needsConnect)
        else setReplyError(data.error ?? "Reply failed")
        return
      }
      setReplyBody("")
      await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
      await queryClient.invalidateQueries({ queryKey: ["inbox"] })
      onChanged()
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Reply failed")
    } finally {
      setSendingReply(false)
    }
  }

  const [linkOpen, setLinkOpen] = useState(false)

  const isUpdate = item?.kind === "update"
  const isTask = item?.kind === "task"
  const canDelete = !!item && (item.authorId === currentUser.id || currentUser.role === "admin")
  const canReplyToSource = !!item && (item.source === "trengo" || item.source === "slack")

  // --- Smart-inbox draft (AI-prefilled outbound message) ------------------
  // For tasks where the automation generated a ready-to-send draft (currently
  // payment_overdue_task), show an editable textarea + Send button so the
  // AM can review, tweak and ship without leaving the Hub.
  const draftMessage = (item?.sourceRef as Record<string, unknown> | null)?.draft_message
  const draftChannel = (item?.sourceRef as Record<string, unknown> | null)?.draft_channel
  // Trengo-source items already have a Reply panel that knows the source
  // ticket — for those we prefill that textarea instead of showing the
  // smart-draft panel separately. Avoids two competing send buttons.
  const draftIsForExistingReplyPanel = item?.source === "trengo"
  const hasDraft =
    isTask &&
    typeof draftMessage === "string" &&
    draftMessage.trim().length > 0 &&
    (item?.status === "open" || item?.status === "in_progress") &&
    !draftIsForExistingReplyPanel
  const [draftBody, setDraftBody] = useState<string>(
    typeof draftMessage === "string" ? draftMessage : "",
  )
  const [sendingDraft, setSendingDraft] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftNeedsConnect, setDraftNeedsConnect] = useState(false)

  // Re-sync the textarea when the dialog switches between items (e.g. after a
  // server refresh) so the prefilled message follows the active task.
  useEffect(() => {
    setDraftBody(typeof draftMessage === "string" ? draftMessage : "")
    setDraftError(null)
    setDraftNeedsConnect(false)
  }, [draftMessage, itemId])

  // Smart-inbox prefill for Trengo tasks: when the webhook ingest set a
  // draft_message, populate the existing reply textarea with it. The smart-
  // draft panel above is hidden for trengo source items (see hasDraft) so
  // there's no double UI; the AM reviews-and-sends through the normal
  // platform-reply path that targets the correct ticket.
  const replyDraftFromIngest =
    item?.source === "trengo" && typeof draftMessage === "string" && draftMessage.trim().length > 0
      ? draftMessage
      : null
  useEffect(() => {
    if (replyDraftFromIngest) {
      setReplyBody(replyDraftFromIngest)
      setReplyPrefilledFromAi(true)
    } else {
      setReplyBody("")
      setReplyPrefilledFromAi(false)
    }
    setReplyError(null)
    setNeedsConnect(null)
  }, [replyDraftFromIngest, itemId])

  async function sendDraft() {
    if (!draftBody.trim()) return
    setSendingDraft(true)
    setDraftError(null)
    setDraftNeedsConnect(false)
    try {
      const res = await fetch(`/api/inbox/${itemId}/send-trengo-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: draftBody.trim() }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) {
        if (res.status === 409 && data.error?.toLowerCase().includes("trengo")) {
          setDraftNeedsConnect(true)
        } else {
          setDraftError(data.error ?? "Send failed")
        }
        return
      }
      await queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
      await queryClient.invalidateQueries({ queryKey: ["inbox"] })
      onChanged()
      onClose()
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Send failed")
    } finally {
      setSendingDraft(false)
    }
  }

  // Inner content is identical in both modes — only the surrounding shell
  // (portal+backdrop vs inline column) differs. Defined once and passed to
  // the right wrapper below to keep edits painless.
  const body = (
    <>
      <DismissButton
        onClick={onClose}
        className="absolute top-3 right-3 z-10"
      />
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {detailQuery.isLoading || !item ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Prominent kind banner. Roy: "ik wil duidelijk onderscheid
                tussen updates en tasks." A coloured strip + chunky label
                so the user knows in 0.2s what kind of item they opened.
                Tasks get a violet accent (action), updates a muted blue
                (informational). The reclassify control sits directly
                next to it so a misclassification is one click away. */}
            <KindBanner
              kind={item.kind}
              source={item.source}
              disabled={reclassifying}
              onChange={reclassify}
            />
            <DialogHeader>
              <div className="flex items-start gap-2">
                {item.priority === "high" && (
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                )}
                {item.kind !== "chat" ? (
                  <EditableTitle
                    value={item.title}
                    onSave={(title) => setMeta({ title })}
                    className="flex-1"
                  />
                ) : (
                  <DialogTitle className="leading-snug flex-1">{item.title}</DialogTitle>
                )}
                <SourcePill
                  source={item.source}
                  channelKind={item.channelKind}
                  className="shrink-0 mt-1"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70 mt-1">
                {item.isUnlinked ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 font-medium">
                    <Link2Off className="h-3 w-3" />
                    Unlinked Trengo contact
                  </span>
                ) : item.clientId && item.clientName ? (
                  // Click-through to the client detail page. The page's
                  // Inbox tab shows every task / update / chat for this
                  // client in one view, so this is the fastest path from
                  // "I'm looking at this one task" to "show me everything
                  // about this client right now."
                  <Link
                    href={`/clients/${item.clientId}`}
                    className="font-medium hover:text-foreground hover:underline underline-offset-4 transition-colors"
                    title="Open client detail page"
                  >
                    {item.clientName}
                  </Link>
                ) : (
                  <span className="font-medium">{item.clientName}</span>
                )}
                <span>·</span>
                <span>{item.authorName}</span>
                <span>→</span>
                <AssigneePicker
                  currentAssigneeId={item.assigneeId}
                  currentAssigneeName={item.assigneeName}
                  users={users}
                  currentUserId={currentUser.id}
                  onChange={reassign}
                  disabled={reassigning}
                />
                <span>·</span>
                <span>{fmtDateTime(item.createdAt)}</span>
                {item.dueDate && (
                  <>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Due {item.dueDate}
                    </span>
                  </>
                )}
              </div>
            </DialogHeader>

            {item.isUnlinked && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400/90 leading-snug">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium mb-0.5">This Trengo contact isn&apos;t linked to a client yet.</p>
                    <p className="text-amber-600/80 dark:text-amber-400/70">
                      Pick a client and we&apos;ll attach{" "}
                      <span className="font-mono">{item.authorExternal ?? "this contact"}</span>{" "}
                      + re-route past unlinked messages to it.
                    </p>
                  </div>
                  {item.authorExternal && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setLinkOpen(true)}
                      className="shrink-0"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Link to client
                    </Button>
                  )}
                </div>
              </div>
            )}

            {linkOpen && item.authorExternal && (
              <LinkTrengoContactDialog
                trengoContactId={item.authorExternal}
                contactName={item.authorName}
                onClose={() => setLinkOpen(false)}
                onLinked={() => {
                  setLinkOpen(false)
                  queryClient.invalidateQueries({ queryKey: ["inbox"] })
                  queryClient.invalidateQueries({ queryKey: ["inbox-item", itemId] })
                  queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
                  onChanged()
                  onClose()
                }}
              />
            )}

            {item.kind !== "chat" ? (
              <EditableBody
                value={item.body ?? ""}
                onSave={(body) => setMeta({ body: body.trim() ? body : null })}
              />
            ) : (
              item.body && (
                <div className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed">
                  {item.body}
                </div>
              )
            )}

            {/* The reclassify control lives in the KindBanner at the top
                of the panel now — putting it twice is just clutter. Kept
                the component definition below in case we need it again. */}

            {/* Update controls */}
            {isUpdate && (
              <div className="flex items-center gap-2">
                {item.status === "unread" ? (
                  <Button
                    size="sm"
                    onClick={() => setStatus("read")}
                    disabled={updatingStatus}
                  >
                    Mark as read
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus("unread")}
                    disabled={updatingStatus}
                  >
                    Mark as unread
                  </Button>
                )}
              </div>
            )}

            {/* Task controls */}
            {isTask && (
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1.5">Status</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TASK_STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setStatus(opt.value)}
                        disabled={updatingStatus || item.status === opt.value}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                          item.status === opt.value
                            ? opt.cls
                            : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Comments — internal team chat per task. Roy: "dan
                    kunnen we daar ook chats hebben in de specifieke
                    tasks." Slack-style: avatars, alternating alignment
                    based on author, empty-state nudge, Enter-to-send
                    (Shift+Enter for newline), auto-scroll on new. */}
                <CommentThread
                  comments={comments}
                  currentUserId={currentUser.id}
                  users={users}
                  draft={commentBody}
                  onDraftChange={setCommentBody}
                  onSend={addComment}
                  sending={submittingComment}
                />
              </div>
            )}

            {/* Client timeline — collapsible section under tasks + updates so
                the AM/CM can see the recent Monday updates, Trengo/Slack chats,
                and meetings around this client without leaving the dialog. Roy
                2026-05-28: "een soort timeline van de klant inladen waar alle
                Monday-updates en clientcommunicaties staan. Dan heb je iets
                meer context." Only renders when the item is linked to a client
                — there's nothing meaningful to scope to on unlinked items. */}
            {(isTask || isUpdate) && item.clientId && (
              <ClientTimelineSection clientId={item.clientId} />
            )}

            {hasDraft && (
              <div className="border-t border-border/40 pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-2 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  AI draft — <ChannelMark channel={draftChannel} />
                  {channelLabel(draftChannel)}
                </p>
                {draftNeedsConnect && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
                    Connect your Trengo account first.{" "}
                    <Link href="/settings?tab=me" className="underline font-medium">
                      Go to My Account
                    </Link>
                  </div>
                )}
                {draftError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
                    {draftError}
                  </div>
                )}
                <textarea
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  rows={6}
                  disabled={sendingDraft}
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none mb-2"
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] text-muted-foreground/50">
                    Past aan en stuur direct vanuit de Hub. Verschijnt in Trengo als jou.
                  </p>
                  <Button
                    size="sm"
                    onClick={sendDraft}
                    disabled={!draftBody.trim() || sendingDraft}
                  >
                    {sendingDraft ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Verstuur
                  </Button>
                </div>
              </div>
            )}

            {canReplyToSource && (
              <div className="border-t border-border/40 pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-2 inline-flex items-center gap-1.5">
                  {item.source === "trengo" ? (
                    <MessageSquare className="h-3 w-3" />
                  ) : (
                    <Hash className="h-3 w-3" />
                  )}
                  Reply via {item.source === "trengo" ? "Trengo" : "Slack"} as you
                </p>
                {needsConnect && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
                    Connect your {needsConnect} account first.{" "}
                    <Link href="/settings?tab=me" className="underline font-medium">
                      Go to My Account
                    </Link>
                  </div>
                )}
                {replyError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
                    {replyError}
                  </div>
                )}
                {replyPrefilledFromAi && (
                  <div className="mb-2 inline-flex items-center gap-1.5 text-[10px] text-violet-500 font-medium">
                    <Sparkles className="h-3 w-3" />
                    AI-voorstel — review en pas aan voor je verstuurt
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => {
                      setReplyBody(e.target.value)
                      // Once the AM edits the prefilled draft, drop the AI hint —
                      // it's their message now.
                      if (replyPrefilledFromAi) setReplyPrefilledFromAi(false)
                    }}
                    placeholder={`Type your reply — sent via ${item.source} as you`}
                    rows={replyPrefilledFromAi ? 5 : 3}
                    disabled={sendingReply}
                    className="flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault()
                        sendPlatformReply()
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={sendPlatformReply}
                    disabled={!replyBody.trim() || sendingReply}
                  >
                    {sendingReply ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                  Cmd/Ctrl + Enter to send. The reply lands in {item.source === "trengo" ? "Trengo" : "Slack"} as your account, not as a bot.
                </p>
              </div>
            )}

            {canDelete && (
              <div className="border-t border-border/40 pt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={deleteItem}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )

  if (mode === "docked") {
    // Docked variant: a self-contained card filling its parent. The parent
    // (page-level aside in inbox-view) owns positioning, slide-in
    // animation and viewport height; this component just renders the
    // bordered card. No backdrop — the list next to the aside stays
    // interactive, so the AM can jump from row to row without closing.
    return (
      <div className="relative flex h-full flex-col rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        {body}
      </div>
    )
  }

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          onClick={onClose}
          className={cn(
            "fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm",
            "cursor-pointer transition-colors hover:bg-black/55",
            "duration-100 ease-out",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Popup
          className={cn(
            // Right-side slide panel — used on viewports narrower than xl
            // where the list can't sensibly sit next to a docked pane.
            // On xl+ the parent renders <ItemDetailDialog mode="docked" />
            // instead and this overlay path is never reached.
            "fixed inset-y-0 right-0 z-50 w-full sm:w-[80%] md:w-[55%] lg:w-[40%] max-w-[640px]",
            "bg-background shadow-2xl ring-1 ring-foreground/10 outline-none",
            "flex flex-col",
            "duration-[120ms] ease-out",
            "data-open:animate-in data-open:slide-in-from-right",
            "data-closed:animate-out data-closed:slide-out-to-right",
          )}
        >
          {body}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/**
 * Click-to-reassign control. Renders the current assignee as an inline button
 * styled to match the surrounding metadata text (so it doesn't look out of
 * place), and opens a small popover with the team list on click. Open to
 * anyone with visibility — handing tasks off is a routine team operation.
 */
function AssigneePicker({
  currentAssigneeId,
  currentAssigneeName,
  users,
  currentUserId,
  onChange,
  disabled,
}: {
  currentAssigneeId: string
  currentAssigneeName: string
  users: InboxUser[]
  currentUserId: string
  onChange: (userId: string) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const sorted = [...users].sort((a, b) => {
    // "You" first so single-click "Assign to me" is fastest.
    if (a.id === currentUserId) return -1
    if (b.id === currentUserId) return 1
    return (a.name ?? a.email).localeCompare(b.name ?? b.email)
  })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1 py-0.5 -mx-1 -my-0.5 transition-colors",
          "hover:bg-muted/60 hover:text-foreground",
          "data-[popup-open]:bg-muted/60 data-[popup-open]:text-foreground",
          disabled && "opacity-60 cursor-wait",
        )}
        title="Reassign"
      >
        {currentAssigneeName}
        <ChevronDown className="h-3 w-3 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="p-1 w-56">
        <div className="max-h-72 overflow-y-auto">
          {sorted.map((u) => {
            const active = u.id === currentAssigneeId
            const label = u.name ?? u.email
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  onChange(u.id)
                }}
                disabled={active}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors flex items-center justify-between gap-2",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted/60",
                )}
              >
                <span className="truncate">
                  {label}
                  {u.id === currentUserId && (
                    <span className="text-muted-foreground/60"> (you)</span>
                  )}
                </span>
                {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Three-pill segmented control to move an item between Tasks / Updates / Chat
 * tabs. Currently-selected kind is highlighted. Chat is only shown when the
 * item came from a thread-bearing source (Trengo or Slack) — Monday updates
 * and manual items don't have a thread to live in.
 */
/**
 * Slack-style chat thread for per-task team conversation. Replaces the
 * old flat comment list. Comments by the current user align right (no
 * bubble — like Linear/iMessage); others align left with an avatar
 * initial. Empty state encourages a first message instead of just
 * showing "Comments (0)" which felt forgotten. Enter sends, Shift+Enter
 * newlines (matches Slack/Discord); Cmd/Ctrl+Enter still works for
 * legacy muscle memory.
 */
function CommentThread({
  comments,
  currentUserId,
  users,
  draft,
  onDraftChange,
  onSend,
  sending,
}: {
  comments: InboxComment[]
  currentUserId: string
  users: InboxUser[]
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  sending: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Mention picker state. `mentionStart` records the position of the `@`
  // character that opened the popover so we know where to splice the picked
  // name back in. `mentionQuery` is the substring after `@` that filters
  // the user list as the AM keeps typing.
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionHighlight, setMentionHighlight] = useState(0)

  // Auto-scroll to bottom whenever the comment list grows. Only triggers
  // on count change so reading old comments doesn't yank you back down.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [comments.length])

  // Filter the team list by the typed query (after `@`). Excludes the
  // current user — mentioning yourself is not useful. Caps to 8 results
  // so the popover doesn't dwarf the composer on a big team.
  const mentionMatches = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    return users
      .filter((u) => u.id !== currentUserId)
      .filter((u) => {
        if (!q) return true
        const haystack = `${u.name ?? ""} ${u.email}`.toLowerCase()
        return haystack.includes(q)
      })
      .slice(0, 8)
  }, [users, mentionQuery, currentUserId])

  // Keep highlight inside bounds when the filter shrinks the list.
  useEffect(() => {
    if (mentionHighlight >= mentionMatches.length) setMentionHighlight(0)
  }, [mentionMatches.length, mentionHighlight])

  // Detect `@` start, track the query as the user types, close on space
  // (mention boundaries are word-shaped) or when the user navigates away.
  function syncMentionState(value: string, caret: number) {
    // Look back from the caret for a `@` that isn't preceded by a non-space
    // character (so an email "roy@rocketleads" doesn't pop the picker).
    let i = caret - 1
    while (i >= 0 && /[A-Za-zÀ-ÖØ-öø-ÿ.\-' ]/.test(value[i])) i--
    if (i >= 0 && value[i] === "@") {
      const prev = i === 0 ? " " : value[i - 1]
      if (/\s|^/.test(prev) || i === 0) {
        const q = value.slice(i + 1, caret)
        // Multi-word query is fine but we cap at one space — beyond that
        // it's no longer a name.
        if (q.split(/\s+/).length <= 2) {
          setMentionStart(i)
          setMentionQuery(q)
          return
        }
      }
    }
    setMentionStart(null)
    setMentionQuery("")
  }

  function applyMention(user: InboxUser) {
    if (mentionStart == null) return
    const ta = textareaRef.current
    if (!ta) return
    // Insert the user's first name (matching what the backend matcher
    // expects). Append a trailing space so the next keystroke is a fresh
    // word, not a continuation of the picker.
    const firstName = (user.name ?? user.email).split(/\s+/)[0]
    const before = draft.slice(0, mentionStart)
    const after = draft.slice(ta.selectionStart)
    const insertion = `@${firstName} `
    const next = before + insertion + after
    onDraftChange(next)
    setMentionStart(null)
    setMentionQuery("")
    // Restore focus + caret position right after the inserted name.
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="border-t border-border/40 pt-4 -mx-1 flex flex-col">
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 inline-flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3" />
          Thread
        </p>
        {comments.length > 0 && (
          <span className="text-[10px] text-muted-foreground/50 tabular-nums">
            {comments.length} {comments.length === 1 ? "message" : "messages"}
          </span>
        )}
      </div>

      {comments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/40 px-4 py-5 text-center mb-3 mx-1">
          <p className="text-xs text-muted-foreground/70">
            No messages yet. Start a thread about this task.
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="space-y-2.5 mb-3 max-h-[40vh] overflow-y-auto px-1"
        >
          {comments.map((c) => {
            const isMe = c.authorId === currentUserId
            const initial = (c.authorName.trim()[0] ?? "?").toUpperCase()
            return (
              <div
                key={c.id}
                className={cn("flex gap-2", isMe ? "flex-row-reverse" : "flex-row")}
              >
                {!isMe && (
                  <div className="h-7 w-7 shrink-0 rounded-full bg-muted/60 inline-flex items-center justify-center text-[10px] font-semibold text-muted-foreground">
                    {initial}
                  </div>
                )}
                <div className={cn("flex-1 min-w-0", isMe ? "text-right" : "text-left")}>
                  <div
                    className={cn(
                      "text-[10px] text-muted-foreground/60 mb-0.5 inline-flex gap-1.5",
                      isMe && "flex-row-reverse",
                    )}
                  >
                    <span className="font-medium text-foreground/70">{c.authorName}</span>
                    <span>·</span>
                    <span>{fmtDateTime(c.createdAt)}</span>
                  </div>
                  <div
                    className={cn(
                      "inline-block max-w-full rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap leading-relaxed",
                      isMe
                        ? "bg-primary/10 text-foreground"
                        : "bg-muted/50 text-foreground/90",
                    )}
                  >
                    {renderMentions(c.body, users, currentUserId)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="relative flex items-end gap-2 px-1">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            onDraftChange(e.target.value)
            syncMentionState(e.target.value, e.target.selectionStart ?? 0)
          }}
          onKeyUp={(e) => {
            // Update on caret-only moves too (arrow keys, click) so backing
            // into a previously-typed @ reopens the picker.
            const ta = e.currentTarget
            syncMentionState(ta.value, ta.selectionStart ?? 0)
          }}
          onClick={(e) => {
            const ta = e.currentTarget
            syncMentionState(ta.value, ta.selectionStart ?? 0)
          }}
          placeholder="Message the team about this task…  Use @ to mention"
          rows={1}
          className="flex-1 rounded-lg border border-input bg-transparent px-3 py-2 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none min-h-[36px] max-h-32"
          onKeyDown={(e) => {
            // Mention popover keyboard handling takes priority — arrow keys
            // navigate the suggestion list, Enter/Tab pick the highlighted
            // entry, Esc cancels the picker without sending the message.
            if (mentionStart != null && mentionMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                setMentionHighlight((h) => Math.min(mentionMatches.length - 1, h + 1))
                return
              }
              if (e.key === "ArrowUp") {
                e.preventDefault()
                setMentionHighlight((h) => Math.max(0, h - 1))
                return
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault()
                applyMention(mentionMatches[mentionHighlight])
                return
              }
              if (e.key === "Escape") {
                e.preventDefault()
                setMentionStart(null)
                setMentionQuery("")
                return
              }
            }
            // Slack/Discord behaviour: Enter sends, Shift+Enter inserts a
            // newline. Keep Cmd/Ctrl+Enter as a legacy alias so anyone
            // who learned the previous behaviour doesn't get stuck.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
        />
        <Button
          size="icon"
          onClick={onSend}
          disabled={!draft.trim() || sending}
          aria-label="Send"
          className="h-9 w-9 shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>

        {mentionStart != null && mentionMatches.length > 0 && (
          <div className="absolute bottom-full mb-1 left-1 right-12 z-10 rounded-md border border-border bg-popover shadow-lg py-1 text-xs">
            {mentionMatches.map((u, i) => {
              const active = i === mentionHighlight
              return (
                <button
                  key={u.id}
                  type="button"
                  onMouseDown={(e) => {
                    // mousedown so the click fires before the textarea's
                    // blur clears the picker.
                    e.preventDefault()
                    applyMention(u)
                  }}
                  onMouseEnter={() => setMentionHighlight(i)}
                  className={cn(
                    "w-full text-left px-3 py-1.5 flex items-center gap-2",
                    active ? "bg-muted/80" : "hover:bg-muted/50",
                  )}
                >
                  <span className="h-5 w-5 shrink-0 rounded-full bg-muted inline-flex items-center justify-center text-[9px] font-semibold text-muted-foreground">
                    {(u.name?.trim()[0] ?? u.email[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">
                    <span className="font-medium text-foreground/90">
                      {u.name ?? u.email}
                    </span>
                    {u.name && (
                      <span className="text-muted-foreground/50 ml-1.5 text-[10px]">
                        {u.email}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Top-of-panel kind banner. Big colored strip + label so the user can tell
 * in a glance whether they opened a Task or an Update. The reclassify
 * dropdown lives on the right side of the banner — one-click fix when the
 * AI classifier put the item in the wrong tab.
 *
 * Tone:
 *   - task    → violet (action needed, primary brand colour)
 *   - update  → blue (informational)
 *   - chat    → muted (we rarely render this — chat lives in Client/Team Inbox)
 */
/** Collapsible "Client timeline" section rendered under the task / update
 *  detail. Wraps the canonical TimelineTab (same data source as the client
 *  detail page's Timeline tab) so the AM/CM doesn't have to navigate away
 *  to see recent Monday updates, Trengo / Slack chats, and meetings around
 *  the current item's client.
 *
 *  Default-collapsed: timeline can be heavy (full client history) and the
 *  user opens the inbox item for the item itself first — context is on
 *  demand. Toggle is local state; closing the dialog resets it on next open. */
function ClientTimelineSection({ clientId }: { clientId: string }) {
  // Default open — Roy wants the timeline visible as a scroll-down second
  // section, not hidden behind a click. The chevron stays as an escape hatch
  // for when the panel feels too busy on small viewports.
  const [open, setOpen] = useState(true)
  return (
    <div className="border-t border-border/40 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full text-left group"
      >
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground/40 inline-flex items-center gap-1.5">
          <MessagesSquare className="h-3 w-3" />
          Client timeline
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        // TimelineTab renders its own filter chips + grouped entries. Wrap
        // in a top-margin so the heading and content don't crash together.
        <div className="mt-3">
          <TimelineTab mondayItemId={clientId} />
        </div>
      )}
    </div>
  )
}

function KindBanner({
  kind,
  source,
  disabled,
  onChange,
}: {
  kind: InboxKind
  source: InboxSource
  disabled: boolean
  onChange: (kind: "task" | "update" | "chat") => void
}) {
  const tone =
    kind === "task"
      ? {
          bar: "bg-violet-500",
          bg: "bg-violet-500/10",
          text: "text-violet-700 dark:text-violet-300",
          icon: ListTodo,
          label: "Task",
          hint: "Iemand moet hier iets mee doen.",
        }
      : kind === "update"
        ? {
            bar: "bg-blue-500",
            bg: "bg-blue-500/10",
            text: "text-blue-700 dark:text-blue-300",
            icon: InboxIcon,
            label: "Update",
            hint: "Informatie om te weten — geen actie nodig.",
          }
        : {
            bar: "bg-muted-foreground/40",
            bg: "bg-muted/40",
            text: "text-foreground/80",
            icon: MessagesSquare,
            label: "Chat",
            hint: "Conversation thread.",
          }
  const Icon = tone.icon

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg overflow-hidden",
        tone.bg,
      )}
    >
      <span className={cn("w-1 self-stretch shrink-0", tone.bar)} aria-hidden />
      <div className="flex-1 min-w-0 py-2.5 pr-3 flex items-center gap-3">
        <Icon className={cn("h-5 w-5 shrink-0", tone.text)} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold leading-tight", tone.text)}>
            {tone.label}
          </p>
          <p className="text-[11px] text-muted-foreground/80 leading-tight mt-0.5">
            {tone.hint}
          </p>
        </div>
        <ReclassifyControl
          currentKind={kind}
          source={source}
          disabled={disabled}
          onChange={onChange}
          compact
        />
      </div>
    </div>
  )
}

function ReclassifyControl({
  currentKind,
  source,
  disabled,
  onChange,
  compact = false,
}: {
  currentKind: InboxKind
  source: InboxSource
  disabled: boolean
  onChange: (kind: "task" | "update" | "chat") => void
  /** Compact = no "Type" label above; renders just the segment control
   *  inline. Used by the KindBanner where the active kind is already
   *  written out in the banner itself. */
  compact?: boolean
}) {
  const canChat = source === "trengo" || source === "slack"

  const options: Array<{ value: "task" | "update" | "chat"; label: string; icon: typeof ListTodo }> = [
    { value: "task", label: "Task", icon: ListTodo },
    { value: "update", label: "Update", icon: InboxIcon },
    ...(canChat ? [{ value: "chat" as const, label: "Chat", icon: MessagesSquare }] : []),
  ]

  const segment = (
    <div className="inline-flex items-center rounded-lg border border-border/60 bg-background/60 p-0.5">
      {options.map((opt) => {
        const active = opt.value === currentKind
        const Icon = opt.icon
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={disabled || active}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  if (compact) return segment

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1.5">
        Type
      </p>
      {segment}
    </div>
  )
}

function channelLabel(channel: unknown): string {
  if (channel === "trengo_email") return "verstuur als email"
  if (channel === "trengo_whatsapp") return "verstuur als WhatsApp"
  return "verstuur via Trengo"
}

/** Inline brand mark next to the AI-draft channel label. Keeps the WhatsApp
 *  green / email blue treatment consistent with the row pills. */
function ChannelMark({ channel }: { channel: unknown }) {
  if (channel === "trengo_whatsapp") {
    return (
      <Image
        src="/logos/brands/whatsapp.svg"
        alt=""
        width={12}
        height={12}
        className="h-3 w-3 shrink-0 object-contain"
        unoptimized
      />
    )
  }
  if (channel === "trengo_email") {
    return <Mail className="h-3 w-3 text-blue-500 shrink-0" />
  }
  return null
}

/** Click-to-edit task title. Shows the current text styled as a DialogTitle;
 *  click switches to a single-line input. Enter or blur saves; Esc reverts.
 *  Empty title isn't allowed (nothing to label the task by) — we revert to
 *  the previous value instead of saving. A small pencil glyph fades in on
 *  hover so the affordance is discoverable without cluttering the header. */
function EditableTitle({
  value,
  onSave,
  className,
}: {
  value: string
  onSave: (next: string) => void | Promise<void>
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the draft in sync if the parent value changes while we're not
  // editing (e.g. another action pushed a new title in via optimistic update).
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function commit() {
    const next = draft.trim()
    if (!next) {
      // Don't save an empty title — revert and exit.
      setDraft(value)
      setEditing(false)
      return
    }
    setEditing(false)
    if (next !== value) onSave(next)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        className={cn(
          "flex-1 text-lg font-semibold leading-snug bg-background border border-primary/40 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          className,
        )}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "group/title text-left rounded-md px-2 py-1 -mx-2 -my-1 hover:bg-muted/40 transition-colors flex items-start gap-1.5",
        className,
      )}
      title="Click to edit"
    >
      <DialogTitle className="leading-snug flex-1">{value}</DialogTitle>
      <Pencil className="h-3.5 w-3.5 mt-1 text-muted-foreground/40 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
    </button>
  )
}

/** Click-to-edit task body. Empty state shows a placeholder so it's clear
 *  the field is editable even when there's nothing in it. Cmd/Ctrl+Enter or
 *  blur saves; Esc reverts. Multiline input with auto-grow up to a sensible
 *  cap so the dialog doesn't explode on long pastes. */
function EditableBody({
  value,
  onSave,
}: {
  value: string
  onSave: (next: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      // Place cursor at end rather than selecting all — body edits are
      // usually appends/tweaks, not full rewrites.
      const len = ref.current?.value.length ?? 0
      ref.current?.setSelectionRange(len, len)
    }
  }, [editing])

  function commit() {
    setEditing(false)
    if (draft !== value) onSave(draft)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            cancel()
          }
        }}
        rows={Math.min(Math.max(draft.split("\n").length, 3), 16)}
        placeholder="Add a description…"
        className="w-full text-sm bg-background border border-primary/40 rounded-md px-3 py-2 leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 resize-y"
      />
    )
  }

  // Defensive cap: a single Monday update body of 100k+ chars (pasted email
  // thread, oversized log dump) was crashing Chrome's renderer with
  // RESULT_CODE_KILLED_BAD_MESSAGE / "This page couldn't load" — `whitespace-
  // pre-wrap` on a multi-MB string with no breakable whitespace blows up
  // layout. Slice for display; the full body still lives server-side and the
  // editing textarea pulls the untrimmed value when the user opens it.
  const MAX_DISPLAY_CHARS = 20_000
  const truncated = value.length > MAX_DISPLAY_CHARS
  const displayValue = truncated ? value.slice(0, MAX_DISPLAY_CHARS) : value

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group/body w-full text-left rounded-md px-3 py-2 -mx-3 hover:bg-muted/40 transition-colors min-h-[2.5rem]"
      title="Click to edit"
    >
      {value ? (
        <>
          <span className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed block">
            {displayValue}
          </span>
          {truncated && (
            <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
              … {value.length.toLocaleString()} chars total — body truncated for display. Click to edit and see the full text.
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground/50 italic inline-flex items-center gap-1.5">
          <Pencil className="h-3 w-3" />
          Add a description…
        </span>
      )}
    </button>
  )
}
