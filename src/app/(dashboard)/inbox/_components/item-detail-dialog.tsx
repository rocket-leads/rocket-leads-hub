"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, Send, Calendar, AlertCircle, Loader2, MessageSquare, Hash, ListTodo, Inbox as InboxIcon, MessagesSquare, Link2Off, Link2, Check, ChevronDown, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { InboxComment, InboxItem, InboxKind, InboxSource, TaskStatus } from "@/types/inbox"
import type { CurrentUser, InboxUser } from "./inbox-view"
import { LinkTrengoContactDialog } from "./link-trengo-dialog"
import { SourcePill } from "./source-pill"

type Props = {
  itemId: string
  currentUser: CurrentUser
  users: InboxUser[]
  onClose: () => void
  onChanged: () => void
}

const TASK_STATUS_OPTIONS: Array<{ value: TaskStatus; label: string; cls: string }> = [
  { value: "open", label: "Open", cls: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  { value: "in_progress", label: "In progress", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  { value: "done", label: "Done", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  { value: "cancelled", label: "Cancelled", cls: "bg-muted text-muted-foreground border-border" },
]

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ItemDetailDialog({ itemId, currentUser, users, onClose, onChanged }: Props) {
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
  const hasDraft =
    isTask &&
    typeof draftMessage === "string" &&
    draftMessage.trim().length > 0 &&
    (item?.status === "open" || item?.status === "in_progress")
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

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        {detailQuery.isLoading || !item ? (
          <div className="py-12 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-start gap-2">
                {item.priority === "high" && (
                  <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <DialogTitle className="leading-snug flex-1">{item.title}</DialogTitle>
                <SourcePill source={item.source} className="shrink-0 mt-1" />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70 mt-1">
                {item.isUnlinked ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-500 dark:text-amber-400 px-1.5 py-0.5 font-medium">
                    <Link2Off className="h-3 w-3" />
                    Unlinked Trengo contact
                  </span>
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

            {item.body && (
              <div className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed">
                {item.body}
              </div>
            )}

            {/* Reclassify — escape hatch when AI put it in the wrong tab.
                Chat is only offered for thread-bearing sources (Trengo/Slack);
                Monday/automation/manual items don't have a thread to live in. */}
            <ReclassifyControl
              currentKind={item.kind}
              source={item.source}
              disabled={reclassifying}
              onChange={reclassify}
            />

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

                {/* Comments */}
                <div className="border-t border-border/40 pt-3">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-2">
                    Comments ({comments.length})
                  </p>
                  {comments.length > 0 && (
                    <div className="space-y-3 mb-3">
                      {comments.map((c) => (
                        <div key={c.id} className="text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-foreground">{c.authorName}</span>
                            <span className="text-muted-foreground/60">{fmtDateTime(c.createdAt)}</span>
                          </div>
                          <p className="text-foreground/80 whitespace-pre-wrap leading-relaxed">{c.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder="Add a comment…"
                      rows={2}
                      className="flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          addComment()
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={addComment}
                      disabled={!commentBody.trim() || submittingComment}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {hasDraft && (
              <div className="border-t border-border/40 pt-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-2 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  AI draft — {channelLabel(draftChannel)}
                </p>
                {draftNeedsConnect && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 mb-2 text-xs">
                    Connect your Trengo account first.{" "}
                    <Link href="/account" className="underline font-medium">
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
                    <Link href="/account" className="underline font-medium">
                      Go to My Account
                    </Link>
                  </div>
                )}
                {replyError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 text-xs text-destructive">
                    {replyError}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={`Type your reply — sent via ${item.source} as you`}
                    rows={3}
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
      </DialogContent>
    </Dialog>
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
function ReclassifyControl({
  currentKind,
  source,
  disabled,
  onChange,
}: {
  currentKind: InboxKind
  source: InboxSource
  disabled: boolean
  onChange: (kind: "task" | "update" | "chat") => void
}) {
  const canChat = source === "trengo" || source === "slack"

  const options: Array<{ value: "task" | "update" | "chat"; label: string; icon: typeof ListTodo }> = [
    { value: "task", label: "Task", icon: ListTodo },
    { value: "update", label: "Update", icon: InboxIcon },
    ...(canChat ? [{ value: "chat" as const, label: "Chat", icon: MessagesSquare }] : []),
  ]

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/40 mb-1.5">
        Type
      </p>
      <div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/30 p-0.5">
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
                "inline-flex items-center gap-1.5 px-3 h-7 rounded-md text-xs font-medium transition-colors",
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
    </div>
  )
}

function channelLabel(channel: unknown): string {
  if (channel === "trengo_email") return "verstuur als email"
  if (channel === "trengo_whatsapp") return "verstuur als WhatsApp"
  return "verstuur via Trengo"
}
