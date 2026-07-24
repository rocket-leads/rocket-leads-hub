"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, CornerDownRight, Loader2, Send, ChevronDown, ChevronRight, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { UserAvatar } from "@/components/ui/user-avatar"
import { fmtRelative } from "../chat-pane"
import { ReactionBar } from "./reaction-bar"
import type { ReactionSummary } from "@/lib/inbox/reactions"
import type { InboxItem, InboxComment } from "@/types/inbox"

const KIND_COLOR: Record<"task" | "update", { rail: string; dot: string; label: string }> = {
  task: { rail: "bg-violet-500", dot: "bg-violet-500", label: "Task" },
  update: { rail: "bg-sky-500", dot: "bg-sky-500", label: "Update" },
}

/** Highlight @Name mentions inline without a full parser - good enough for the
 *  card body + replies (the composer/backend own the real resolution). */
function renderMentions(text: string): React.ReactNode {
  const parts = text.split(/(@[A-Za-zÀ-ÖØ-öø-ÿ.\-']+(?:\s+[A-Za-zÀ-ÖØ-öø-ÿ.\-']+)?)/g)
  return parts.map((p, i) =>
    p.startsWith("@") ? (
      <span key={i} className="rounded bg-violet-500/15 px-1 font-medium text-violet-600 dark:text-violet-300">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

type Props = {
  item: InboxItem
  currentUserId: string
  reactions: ReactionSummary[]
  onReactionsChange: (itemId: string, next: ReactionSummary[]) => void
  onChanged: () => void
}

export function UpdateCard({ item, currentUserId, reactions, onReactionsChange, onChanged }: Props) {
  const queryClient = useQueryClient()
  const locale = useLocale()
  const isUpdate = item.kind === "update"
  const kind = isUpdate ? KIND_COLOR.update : KIND_COLOR.task
  const kindLabel = t(isUpdate ? "inbox.card.kind.update" : "inbox.card.kind.task", locale)
  // "Checked off" = done (task) or read (update). Cancelled counts as closed.
  const isChecked = isUpdate ? item.status === "read" : item.status === "done" || item.status === "cancelled"

  const [busy, setBusy] = useState(false)
  const [repliesOpen, setRepliesOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)

  const commentsQuery = useQuery<{ comments: InboxComment[] }>({
    queryKey: ["inbox-comments", item.id],
    queryFn: () => fetch(`/api/inbox/${item.id}/comments`).then((r) => r.json()),
    enabled: repliesOpen,
  })
  const comments = commentsQuery.data?.comments ?? []

  async function toggleChecked() {
    setBusy(true)
    const status = isUpdate
      ? isChecked ? "unread" : "read"
      : isChecked ? "open" : "done"
    await fetch(`/api/inbox/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setBusy(false)
    onChanged()
  }

  async function toggleReaction(emoji: string) {
    const res = await fetch(`/api/inbox/${item.id}/reactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emoji }),
    })
    const data = (await res.json().catch(() => null)) as { reactions?: ReactionSummary[] } | null
    if (data?.reactions) onReactionsChange(item.id, data.reactions)
  }

  async function sendReply() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    await fetch(`/api/inbox/${item.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    })
    setDraft("")
    setSending(false)
    await queryClient.invalidateQueries({ queryKey: ["inbox-comments", item.id] })
    onChanged()
  }

  const replyCount = item.commentCount

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/70 bg-card pl-5 pr-4 py-4 transition-colors",
        isChecked && "opacity-60",
      )}
    >
      <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-1", kind.rail, isChecked && "opacity-40")} />

      {/* Header: who → for whom · client · time, complete checkbox on the right */}
      <div className="flex items-start gap-3">
        <UserAvatar
          name={item.authorName}
          avatarUrl={item.authorAvatarUrl}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-semibold text-foreground">{item.authorName}</span>
            {item.assigneeName && item.assigneeId !== item.authorId && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowRight className="h-3 w-3" />
                <UserAvatar
                  name={item.assigneeName}
                  avatarUrl={item.assigneeAvatarUrl}
                  size="sm"
                />
                {item.assigneeName}
              </span>
            )}
            <span className="font-mono text-[11px] text-muted-foreground/50 tabular-nums">· {fmtRelative(item.createdAt)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground/70">
            <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide">
              <span className={cn("h-1.5 w-1.5 rounded-full", kind.dot)} />
              {kindLabel}
            </span>
            {item.clientName && item.clientName !== "(unknown)" && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{item.clientName}</span>
              </>
            )}
            {item.dueDate && (
              <>
                <span aria-hidden>·</span>
                <span>{t("inbox.card.due_prefix", locale, { date: item.dueDate })}</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleChecked}
          disabled={busy}
          aria-pressed={isChecked}
          title={isChecked ? t("inbox.card.mark_not_done", locale) : t("inbox.card.mark_done", locale)}
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
            isChecked
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-muted-foreground/40 text-transparent hover:border-emerald-500/60 hover:text-emerald-500/40",
          )}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
      </div>

      {/* Body */}
      <div className="mt-3 pl-11">
        {item.title && <p className="text-sm font-medium text-foreground">{renderMentions(item.title)}</p>}
        {item.body && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{renderMentions(item.body)}</p>
        )}

        {/* Reactions */}
        <div className="mt-3">
          <ReactionBar reactions={reactions} onToggle={toggleReaction} />
        </div>

        {/* Replies */}
        <div className="mt-3 border-t border-border/50 pt-2">
          <button
            type="button"
            onClick={() => setRepliesOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {repliesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <CornerDownRight className="h-3.5 w-3.5" />
            {replyCount > 0
              ? t(replyCount === 1 ? "inbox.card.reply_count" : "inbox.card.reply_count_plural", locale, { n: replyCount })
              : t("inbox.card.reply", locale)}
          </button>

          {repliesOpen && (
            <div className="mt-2 space-y-2">
              {commentsQuery.isLoading ? (
                <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground/60">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("inbox.card.loading_replies", locale)}
                </div>
              ) : (
                comments.map((c) => {
                  const mine = c.authorId === currentUserId
                  return (
                    <div key={c.id} className="flex items-start gap-2">
                      <UserAvatar
                        name={c.authorName}
                        avatarUrl={c.authorAvatarUrl}
                        size="sm"
                        className="shrink-0"
                      />
                      <div
                        className={cn(
                          "min-w-0 flex-1 rounded-2xl px-3 py-1.5",
                          mine ? "bg-primary/10" : "bg-muted/50",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">{c.authorName}</span>
                          <span className="text-[10px] text-muted-foreground/60">{fmtRelative(c.createdAt)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                          {renderMentions(c.body)}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}

              {/* Composer */}
              <div className="flex items-end gap-2 pt-1">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      void sendReply()
                    }
                  }}
                  rows={1}
                  placeholder={t("inbox.card.reply_placeholder", locale)}
                  className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 dark:bg-input/30"
                />
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={!draft.trim() || sending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
