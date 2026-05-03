/**
 * Lightweight meeting shape used by the UI (per-client tab + global page).
 * Always select these exact columns from the `meetings` table when feeding
 * a row into <MeetingCard>; keeps the type and the queries in sync.
 */
export type MeetingRow = {
  id: string
  fathom_recording_id: string
  client_id: string | null
  title: string | null
  scheduled_at: string | null
  duration_sec: number | null
  share_url: string | null
  recording_url: string | null
  recorded_by_name: string | null
  recorded_by_email: string | null
  recorded_by_team: string | null
  meeting_type: "sales" | "kick_off" | "evaluation" | "internal" | "other" | null
  link_status: "linked" | "suggested" | "unlinked" | "internal" | "prospect"
  summary: string | null
  action_items: Array<{
    description: string
    completed: boolean
    user_generated: boolean
    assignee?: { name: string | null; email: string | null; team: string | null } | null
    recording_playback_url?: string | null
  }> | null
  attendees: Array<{
    name: string | null
    email: string | null
    email_domain: string | null
    is_external: boolean
  }> | null
  created_at: string
}

export const MEETING_ROW_COLUMNS =
  "id, fathom_recording_id, client_id, title, scheduled_at, duration_sec, share_url, recording_url, recorded_by_name, recorded_by_email, recorded_by_team, meeting_type, link_status, summary, action_items, attendees, created_at" as const

export const MEETING_TYPE_LABELS: Record<NonNullable<MeetingRow["meeting_type"]>, string> = {
  sales: "Sales",
  kick_off: "Kick-off",
  evaluation: "Evaluation",
  internal: "Internal",
  other: "Other",
}
