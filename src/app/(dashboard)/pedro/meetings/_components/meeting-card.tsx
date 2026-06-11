"use client"

import { useState, useTransition, useMemo, useRef, useEffect } from "react"
import Link from "next/link"
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Users,
  CheckSquare,
  Square,
  Link2,
  Archive,
  ArchiveRestore,
  Loader2,
  Search,
  X,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { DismissButton } from "@/components/ui/dismiss-button"
import { MEETING_TYPE_LABELS, type MeetingRow } from "@/lib/meetings/types"

export type ClientOption = { id: string; name: string }

type Props = {
  meeting: MeetingRow
  showClientLink?: boolean
  clientName?: string | null            // when showClientLink, render this label
  /** Pass when manual link/archive controls should be available. */
  clients?: ClientOption[]
}

const TYPE_BADGE_CLASS: Record<NonNullable<MeetingRow["meeting_type"]>, string> = {
  sales: "bg-blue-500/10 text-blue-500 ring-blue-500/20",
  kick_off: "bg-emerald-500/10 text-emerald-500 ring-emerald-500/20",
  evaluation: "bg-amber-500/10 text-amber-500 ring-amber-500/20",
  internal: "bg-muted text-muted-foreground ring-border",
  other: "bg-muted text-muted-foreground ring-border",
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 60) return "–"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MeetingCard({ meeting, showClientLink = true, clientName, clients }: Props) {
  // Collapsed by default - overview reads as a scannable list (title, date,
  // host, attendees). Click "Show details" to expand summary + action items.
  const [detailsOpen, setDetailsOpen] = useState(false)

  const typeKey = meeting.meeting_type ?? "other"
  const typeLabel = MEETING_TYPE_LABELS[typeKey]
  const typeClass = TYPE_BADGE_CLASS[typeKey]

  const externalAttendees = (meeting.attendees ?? []).filter((a) => a.is_external)
  const externalNames = externalAttendees
    .map((a) => a.name ?? a.email ?? a.email_domain)
    .filter((s): s is string => !!s)
  const actionItemsCount = meeting.action_items?.length ?? 0
  const hasDetails = !!meeting.summary || actionItemsCount > 0

  const showActions =
    !!clients &&
    (meeting.link_status === "unlinked" ||
      meeting.link_status === "suggested" ||
      meeting.link_status === "prospect" ||
      meeting.link_status === "archived")

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header: badges + title + meta */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset ${typeClass}`}
              >
                {typeLabel}
              </span>
              {meeting.link_status === "unlinked" && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset bg-red-500/10 text-red-500 ring-red-500/20">
                  Unlinked
                </span>
              )}
              {meeting.link_status === "suggested" && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset bg-amber-500/10 text-amber-500 ring-amber-500/20">
                  Suggested
                </span>
              )}
              {meeting.link_status === "archived" && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ring-1 ring-inset bg-muted text-muted-foreground ring-border">
                  Archived
                </span>
              )}
              {showClientLink && meeting.client_id && (
                <Link
                  href={`/clients/${meeting.client_id}`}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {clientName ?? "→ Client"}
                </Link>
              )}
            </div>
            <h3 className="text-sm font-medium leading-tight truncate">
              {meeting.title ?? "Untitled meeting"}
            </h3>
            {externalNames.length > 0 && (
              <p className="text-[12px] font-medium text-foreground/80 leading-tight flex items-center gap-1.5">
                <Users className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{externalNames.join(", ")}</span>
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              {formatDate(meeting.scheduled_at)} · {formatDuration(meeting.duration_sec)}
              {meeting.recorded_by_name && <> · Recorded by {meeting.recorded_by_name}</>}
            </p>
          </div>
          {meeting.share_url && (
            <a
              href={meeting.share_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/60 transition-colors"
            >
              <ExternalLink className="h-3 w-3 mr-1.5" />
              Fathom
            </a>
          )}
        </div>

        {/* Action bar - link / archive / unarchive */}
        {showActions && (
          <MeetingActions meeting={meeting} clients={clients!} />
        )}

        {/* Show / hide details - summary + action items */}
        {hasDetails && (
          <div>
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {detailsOpen ? "Hide details" : "Show details"}
              {actionItemsCount > 0 && !detailsOpen && (
                <span className="text-muted-foreground/60 font-normal ml-1">
                  · {actionItemsCount} action item{actionItemsCount === 1 ? "" : "s"}
                </span>
              )}
            </button>

            {detailsOpen && (
              <div className="mt-3 space-y-3">
                {meeting.summary && (
                  <div className="rounded-md bg-muted/40 p-3">
                    <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-foreground/90">
                      {meeting.summary}
                    </pre>
                  </div>
                )}

                {actionItemsCount > 0 && (
                  <ul className="space-y-1.5">
                    {meeting.action_items!.map((ai, i) => (
                      <li key={i} className="flex items-start gap-2 text-[12px]">
                        {ai.completed ? (
                          <CheckSquare className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-500" />
                        ) : (
                          <Square className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={ai.completed ? "line-through text-muted-foreground" : ""}>
                            {ai.description}
                          </p>
                          {ai.assignee?.name && (
                            <p className="text-[10.5px] text-muted-foreground">
                              → {ai.assignee.name}
                            </p>
                          )}
                        </div>
                        {ai.recording_playback_url && (
                          <a
                            href={ai.recording_playback_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10.5px] text-muted-foreground hover:text-foreground shrink-0"
                          >
                            ↗
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// --- Action bar (link / archive) ------------------------------------------

function MeetingActions({
  meeting,
  clients,
}: {
  meeting: MeetingRow
  clients: ClientOption[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const isArchived = meeting.link_status === "archived"

  function patch(body: Record<string, unknown>) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/meetings/${meeting.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? "Failed")
        // Refresh both the per-client meetings query and the global page.
        queryClient.invalidateQueries({ queryKey: ["meetings"] })
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed")
      }
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!isArchived && (
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-7 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            <Link2 className="h-3 w-3" />
            Link to client
          </button>
        )}
        {!isArchived ? (
          <button
            type="button"
            onClick={() => patch({ link_status: "archived" })}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-7 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Archive className="h-3 w-3" />}
            Archive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => patch({ link_status: "unlinked" })}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-7 rounded-md border border-input bg-background px-2.5 text-[11px] font-medium hover:bg-muted/60 transition-colors disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArchiveRestore className="h-3 w-3" />}
            Unarchive
          </button>
        )}
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>

      {picking && (
        <ClientPicker
          clients={clients}
          onSelect={(clientId) => {
            setPicking(false)
            patch({ client_id: clientId })
          }}
          onCancel={() => setPicking(false)}
        />
      )}
    </div>
  )
}

function ClientPicker({
  clients,
  onSelect,
  onCancel,
}: {
  clients: ClientOption[]
  onSelect: (id: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients.slice(0, 50)
    return clients
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 50)
  }, [clients, query])

  return (
    <div className="rounded-md border border-input bg-card p-2 space-y-1">
      <div className="flex items-center gap-1.5 px-1.5">
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel()
            if (e.key === "Enter" && filtered[0]) onSelect(filtered[0].id)
          }}
          placeholder="Search client by name…"
          className="flex-1 h-7 text-xs bg-transparent outline-none"
        />
        <DismissButton size="xs" onClick={onCancel} label="Cancel" stopPropagation={false} />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-[11px] text-muted-foreground px-2 py-1.5">No matching clients.</p>
        ) : (
          filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-muted/60 transition-colors"
            >
              {c.name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
