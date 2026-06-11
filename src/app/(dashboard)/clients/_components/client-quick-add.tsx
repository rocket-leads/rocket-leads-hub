"use client"

import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  type KeyboardEvent,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Send, CheckSquare, MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Quick-add bar - Monday-parity compose for the client slide-over.
 *
 * Sits between the client header and the tabs so it's reachable from
 * every tab. One textarea, Enter = post, Shift+Enter = newline. The
 * point is to match Monday's "type and post" UX exactly: any AM should
 * never feel a reason to open Monday to drop an internal note on a
 * client when the same gesture works here.
 *
 * Kind selection:
 *  - Default: `update` (matches Monday's primary update flow).
 *  - Implicit `task` when the text starts with `todo:` or `[task]`
 *    (case-insensitive). No toggle UI - fewer clicks, fewer decisions.
 *    Roy's brief: "minder clicks dan Monday, niet meer."
 *
 * Assignee resolution:
 *  - First `@name` mention in the text → that user.
 *  - No mention → current user (so the post lands in their own inbox
 *    as a personal log, same as Monday's self-update behaviour).
 *
 * On success the bar:
 *  - Clears the input immediately (no spinner blocking next thought).
 *  - Invalidates timeline + inbox + badge queries so both the Timeline
 *    tab and Inbox tab pick the new row up without a manual reload.
 *  - Surfaces a transient confirmation right under the bar so the user
 *    knows the post landed without needing to switch tabs to verify.
 *
 * Roy 2026-06-09: built as part of the Hub-vs-Monday parity push to
 * cut Monday-update creation in the team.
 */

type Props = {
  mondayItemId: string
  clientName: string
  currentUser: { id: string; name: string }
}

type InboxUser = {
  id: string
  name: string | null
  email: string
}

const TASK_PREFIX_RE = /^\s*(\[task\]|todo:)\s*/i

/** Resolve the first `@firstname` (or `@firstname lastname`) mention in
 *  the text to a Hub user. We're permissive: match against first names,
 *  full names, and email-prefix (the part before @) - case-insensitive.
 *  Returns null when no mention or no match (caller falls back to self). */
function resolveFirstMention(
  text: string,
  users: InboxUser[],
): InboxUser | null {
  // Capture `@` followed by 1-2 name tokens (allowing letters, dashes, dots)
  const match = text.match(/@([\p{L}][\p{L}\-.']{0,30}(?:\s+[\p{L}][\p{L}\-.']{0,30})?)/u)
  if (!match) return null
  const raw = match[1].toLowerCase().trim()
  const tokens = raw.split(/\s+/)
  for (const u of users) {
    const fullName = (u.name ?? "").toLowerCase()
    const firstName = fullName.split(/\s+/)[0]
    const emailPrefix = u.email.split("@")[0].toLowerCase()
    if (fullName === raw || firstName === tokens[0] || emailPrefix === tokens[0]) {
      return u
    }
  }
  return null
}

/** Strip the leading `todo:`/`[task]` and the leading `@mention` so the
 *  title/body don't carry the routing metadata. The mention stays
 *  visible only in the title when the user wrote it INLINE in a sentence
 *  ("ping @stefan to check this"); a bare leading mention gets removed. */
function stripLeadingMention(text: string): string {
  return text.replace(/^\s*@[\p{L}][\p{L}\-.']{0,30}(?:\s+[\p{L}][\p{L}\-.']{0,30})?\s*/u, "")
}

export function ClientQuickAdd({ mondayItemId, clientName, currentUser }: Props) {
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState("")
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justPosted, setJustPosted] = useState<null | "update" | "task">(null)

  // Hub user list - same source the global inbox composer uses. Cached for
  // 10 min so this isn't a per-mount round-trip.
  const usersQuery = useQuery<{ users: InboxUser[] }>({
    queryKey: ["inbox-users"],
    queryFn: () => fetch("/api/inbox/users").then((r) => r.json()),
    staleTime: 10 * 60 * 1000,
  })
  const users = usersQuery.data?.users ?? []

  // Inferred kind + resolved assignee for the current draft. Used both for
  // the visual indicator chip and at submit time so what the user sees is
  // exactly what gets posted.
  const { kind, resolvedAssignee } = useMemo(() => {
    const isTask = TASK_PREFIX_RE.test(value)
    const mention = resolveFirstMention(value, users)
    return {
      kind: isTask ? ("task" as const) : ("update" as const),
      resolvedAssignee: mention ?? null,
    }
  }, [value, users])

  // Auto-grow textarea to fit content, capped at ~5 lines so the bar can't
  // dominate the slide-over.
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`
  }, [value])

  // Hide the "Posted" confirmation after a beat so the bar stays clean
  // for the next thought.
  useEffect(() => {
    if (!justPosted) return
    const timer = setTimeout(() => setJustPosted(null), 2200)
    return () => clearTimeout(timer)
  }, [justPosted])

  const submit = useCallback(async () => {
    const raw = value.trim()
    if (!raw || posting) return

    // Strip the inferred prefix + leading mention from the title.
    const withoutPrefix = raw.replace(TASK_PREFIX_RE, "")
    const withoutMention = stripLeadingMention(withoutPrefix)
    const cleaned = withoutMention.trim() || raw // fall back to raw if everything stripped

    // First non-empty line is the title; the rest goes to body. Matches
    // Monday's behaviour where the first line shows up in the feed and
    // expand reveals the rest.
    const lines = cleaned.split(/\n/)
    const title = (lines[0] ?? "").trim().slice(0, 280) || raw.slice(0, 280)
    const body = lines.slice(1).join("\n").trim() || null

    const assigneeId = resolvedAssignee?.id ?? currentUser.id

    setPosting(true)
    setError(null)
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          clientId: mondayItemId,
          assigneeId,
          title,
          body,
          source: "manual",
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        throw new Error(data.error || "Post mislukt")
      }
      setValue("")
      setJustPosted(kind)
      // Invalidate the surfaces that show this client's events. The
      // Timeline tab and Inbox tab both refetch; the badge counter in
      // the navbar also picks the new item up.
      queryClient.invalidateQueries({ queryKey: ["timeline", mondayItemId] })
      queryClient.invalidateQueries({ queryKey: ["inbox"] })
      queryClient.invalidateQueries({ queryKey: ["inbox-badge"] })
      queryClient.invalidateQueries({ queryKey: ["inbox-now"] })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post mislukt")
    } finally {
      setPosting(false)
    }
  }, [value, posting, kind, resolvedAssignee, currentUser.id, mondayItemId, queryClient])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter posts; Shift+Enter inserts newline (standard chat UX).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-3">
      <div className="flex items-start gap-2">
        <div className="mt-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {kind === "task" ? (
            <CheckSquare className="h-4 w-4" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Snelle update over ${clientName} - Enter om te plaatsen, @ om toe te wijzen, "todo:" voor een taak`}
            rows={1}
            className={cn(
              "w-full resize-none bg-transparent border-0 outline-none text-sm leading-relaxed",
              "placeholder:text-muted-foreground/60",
              "min-h-[2.25rem] py-2",
            )}
            disabled={posting}
          />
          {(justPosted || error) && (
            <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
              {justPosted && !error && (
                <span className="text-emerald-600">
                  {justPosted === "task" ? "Taak geplaatst" : "Update geplaatst"}
                </span>
              )}
              {error && <span className="text-destructive">{error}</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!value.trim() || posting}
          className={cn(
            "shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md",
            "border border-border bg-primary text-primary-foreground shadow-sm",
            "hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
          )}
          aria-label={kind === "task" ? "Taak plaatsen" : "Update plaatsen"}
          title={kind === "task" ? "Taak plaatsen (Enter)" : "Update plaatsen (Enter)"}
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
