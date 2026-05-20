import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { listUserPlatformConnections } from "@/lib/inbox/user-platform-tokens"
import {
  getUserTrengoChannelIds,
  getUserPrimaryChannels,
} from "@/lib/inbox/user-prefs"
import { MyAccount } from "./_components/my-account"
import { PageHeader } from "@/components/ui/page-header"

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ slack_error?: string; slack?: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")

  const [connections, trengoChannelIds, primaryChannels, params] = await Promise.all([
    listUserPlatformConnections(session.user.id),
    getUserTrengoChannelIds(session.user.id),
    getUserPrimaryChannels(session.user.id),
    searchParams,
  ])

  // Map by platform for quick lookup in the UI.
  const connectionMap = Object.fromEntries(connections.map((c) => [c.platform, c]))

  return (
    <div>
      <PageHeader
        title="My Account"
        subtitle="Connect your personal Slack, Trengo and Monday accounts so replies sent through the Hub appear from you, not from a system bot."
      />

      <MyAccount
        userName={session.user.name ?? session.user.email}
        userEmail={session.user.email}
        slack={connectionMap.slack ?? null}
        trengo={connectionMap.trengo ?? null}
        monday={connectionMap.monday ?? null}
        trengoChannelIds={trengoChannelIds}
        primaryEmailChannelId={primaryChannels.primaryEmailChannelId}
        primaryWaChannelId={primaryChannels.primaryWaChannelId}
        slackError={params.slack_error ?? null}
      />
    </div>
  )
}
