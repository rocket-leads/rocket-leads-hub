import { redirect } from "next/navigation"

// /account merged into /settings on 2026-05-21. Slack OAuth callbacks still
// land here briefly with ?slack_error=... - forward those through so the Me
// tab can surface the error inline.
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ slack_error?: string; slack?: string }>
}) {
  const params = await searchParams
  const qs = new URLSearchParams({ tab: "me" })
  if (params.slack_error) qs.set("slack_error", params.slack_error)
  if (params.slack) qs.set("slack", params.slack)
  redirect(`/settings?${qs.toString()}`)
}
