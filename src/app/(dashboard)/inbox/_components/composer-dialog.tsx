"use client"

import { useEffect, useMemo, useState } from "react"
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

const SELECT_CLS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

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
  const [dueDate, setDueDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form on open / when defaults change.
  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setClientId(lockedClient?.id ?? "")
    // Updates default to "send to first non-self user", tasks default to self.
    setAssigneeId(
      defaultKind === "task"
        ? currentUserId
        : users.find((u) => u.id !== currentUserId)?.id ?? currentUserId,
    )
    setTitle("")
    setBody("")
    setPriority("normal")
    setDueDate("")
    setError(null)
  }, [open, defaultKind, lockedClient?.id, currentUserId, users])

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  )

  async function submit() {
    if (!clientId || !assigneeId || !title.trim()) {
      setError("Client, assignee and title are required.")
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
          dueDate: kind === "task" && dueDate ? dueDate : undefined,
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
              <select
                id="client"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={SELECT_CLS}
              >
                <option value="">Select a client…</option>
                {sortedClients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
