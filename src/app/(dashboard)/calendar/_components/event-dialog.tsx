"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { format, parseISO } from "date-fns"
import {
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import { cn } from "@/lib/utils"
import { t } from "@/lib/i18n/t"
import { useLocale } from "@/lib/i18n/client"
import type { Locale } from "@/lib/i18n/types"
import type {
  CalendarAttendee,
  CalendarEvent,
  EventCreate,
  EventPatch,
} from "@/lib/integrations/google-calendar"

/**
 * Hub-native event details + editor. Replaces the Google Calendar
 * popup an AM would otherwise bounce out to. Two modes:
 *
 *   create — empty form, POST /api/calendar/events on save
 *   view   — fetch the full event; "Edit" flips into edit form, PATCH
 *            on save; "Delete" removes with confirm
 *
 * On success the calendar-events query is invalidated so the week grid
 * updates immediately without a manual refresh.
 */

export type EventDialogMode =
  | { kind: "create"; initialStart?: Date }
  | { kind: "view"; eventId: string; calendarId: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: EventDialogMode
}

export function EventDialog({ open, onOpenChange, mode }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md md:max-w-lg"
        showCloseButton={false}
      >
        {mode.kind === "view" ? (
          <ViewMode
            eventId={mode.eventId}
            calendarId={mode.calendarId}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <CreateMode
            initialStart={mode.initialStart}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────
// View mode (fetch + display + flip to edit)
// ─────────────────────────────────────────────────────────────────────

function ViewMode({
  eventId,
  calendarId,
  onClose,
}: {
  eventId: string
  calendarId: string
  onClose: () => void
}) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const detailQuery = useQuery<{ event: CalendarEvent }>({
    queryKey: ["calendar-event", calendarId, eventId],
    queryFn: async () => {
      const url = new URL(
        `/api/calendar/events/${encodeURIComponent(eventId)}`,
        window.location.origin,
      )
      url.searchParams.set("calendarId", calendarId)
      const res = await fetch(url, { credentials: "include" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? t("calendar.event.load_failed", locale))
      }
      return res.json()
    },
  })

  const deleteMut = useMutation({
    mutationFn: async () => {
      const url = new URL(
        `/api/calendar/events/${encodeURIComponent(eventId)}`,
        window.location.origin,
      )
      url.searchParams.set("calendarId", calendarId)
      const res = await fetch(url, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? t("calendar.event.delete_failed", locale))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      onClose()
    },
  })

  if (detailQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (detailQuery.error || !detailQuery.data) {
    return (
      <div className="space-y-3">
        <DialogTitle>{t("calendar.event.couldnt_load", locale)}</DialogTitle>
        <p className="text-sm text-muted-foreground">
          {(detailQuery.error as Error)?.message ?? t("calendar.event.unknown_error", locale)}
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("common.close", locale)}
          </Button>
        </div>
      </div>
    )
  }

  const event = detailQuery.data.event

  if (editing) {
    return (
      <EditForm
        event={event}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          queryClient.invalidateQueries({ queryKey: ["calendar-event", eventId] })
          queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="size-2.5 rounded-sm bg-[#8967F3] mt-2 shrink-0" />
        <div className="flex-1 min-w-0">
          <DialogTitle className="text-base leading-tight">
            {event.title}
          </DialogTitle>
          <div className="mt-1 text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <CalendarDays className="size-3.5" />
            <span className="tabular-nums">{formatRange(event, locale)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.edit", locale)}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.delete", locale)}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("common.close", locale)}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {event.hangoutLink && (
        <a
          href={event.hangoutLink}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
        >
          <Video className="size-4 text-[#1a73e8]" />
          <span className="flex-1 min-w-0 truncate">
            <span className="font-medium">{t("calendar.event.join_meet", locale)}</span>
            <span className="ml-2 text-xs text-muted-foreground truncate">
              {event.hangoutLink.replace(/^https?:\/\//, "")}
            </span>
          </span>
          <ExternalLink className="size-3.5 text-muted-foreground" />
        </a>
      )}

      {event.location && (
        <Row icon={<MapPin className="size-4" />}>{event.location}</Row>
      )}

      {event.description && (
        <Row icon={null}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {event.description}
          </p>
        </Row>
      )}

      {event.attendees && event.attendees.length > 0 && (
        <Row icon={<Users className="size-4" />}>
          <ul className="space-y-1">
            {event.attendees.map((a) => (
              <AttendeeRow key={a.email} attendee={a} />
            ))}
          </ul>
        </Row>
      )}

      {event.htmlLink && (
        <div className="pt-2 border-t border-border">
          <a
            href={event.htmlLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t("calendar.event.open_in_gcal", locale)}
            <ExternalLink className="size-3" />
          </a>
        </div>
      )}

      {confirmingDelete && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-foreground">{t("calendar.event.delete_confirm_title", locale)}</p>
          <p className="mt-1 text-muted-foreground">
            {t("calendar.event.delete_confirm_body", locale)}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleteMut.isPending}
            >
              {t("common.cancel", locale)}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              {t("common.delete", locale)}
            </Button>
          </div>
          {deleteMut.error && (
            <p className="mt-2 text-xs text-destructive">
              {(deleteMut.error as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row({
  icon,
  children,
}: {
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="text-muted-foreground mt-0.5 w-4 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function AttendeeRow({ attendee }: { attendee: CalendarAttendee }) {
  const locale = useLocale()
  const initial = (attendee.displayName ?? attendee.email)[0]?.toUpperCase()
  return (
    <li className="flex items-center gap-2">
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground">
        {initial}
      </span>
      <span className="flex-1 min-w-0 truncate">
        {attendee.displayName ?? attendee.email}
        {attendee.organizer && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {t("calendar.event.attendee.organizer", locale)}
          </span>
        )}
        {attendee.self && (
          <span className="ml-1.5 text-xs text-muted-foreground">{t("calendar.event.attendee.you", locale)}</span>
        )}
      </span>
      <ResponsePill status={attendee.responseStatus} />
    </li>
  )
}

function ResponsePill({
  status,
}: {
  status: CalendarAttendee["responseStatus"]
}) {
  const locale = useLocale()
  const map = {
    accepted: { label: t("calendar.event.response.yes", locale), className: "bg-emerald-500/15 text-emerald-700" },
    declined: { label: t("calendar.event.response.no", locale), className: "bg-red-500/15 text-red-700" },
    tentative: { label: t("calendar.event.response.maybe", locale), className: "bg-amber-500/15 text-amber-700" },
    needsAction: { label: t("calendar.event.response.awaiting", locale), className: "bg-muted text-muted-foreground" },
  } as const
  const m = map[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
        m.className,
      )}
    >
      {m.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Edit & Create form (shared shape, different submit handler)
// ─────────────────────────────────────────────────────────────────────

type FormState = {
  title: string
  description: string
  location: string
  startDate: string // YYYY-MM-DD
  startTime: string // HH:mm
  endDate: string
  endTime: string
  allDay: boolean
  attendees: string[]
  addMeetLink: boolean
}

function emptyForm(initialStart?: Date): FormState {
  const start = initialStart ?? roundUpToNextHour(new Date())
  const end = new Date(start.getTime() + 60 * 60 * 1000)
  return {
    title: "",
    description: "",
    location: "",
    startDate: format(start, "yyyy-MM-dd"),
    startTime: format(start, "HH:mm"),
    endDate: format(end, "yyyy-MM-dd"),
    endTime: format(end, "HH:mm"),
    allDay: false,
    attendees: [],
    addMeetLink: false,
  }
}

function eventToForm(event: CalendarEvent): FormState {
  const start = event.allDay
    ? new Date(event.start)
    : parseISO(event.start)
  const end = event.allDay ? new Date(event.end) : parseISO(event.end)
  return {
    title: event.title === "(no title)" ? "" : event.title,
    description: event.description ?? "",
    location: event.location ?? "",
    startDate: format(start, "yyyy-MM-dd"),
    startTime: format(start, "HH:mm"),
    endDate: format(end, "yyyy-MM-dd"),
    endTime: format(end, "HH:mm"),
    allDay: event.allDay,
    attendees: (event.attendees ?? []).map((a) => a.email),
    addMeetLink: false,
  }
}

function formToCreate(state: FormState): EventCreate {
  const startIso = combineDateTime(state.startDate, state.startTime, state.allDay)
  const endIso = combineDateTime(state.endDate, state.endTime, state.allDay)
  return {
    title: state.title.trim(),
    description: state.description.trim() || null,
    location: state.location.trim() || null,
    start: startIso,
    end: endIso,
    allDay: state.allDay,
    attendees: state.attendees.map((email) => ({ email })),
    addMeetLink: state.addMeetLink,
  }
}

function formToPatch(state: FormState): EventPatch {
  return {
    title: state.title.trim(),
    description: state.description.trim() || null,
    location: state.location.trim() || null,
    start: combineDateTime(state.startDate, state.startTime, state.allDay),
    end: combineDateTime(state.endDate, state.endTime, state.allDay),
    allDay: state.allDay,
    attendees: state.attendees.map((email) => ({ email })),
  }
}

function EditForm({
  event,
  onCancel,
  onSaved,
}: {
  event: CalendarEvent
  onCancel: () => void
  onSaved: () => void
}) {
  const locale = useLocale()
  const [state, setState] = useState<FormState>(() => eventToForm(event))
  const saveMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPatch(state)),
        },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? t("calendar.event.save_failed", locale))
      }
    },
    onSuccess: onSaved,
  })

  return (
    <FormBody
      title={t("calendar.event.edit_title", locale)}
      state={state}
      setState={setState}
      onCancel={onCancel}
      onSubmit={() => saveMut.mutate()}
      submitting={saveMut.isPending}
      error={saveMut.error ? (saveMut.error as Error).message : null}
      submitLabel={t("calendar.event.save_changes", locale)}
      showMeetToggle={false}
    />
  )
}

function CreateMode({
  initialStart,
  onClose,
}: {
  initialStart?: Date
  onClose: () => void
}) {
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [state, setState] = useState<FormState>(() => emptyForm(initialStart))
  const createMut = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToCreate(state)),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? t("calendar.event.create_failed", locale))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] })
      onClose()
    },
  })

  return (
    <FormBody
      title={t("calendar.event.new_title", locale)}
      state={state}
      setState={setState}
      onCancel={onClose}
      onSubmit={() => createMut.mutate()}
      submitting={createMut.isPending}
      error={createMut.error ? (createMut.error as Error).message : null}
      submitLabel={t("calendar.event.create", locale)}
      showMeetToggle
    />
  )
}

function FormBody({
  title,
  state,
  setState,
  onCancel,
  onSubmit,
  submitting,
  error,
  submitLabel,
  showMeetToggle,
}: {
  title: string
  state: FormState
  setState: (next: FormState | ((s: FormState) => FormState)) => void
  onCancel: () => void
  onSubmit: () => void
  submitting: boolean
  error: string | null
  submitLabel: string
  showMeetToggle: boolean
}) {
  const locale = useLocale()
  const [attendeeInput, setAttendeeInput] = useState("")

  const addAttendee = () => {
    const email = attendeeInput.trim().toLowerCase()
    if (!email || !email.includes("@")) return
    if (state.attendees.includes(email)) {
      setAttendeeInput("")
      return
    }
    setState((s) => ({ ...s, attendees: [...s.attendees, email] }))
    setAttendeeInput("")
  }
  const removeAttendee = (email: string) =>
    setState((s) => ({ ...s, attendees: s.attendees.filter((e) => e !== email) }))

  const canSubmit = state.title.trim().length > 0 && !submitting

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) onSubmit()
      }}
      className="space-y-4"
    >
      <DialogTitle>{title}</DialogTitle>

      <div className="space-y-1.5">
        <Label htmlFor="evt-title">{t("calendar.event.field.title", locale)}</Label>
        <Input
          id="evt-title"
          value={state.title}
          onChange={(e) => setState((s) => ({ ...s, title: e.target.value }))}
          placeholder={t("calendar.event.field.title_placeholder", locale)}
          autoFocus
        />
      </div>

      <div className="grid grid-cols-[auto_1fr_auto_1fr] gap-2 items-end">
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">{t("calendar.event.field.start", locale)}</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={state.startDate}
              onChange={(e) =>
                setState((s) => ({ ...s, startDate: e.target.value }))
              }
            />
            {!state.allDay && (
              <Input
                type="time"
                value={state.startTime}
                onChange={(e) =>
                  setState((s) => ({ ...s, startTime: e.target.value }))
                }
              />
            )}
          </div>
        </div>
        <div className="space-y-1.5 col-span-2">
          <Label className="text-xs">{t("calendar.event.field.end", locale)}</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={state.endDate}
              onChange={(e) =>
                setState((s) => ({ ...s, endDate: e.target.value }))
              }
            />
            {!state.allDay && (
              <Input
                type="time"
                value={state.endTime}
                onChange={(e) =>
                  setState((s) => ({ ...s, endTime: e.target.value }))
                }
              />
            )}
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
        <input
          type="checkbox"
          checked={state.allDay}
          onChange={(e) =>
            setState((s) => ({ ...s, allDay: e.target.checked }))
          }
          className="size-3.5 rounded border-border accent-[#8967F3]"
        />
        {t("calendar.event.field.all_day", locale)}
      </label>

      <div className="space-y-1.5">
        <Label htmlFor="evt-location" className="flex items-center gap-1.5">
          <MapPin className="size-3.5" /> {t("calendar.event.field.location", locale)}
        </Label>
        <Input
          id="evt-location"
          value={state.location}
          onChange={(e) =>
            setState((s) => ({ ...s, location: e.target.value }))
          }
          placeholder={t("calendar.event.field.location_placeholder", locale)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1.5">
          <Users className="size-3.5" /> {t("calendar.event.field.guests", locale)}
        </Label>
        <div className="flex gap-2">
          <Input
            type="email"
            value={attendeeInput}
            onChange={(e) => setAttendeeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault()
                addAttendee()
              }
            }}
            placeholder={t("calendar.event.field.email_placeholder", locale)}
          />
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={addAttendee}
            disabled={!attendeeInput.includes("@")}
          >
            <Plus className="size-4" />
            {t("common.add", locale)}
          </Button>
        </div>
        {state.attendees.length > 0 && (
          <ul className="flex flex-wrap gap-1.5 pt-1">
            {state.attendees.map((email) => (
              <li
                key={email}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                <span>{email}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeAttendee(email)}
                  aria-label={t("calendar.event.remove_attendee", locale, { email })}
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="evt-desc" className="flex items-center gap-1.5">
          <Clock className="size-3.5" /> {t("calendar.event.field.description", locale)}
        </Label>
        <AutoTextarea
          id="evt-desc"
          minRows={3}
          maxRows={10}
          value={state.description}
          onChange={(e) =>
            setState((s) => ({ ...s, description: e.target.value }))
          }
          placeholder={t("calendar.event.field.description_placeholder", locale)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      {showMeetToggle && (
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={state.addMeetLink}
            onChange={(e) =>
              setState((s) => ({ ...s, addMeetLink: e.target.checked }))
            }
            className="size-3.5 rounded border-border accent-[#8967F3]"
          />
          <Video className="size-4 text-[#1a73e8]" />
          {t("calendar.event.add_meet", locale)}
        </label>
      )}

      {error && (
        <p className="text-sm text-destructive break-words">{error}</p>
      )}

      <div className="-mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-muted/30 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={submitting}
        >
          {t("common.cancel", locale)}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={!canSubmit}
        >
          {submitting && <Loader2 className="size-3.5 animate-spin" />}
          {!submitting && <Check className="size-3.5" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function formatRange(event: CalendarEvent, locale: Locale): string {
  if (event.allDay) {
    const start = new Date(event.start)
    return format(start, "EEEE, d MMM yyyy") + " · " + t("calendar.event.all_day_suffix", locale)
  }
  const start = parseISO(event.start)
  const end = parseISO(event.end)
  const sameDay =
    format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd")
  if (sameDay) {
    return `${format(start, "EEEE, d MMM")} · ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`
  }
  return `${format(start, "d MMM HH:mm")} – ${format(end, "d MMM HH:mm")}`
}

function combineDateTime(date: string, time: string, allDay: boolean): string {
  if (allDay) return date
  // Construct as a local-timezone ISO string. new Date(`${date}T${time}`)
  // parses as local time when there's no offset, which is what we want
  // for "user picked 09:00 on Friday".
  return new Date(`${date}T${time}:00`).toISOString()
}

function roundUpToNextHour(d: Date): Date {
  const out = new Date(d)
  out.setMinutes(0, 0, 0)
  if (d.getMinutes() > 0 || d.getSeconds() > 0) {
    out.setHours(out.getHours() + 1)
  }
  return out
}
