"use client"

import { MyAccount } from "../../account/_components/my-account"
import type { UserPlatformConnection } from "@/lib/inbox/user-platform-tokens"

export type MeTabData = {
  userName: string
  userEmail: string
  slack: UserPlatformConnection | null
  trengo: UserPlatformConnection | null
  monday: UserPlatformConnection | null
  trengoChannelIds: number[]
  slackError: string | null
}

export function MeTab({ data }: { data: MeTabData }) {
  return (
    <MyAccount
      userName={data.userName}
      userEmail={data.userEmail}
      slack={data.slack}
      trengo={data.trengo}
      monday={data.monday}
      trengoChannelIds={data.trengoChannelIds}
      slackError={data.slackError}
    />
  )
}
