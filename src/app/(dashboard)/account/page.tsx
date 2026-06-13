import { redirect } from "next/navigation"

// /account merged into /settings on 2026-05-21. Slack and Google Calendar
// OAuth callbacks still land here briefly with ?slack_error=... or
// ?google_calendar_error=... — forward those through so the Me tab can
// surface the error inline.
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    slack_error?: string
    slack?: string
    google_calendar_error?: string
    google_calendar_connected?: string
  }>
}) {
  const params = await searchParams
  const qs = new URLSearchParams({ tab: "me" })
  if (params.slack_error) qs.set("slack_error", params.slack_error)
  if (params.slack) qs.set("slack", params.slack)
  if (params.google_calendar_error)
    qs.set("google_calendar_error", params.google_calendar_error)
  if (params.google_calendar_connected)
    qs.set("google_calendar_connected", params.google_calendar_connected)
  redirect(`/settings?${qs.toString()}`)
}
