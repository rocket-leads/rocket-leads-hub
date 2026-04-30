"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Trash2, Send, Calendar, AlertCircle, Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { InboxComment, InboxItem, TaskStatus } from "@/types/inbox"
import type { CurrentUser, InboxUser } from "./inbox-view"

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

export function ItemDetailDialog({ itemId, currentUser, onClose, onChanged }: Props) {
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

  const isUpdate = item?.kind === "update"
  const isTask = item?.kind === "task"
  const canDelete = !!item && (item.authorId === currentUser.id || currentUser.role === "admin")

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
                <DialogTitle className="leading-snug">{item.title}</DialogTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/70 mt-1">
                <span className="font-medium">{item.clientName}</span>
                <span>·</span>
                <span>{item.authorName}</span>
                <span>→</span>
                <span>{item.assigneeName}</span>
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

            {item.body && (
              <div className="text-sm whitespace-pre-wrap text-foreground/90 leading-relaxed">
                {item.body}
              </div>
            )}

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
