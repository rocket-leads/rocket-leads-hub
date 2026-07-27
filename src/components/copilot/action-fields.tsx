"use client"

import { useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { AutoTextarea } from "@/components/ui/auto-textarea"
import type { CopilotAction } from "@/lib/copilot/tools"
import type { ClientSearchResult } from "@/app/api/clients/search/route"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"

export type UserRow = { id: string; name: string | null; email: string; role: string | null }

/**
 * Shared, per-action field editors for a Co-pilot draft. Both the inline
 * ready-state in the command bar and the (legacy) ConfirmDialog render these
 * so there's one source of truth for what's editable before approval.
 *
 * Roy 2026-07-27: lifted out of confirm-dialog.tsx so the ⌘K → Co-pilot flow
 * can edit variables (client, assignee, due date, …) right inside the command
 * palette instead of a separate dialog.
 */
export function ActionFields({
  action,
  onChange,
  users,
  clients,
}: {
  action: CopilotAction
  onChange: (a: CopilotAction) => void
  users: UserRow[]
  clients: ClientSearchResult[]
}) {
  const locale = useLocale()
  switch (action.type) {
    case "create_task":
      return <CreateTaskFields draft={action} onChange={onChange} users={users} clients={clients} locale={locale} />
    case "create_reminder":
      return <CreateReminderFields draft={action} onChange={onChange} clients={clients} locale={locale} />
    case "trigger_pedro_refresh":
      return <PedroRefreshFields draft={action} onChange={onChange} clients={clients} locale={locale} />
    case "navigate_to_client":
      return <NavigateFields draft={action} onChange={onChange} clients={clients} locale={locale} />
    case "create_calendar_event":
      return <CreateCalendarEventFields draft={action} onChange={onChange} clients={clients} locale={locale} />
  }
}

/**
 * Fetches the assignee + client rosters the field editors need to render
 * their dropdowns. Cached for the session — both lists are cheap and change
 * rarely. Returns empty arrays until loaded so the editors never crash.
 */
export function useCopilotRosters() {
  const usersQ = useQuery<UserRow[]>({
    queryKey: ["copilot-roster-users"],
    queryFn: async () => {
      const res = await fetch("/api/inbox/users")
      if (!res.ok) throw new Error("Failed to load users")
      const json = (await res.json()) as { users: UserRow[] }
      return json.users ?? []
    },
    staleTime: 5 * 60_000,
  })
  const clientsQ = useQuery<ClientSearchResult[]>({
    queryKey: ["copilot-roster-clients"],
    queryFn: async () => {
      const res = await fetch("/api/clients/search")
      if (!res.ok) throw new Error("Failed to load clients")
      return (await res.json()) as ClientSearchResult[]
    },
    staleTime: 5 * 60_000,
  })
  return { users: usersQ.data ?? [], clients: clientsQ.data ?? [] }
}

// ─── Per-action field editors ─────────────────────────────────────────────

function CreateTaskFields({
  draft,
  onChange,
  users,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "create_task" }>
  onChange: (d: CopilotAction) => void
  users: UserRow[]
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })

  // Pre-fill due date with today if AI didn't pick one (matches existing
  // inbox composer behaviour - tasks require a due date).
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  useEffect(() => {
    if (!draft.dueDate) update({ dueDate: today })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.title", locale)}>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={t("copilot.field.body_optional", locale)}>
        <AutoTextarea
          value={draft.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
          minRows={3}
          maxRows={12}
          placeholder={t("copilot.field.body_placeholder_task", locale)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.client", locale)}>
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.client_none", locale)}</option>
            {clients.map((c) => (
              <option key={c.mondayItemId} value={c.mondayItemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("copilot.field.assignee", locale)}>
          <select
            value={draft.assigneeId}
            onChange={(e) => update({ assigneeId: e.target.value })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.assignee_none", locale)}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.due_date", locale)}>
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(e) => update({ dueDate: e.target.value || undefined })}
            className={fieldClass}
          />
        </Field>
        <Field label={t("copilot.field.priority", locale)}>
          <select
            value={draft.priority ?? "normal"}
            onChange={(e) => update({ priority: e.target.value as "low" | "normal" | "high" })}
            className={fieldClass}
          >
            <option value="low">{t("copilot.field.priority_low", locale)}</option>
            <option value="normal">{t("copilot.field.priority_normal", locale)}</option>
            <option value="high">{t("copilot.field.priority_high", locale)}</option>
          </select>
        </Field>
      </div>
    </div>
  )
}

function CreateReminderFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "create_reminder" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.kind", locale)}>
        <select
          value={draft.kind}
          onChange={(e) => update({ kind: e.target.value as "task" | "update" })}
          className={fieldClass}
        >
          <option value="task">{t("copilot.field.kind_task", locale)}</option>
          <option value="update">{t("copilot.field.kind_update", locale)}</option>
        </select>
      </Field>
      <Field label={t("copilot.field.title", locale)}>
        <input
          type="text"
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={t("copilot.field.body_optional", locale)}>
        <AutoTextarea
          value={draft.body ?? ""}
          onChange={(e) => update({ body: e.target.value })}
          minRows={2}
          maxRows={10}
          placeholder={t("copilot.field.body_placeholder_reminder", locale)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t("copilot.field.remind_on", locale)}>
          <input
            type="date"
            value={draft.remindAt}
            onChange={(e) => update({ remindAt: e.target.value })}
            className={fieldClass}
          />
        </Field>
        <Field label={t("copilot.field.client", locale)}>
          <select
            value={draft.clientId ?? ""}
            onChange={(e) => update({ clientId: e.target.value || undefined })}
            className={fieldClass}
          >
            <option value="">{t("copilot.field.client_none", locale)}</option>
            {clients.map((c) => (
              <option key={c.mondayItemId} value={c.mondayItemId}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  )
}

function PedroRefreshFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "trigger_pedro_refresh" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.client", locale)}>
        <select
          value={draft.clientId}
          onChange={(e) => update({ clientId: e.target.value })}
          className={fieldClass}
        >
          {clients.map((c) => (
            <option key={c.mondayItemId} value={c.mondayItemId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("copilot.field.lookback_days", locale)}>
        <input
          type="number"
          min={7}
          max={90}
          value={draft.days ?? 30}
          onChange={(e) => update({ days: Number(e.target.value) || 30 })}
          className={fieldClass}
        />
      </Field>
      <p className="text-xs text-muted-foreground">{t("copilot.pedro.eta_hint", locale)}</p>
    </div>
  )
}

/**
 * Calendar-event editor. Splits the action's single ISO `start` into two
 * inputs (date + time-of-day) so the user can tweak either independently,
 * then rebuilds the ISO string with the Europe/Amsterdam offset on every
 * change. Duration + Meet toggle + title are independent fields.
 *
 * Roy 2026-06-12: the invite goes to the client's Monday-mirrored email
 * (`MondayClient.email`) server-side via the executor, so we just surface
 * a hint here instead of asking the user to retype it.
 */
function CreateCalendarEventFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "create_calendar_event" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })

  // Derive date + time inputs from the action's ISO start. We treat the
  // value as Europe/Amsterdam wall-clock — the parser is instructed to
  // emit `…T…+02:00` (or +01:00 in winter), and the editor doesn't try
  // to be smarter than the parser about DST. If the user changes either
  // input, we rebuild the ISO with the same offset that was on the action.
  const parsed = useMemo(() => splitIsoToDateTime(draft.start), [draft.start])

  function rebuildStart(date: string, time: string): string {
    return `${date}T${time}:00${parsed.offset}`
  }

  // When a client is picked, the attendee name + email fields collapse
  // (the executor pulls the email from the client). When no client is
  // picked, attendee fields are the only way to address the invite, and
  // we warn if email is missing — the event would create without an
  // invitee otherwise.
  const hasClient = !!draft.clientId
  const missingEmail = !hasClient && !(draft.attendeeEmail ?? "").trim()

  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.title", locale)}>
        <input
          type="text"
          value={draft.title ?? ""}
          onChange={(e) => update({ title: e.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={t("copilot.field.client", locale)}>
        <select
          value={draft.clientId ?? ""}
          onChange={(e) => update({ clientId: e.target.value || undefined })}
          className={fieldClass}
        >
          <option value="">{t("copilot.field.client_none", locale)}</option>
          {clients.map((c) => (
            <option key={c.mondayItemId} value={c.mondayItemId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      {!hasClient && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("copilot.field.attendee_name", locale)}>
            <input
              type="text"
              value={draft.attendeeName ?? ""}
              onChange={(e) => update({ attendeeName: e.target.value || undefined })}
              placeholder={t("copilot.field.attendee_name_placeholder", locale)}
              className={fieldClass}
            />
          </Field>
          <Field label={t("copilot.field.attendee_email", locale)}>
            <input
              type="email"
              value={draft.attendeeEmail ?? ""}
              onChange={(e) => update({ attendeeEmail: e.target.value || undefined })}
              placeholder="naam@bedrijf.nl"
              className={fieldClass}
            />
          </Field>
        </div>
      )}
      <div className="grid grid-cols-[1fr_120px_120px] gap-2">
        <Field label={t("copilot.field.start_at", locale)}>
          <input
            type="date"
            value={parsed.date}
            onChange={(e) => update({ start: rebuildStart(e.target.value, parsed.time) })}
            className={fieldClass}
          />
        </Field>
        <Field label="&nbsp;">
          <input
            type="time"
            value={parsed.time}
            onChange={(e) => update({ start: rebuildStart(parsed.date, e.target.value) })}
            className={fieldClass}
          />
        </Field>
        <Field label={t("copilot.field.duration_min", locale)}>
          <input
            type="number"
            min={5}
            step={5}
            value={draft.durationMin ?? 30}
            onChange={(e) => update({ durationMin: Number(e.target.value) || 30 })}
            className={fieldClass}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.addMeetLink !== false}
          onChange={(e) => update({ addMeetLink: e.target.checked })}
        />
        <span>{t("copilot.field.add_meet_link", locale)}</span>
      </label>
      <p
        className={cn(
          "text-xs leading-snug",
          missingEmail ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
        )}
      >
        {hasClient
          ? t("copilot.calendar.invitee_hint", locale)
          : missingEmail
            ? t("copilot.calendar.invitee_missing", locale)
            : t("copilot.calendar.invitee_external", locale)}
      </p>
    </div>
  )
}

/** Split an ISO datetime like `2026-06-16T10:00:00+02:00` into the bits
 *  the <input type="date|time"> fields want, preserving the offset so we
 *  can reattach it on rebuild. Falls back to today/now/+01:00 for an
 *  unparseable input so the editor never renders empty. */
function splitIsoToDateTime(iso: string): { date: string; time: string; offset: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?([+-]\d{2}:\d{2}|Z)?$/.exec(iso)
  if (m) {
    return {
      date: m[1],
      time: m[2],
      offset: m[3] && m[3] !== "Z" ? m[3] : "+01:00",
    }
  }
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    time: "10:00",
    offset: "+01:00",
  }
}

function NavigateFields({
  draft,
  onChange,
  clients,
  locale,
}: {
  draft: Extract<CopilotAction, { type: "navigate_to_client" }>
  onChange: (d: CopilotAction) => void
  clients: ClientSearchResult[]
  locale: ReturnType<typeof useLocale>
}) {
  const update = (patch: Partial<typeof draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-col gap-2">
      <Field label={t("copilot.field.client", locale)}>
        <select
          value={draft.clientId}
          onChange={(e) => update({ clientId: e.target.value })}
          className={fieldClass}
        >
          {clients.map((c) => (
            <option key={c.mondayItemId} value={c.mondayItemId}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("copilot.field.tab", locale)}>
        <select
          value={draft.tab ?? "campaigns"}
          onChange={(e) =>
            update({ tab: e.target.value as "campaigns" | "billing" | "communication" | "settings" })
          }
          className={fieldClass}
        >
          <option value="campaigns">{t("copilot.field.tab.campaigns", locale)}</option>
          <option value="billing">{t("copilot.field.tab.billing", locale)}</option>
          <option value="communication">{t("copilot.field.tab.communication", locale)}</option>
          <option value="settings">{t("copilot.field.tab.settings", locale)}</option>
        </select>
      </Field>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

export const fieldClass = cn(
  "w-full rounded-lg border border-input bg-transparent px-3 py-1.5 text-sm outline-none transition-colors",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
)
