"use client"

import { useState } from "react"
import { KeyRound, Database, Users, Bell } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { NotificationsTab } from "./notifications-tab"

type SettingsTabId = "tokens" | "board" | "users" | "notifications"

const TABS: TopTab<SettingsTabId>[] = [
  { id: "tokens", label: "API Tokens", icon: KeyRound },
  { id: "board", label: "Board Config", icon: Database },
  { id: "users", label: "Users", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
]

type Props = {
  tokenStatuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  boardConfig: React.ComponentProps<typeof BoardConfigTab>["config"]
  defaultBoardConfig: React.ComponentProps<typeof BoardConfigTab>["defaults"]
  users: React.ComponentProps<typeof UsersTab>["users"]
  currentUserId: string
  mondayPeople: string[]
  notifications: {
    slackConnected: boolean
    recipients: React.ComponentProps<typeof NotificationsTab>["recipients"]
    teamChannelId: string | null
    salesChannelId: string | null
    closers: React.ComponentProps<typeof NotificationsTab>["closers"]
  }
}

export function SettingsTabs({
  tokenStatuses,
  boardConfig,
  defaultBoardConfig,
  users,
  currentUserId,
  mondayPeople,
  notifications,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("tokens")

  return (
    <div className="mt-6 space-y-6">
      <TopTabs<SettingsTabId> tabs={TABS} value={activeTab} onChange={setActiveTab} />

      {activeTab === "tokens" && <ApiTokensTab statuses={tokenStatuses} />}
      {activeTab === "board" && <BoardConfigTab config={boardConfig} defaults={defaultBoardConfig} />}
      {activeTab === "users" && (
        <UsersTab users={users} currentUserId={currentUserId} mondayPeople={mondayPeople} />
      )}
      {activeTab === "notifications" && (
        <NotificationsTab
          slackConnected={notifications.slackConnected}
          recipients={notifications.recipients}
          teamChannelId={notifications.teamChannelId}
          salesChannelId={notifications.salesChannelId}
          closers={notifications.closers}
        />
      )}
    </div>
  )
}
