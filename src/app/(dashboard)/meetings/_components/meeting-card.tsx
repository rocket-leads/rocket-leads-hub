"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronRight, ExternalLink, Users, CheckSquare, Square } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { MEETING_TYPE_LABELS, type MeetingRow } from "@/lib/meetings/types"

type Props = {
  meeting: MeetingRow
  showClientLink?: boolean
  clientName?: string | null            // when showClientLink, render this label
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
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MeetingCard({ meeting, showClientLink = true, clientName }: Props) {
  const [actionsOpen, setActionsOpen] = useState(false)

  const typeKey = meeting.meeting_type ?? "other"
  const typeLabel = MEETING_TYPE_LABELS[typeKey]
  const typeClass = TYPE_BADGE_CLASS[typeKey]

  const externalAttendees = (meeting.attendees ?? []).filter((a) => a.is_external)
  const actionItemsCount = meeting.action_items?.length ?? 0

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Header: type badge, title, date */}
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

        {/* Attendees */}
        {externalAttendees.length > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {externalAttendees
                .map((a) => a.name ?? a.email ?? a.email_domain)
                .filter(Boolean)
                .join(", ")}
            </span>
          </div>
        )}

        {/* Summary (Fathom AI summary) */}
        {meeting.summary && (
          <div className="rounded-md bg-muted/40 p-3">
            <pre className="whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-foreground/90">
              {meeting.summary}
            </pre>
          </div>
        )}

        {/* Action items — collapsed by default */}
        {actionItemsCount > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setActionsOpen((o) => !o)}
              className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {actionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {actionItemsCount} action item{actionItemsCount === 1 ? "" : "s"}
            </button>
            {actionsOpen && (
              <ul className="mt-2 space-y-1.5">
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
      </CardContent>
    </Card>
  )
}
