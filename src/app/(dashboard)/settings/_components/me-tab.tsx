"use client"

import { MyAccount } from "../../account/_components/my-account"
import type { UserPlatformConnection } from "@/lib/inbox/user-platform-tokens"

export type GoogleCalendarConnection = {
  /** The Google account email currently providing calendar tokens.
   *  null when no calendar has been connected at all (rare since
   *  sign-in seeds it). */
  connectedEmail: string | null
  /** True when the connected calendar is the same Google account the
   *  user signed in with. False = they explicitly connected a different
   *  account in the GoogleCalendarCard. Drives the "(your sign-in
   *  account)" hint vs an explicit account label. */
  isSignInAccount: boolean
  /** Query-param error code from the OAuth callback (e.g. "access_denied"). */
  error: string | null
  /** Query-param success email from the OAuth callback — render an
   *  inline "Connected as X" toast. */
  justConnected: string | null
}

export type MeTabData = {
  userId: string
  userName: string
  userEmail: string
  avatarUrl: string | null
  slack: UserPlatformConnection | null
  trengo: UserPlatformConnection | null
  monday: UserPlatformConnection | null
  trengoChannelIds: number[]
  slackError: string | null
  googleCalendar: GoogleCalendarConnection
}

export function MeTab({ data }: { data: MeTabData }) {
  return (
    <MyAccount
      userId={data.userId}
      userName={data.userName}
      userEmail={data.userEmail}
      avatarUrl={data.avatarUrl}
      slack={data.slack}
      trengo={data.trengo}
      monday={data.monday}
      trengoChannelIds={data.trengoChannelIds}
      slackError={data.slackError}
      googleCalendar={data.googleCalendar}
    />
  )
}
