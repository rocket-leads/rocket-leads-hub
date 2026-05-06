"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Search, X } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { InboxKind, InboxPriority } from "@/types/inbox"
import type { InboxUser, InboxClientOption } from "./inbox-view"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultKind: InboxKind
  users: InboxUser[]
  clients: InboxClientOption[]
  lockedClient?: InboxClientOption
  currentUserId: string
  onCreated: () => void
}

const SELECT_CLS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function ComposerDialog({
  open,
  onOpenChange,
  defaultKind,
  users,
  clients,
  lockedClient,
  currentUserId,
  onCreated,
}: Props) {
  const [kind, setKind] = useState<InboxKind>(defaultKind)
  const [clientId, setClientId] = useState(lockedClient?.id ?? "")
  const [assigneeId, setAssigneeId] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [priority, setPriority] = useState<InboxPriority>("normal")
  const [dueDate, setDueDate] = useState<string>(todayIso())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form on open / when defaults change. Due date defaults to today on
  // every fresh open so the AM doesn't have to type/click — Roy's directive.
  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setClientId(lockedClient?.id ?? "")
    setAssigneeId(
      defaultKind === "task"
        ? currentUserId
        : users.find((u) => u.id !== currentUserId)?.id ?? currentUserId,
    )
    setTitle("")
    setBody("")
    setPriority("normal")
    setDueDate(todayIso())
    setError(null)
  }, [open, defaultKind, lockedClient?.id, currentUserId, users])

  async function submit() {
    if (!clientId) {
      setError("Pick a client.")
      return
    }
    if (!assigneeId) {
      setError("Pick a recipient.")
      return
    }
    if (!title.trim()) {
      setError("Title is required.")
      return
    }
    if (kind === "task" && !dueDate) {
      setError("Due date is required for tasks.")
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch("/api/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          clientId,
          assigneeId,
          title: title.trim(),
          body: body.trim() || undefined,
          priority: kind === "task" ? priority : undefined,
          dueDate: kind === "task" ? dueDate : undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? "Failed to create item")
      }
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create item")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {kind === "task" ? "task" : "update"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Kind switcher */}
          <div className="inline-flex rounded-lg border border-border/40 p-0.5 text-xs">
            {(["update", "task"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "px-3 py-1 rounded-md transition-colors",
                  kind === k
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "update" ? "Update" : "Task"}
              </button>
            ))}
          </div>

          {!lockedClient && (
            <div className="space-y-1.5">
              <Label htmlFor="client">Client</Label>
              <ClientCombobox
                clients={clients}
                value={clientId}
                onChange={setClientId}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="assignee">{kind === "update" ? "To" : "Assignee"}</Label>
            <select
              id="assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              className={SELECT_CLS}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                  {u.id === currentUserId ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "task" ? "What needs to happen?" : "What's the update?"}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">Details</Label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              placeholder="Optional context, links, instructions…"
            />
          </div>

          {kind === "task" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="priority">Priority</Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as InboxPriority)}
                  className={SELECT_CLS}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due">Due date</Label>
                <Input
                  id="due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : `Create ${kind}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Search-as-you-type client picker. Shows the selected client's name in
 *  the input; typing filters a dropdown of matches. Click a row or hit
 *  Enter on the highlighted row to pick. Esc closes the dropdown without
 *  changing the selection. */
function ClientCombobox({
  clients,
  value,
  onChange,
}: {
  clients: InboxClientOption[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(() => clients.find((c) => c.id === value) ?? null, [clients, value])

  // When the dialog re-uses the same composer instance and the parent
  // resets `value` to "", we want the visible text to clear too.
  useEffect(() => {
    if (!value) setQuery("")
    else setQuery(selected?.name ?? "")
  }, [value, selected])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [open])

  const filtered = useMemo(() => {
    // Sort: live clients first (most-used in practice — those AMs work on
    // every day), alphabetical within each group. When the user types, the
    // filter still respects this order so live matches lead the dropdown.
    const sorted = [...clients].sort((a, b) => {
      if (!!a.isLive !== !!b.isLive) return a.isLive ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const q = query.trim().toLowerCase()
    if (!q) return sorted.slice(0, 50)
    return sorted.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 50)
  }, [clients, query])

  function pick(client: InboxClientOption) {
    onChange(client.id)
    setQuery(client.name)
    setOpen(false)
  }

  function clear() {
    onChange("")
    setQuery("")
    setOpen(true)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60 pointer-events-none" />
        <input
          type="text"
          value={query}
          placeholder="Search a client…"
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
            setOpen(true)
            if (selected && e.target.value !== selected.name) {
              // User started typing on top of the selected name → clear value
              // until they pick a new one. Avoids a stale id with mismatched
              // visible text.
              onChange("")
            }
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setHighlight((h) => Math.min(filtered.length - 1, h + 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlight((h) => Math.max(0, h - 1))
            } else if (e.key === "Enter" && filtered[highlight]) {
              e.preventDefault()
              pick(filtered[highlight])
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
          className={cn(SELECT_CLS, "pl-8 pr-8")}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 inline-flex items-center justify-center"
            aria-label="Clear"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-lg py-1">
          {filtered.map((c, i) => {
            const isSelected = c.id === value
            const isHighlighted = i === highlight
            return (
              <button
                key={c.id}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(c)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2",
                  isHighlighted && "bg-muted/60",
                )}
              >
                <span className="truncate">{c.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg px-3 py-2 text-xs text-muted-foreground">
          No client found for &quot;{query}&quot;.
        </div>
      )}
    </div>
  )
}
