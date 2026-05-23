"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DismissButton } from "@/components/ui/dismiss-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import type { Locale } from "@/lib/i18n/types"
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
  /** When the composer is opened from "Make task" on a chat message, the
   *  caller pre-fills the client + title so the user only confirms. Cleared
   *  every fresh open with no defaults (so re-opening from the toolbar
   *  doesn't keep the chat-derived state). */
  defaultClientId?: string
  defaultTitle?: string
  defaultBody?: string
}

const SELECT_CLS =
  "h-10 w-full rounded-lg border border-input bg-transparent px-3 text-[15px] dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

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
  defaultClientId,
  defaultTitle,
  defaultBody,
}: Props) {
  const locale = useLocale()
  const [kind, setKind] = useState<InboxKind>(defaultKind)
  const [clientId, setClientId] = useState(lockedClient?.id ?? defaultClientId ?? "")
  const [assigneeId, setAssigneeId] = useState("")
  const [title, setTitle] = useState(defaultTitle ?? "")
  const [body, setBody] = useState(defaultBody ?? "")
  const [priority, setPriority] = useState<InboxPriority>("normal")
  const [dueDate, setDueDate] = useState<string>(todayIso())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form on open / when defaults change. Due date defaults to today on
  // every fresh open so the AM doesn't have to type/click — Roy's directive.
  // Pre-fill from chat-derived defaults when present (e.g. "Make task" on a
  // Trengo message); otherwise reset to empty so the standalone toolbar
  // open doesn't inherit stale chat state.
  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setClientId(lockedClient?.id ?? defaultClientId ?? "")
    setAssigneeId(
      defaultKind === "task"
        ? currentUserId
        : users.find((u) => u.id !== currentUserId)?.id ?? currentUserId,
    )
    setTitle(defaultTitle ?? "")
    setBody(defaultBody ?? "")
    setPriority("normal")
    setDueDate(todayIso())
    setError(null)
  }, [open, defaultKind, lockedClient?.id, currentUserId, users, defaultClientId, defaultTitle, defaultBody])

  async function submit() {
    if (!clientId) {
      setError(t("inbox.composer.error.no_client", locale))
      return
    }
    if (!assigneeId) {
      setError(t("inbox.composer.error.no_recipient", locale))
      return
    }
    if (!title.trim()) {
      setError(t("inbox.composer.error.no_title", locale))
      return
    }
    if (kind === "task" && !dueDate) {
      setError(t("inbox.composer.error.no_due", locale))
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
        throw new Error(j.error ?? t("inbox.composer.error.create_failed", locale))
      }
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : t("inbox.composer.error.create_failed", locale))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {kind === "task" ? t("inbox.composer.title.task", locale) : t("inbox.composer.title.update", locale)}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Kind switcher — promoted to full-weight segmented control so the
              user immediately sees they're choosing between a one-way Update
              and an actionable Task. */}
          <div className="inline-flex rounded-lg border border-border p-1 text-sm bg-muted/40">
            {(["update", "task"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "px-4 py-1.5 rounded-md transition-colors font-medium",
                  kind === k
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "update" ? t("inbox.composer.tab.update", locale) : t("inbox.composer.tab.task", locale)}
              </button>
            ))}
          </div>

          {/* Client + Assignee live on the same row when both are needed —
              they're the two "who is this about / who acts" knobs and belong
              together. When the dialog is locked to a client, assignee
              stretches full-width on its own row. */}
          <div className={cn("grid gap-4", !lockedClient ? "grid-cols-2" : "grid-cols-1")}>
            {!lockedClient && (
              <div className="space-y-1.5">
                <Label htmlFor="client">{t("inbox.composer.field.client", locale)}</Label>
                <ClientCombobox
                  clients={clients}
                  value={clientId}
                  onChange={setClientId}
                  locale={locale}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="assignee">
                {kind === "update" ? t("inbox.composer.field.to", locale) : t("inbox.composer.field.assignee", locale)}
              </Label>
              <select
                id="assignee"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={SELECT_CLS}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {u.id === currentUserId ? t("inbox.composer.you_suffix", locale) : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="title">{t("inbox.composer.field.title", locale)}</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "task" ? t("inbox.composer.placeholder.title_task", locale) : t("inbox.composer.placeholder.title_update", locale)}
              className="h-10 text-[15px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">{t("inbox.composer.field.body", locale)}</Label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-[15px] dark:bg-input/30 focus:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 resize-none"
              placeholder={t("inbox.composer.placeholder.body", locale)}
            />
          </div>

          {kind === "task" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="priority">{t("inbox.composer.field.priority", locale)}</Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as InboxPriority)}
                  className={SELECT_CLS}
                >
                  <option value="low">{t("inbox.composer.priority.low", locale)}</option>
                  <option value="normal">{t("inbox.composer.priority.normal", locale)}</option>
                  <option value="high">{t("inbox.composer.priority.high", locale)}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due">{t("inbox.composer.field.due", locale)}</Label>
                <Input
                  id="due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  required
                  className="h-10 text-[15px]"
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t("inbox.composer.action.cancel", locale)}
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? t("inbox.composer.action.creating", locale) : kind === "task" ? t("inbox.composer.action.create_task", locale) : t("inbox.composer.action.create_update", locale)}
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
  locale,
}: {
  clients: InboxClientOption[]
  value: string
  onChange: (id: string) => void
  locale: Locale
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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/60 pointer-events-none" />
        <input
          type="text"
          value={query}
          placeholder={t("inbox.composer.placeholder.client_search", locale)}
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
          className={cn(SELECT_CLS, "pl-9 pr-9")}
        />
        {value && (
          <DismissButton
            size="xs"
            onClick={clear}
            label={t("inbox.composer.action.clear", locale)}
            stopPropagation={false}
            className="absolute right-2 top-1/2 -translate-y-1/2"
          />
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
          {t("inbox.composer.combobox.no_match", locale, { query })}
        </div>
      )}
    </div>
  )
}
