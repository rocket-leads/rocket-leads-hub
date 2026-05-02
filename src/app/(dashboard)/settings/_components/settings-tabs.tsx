"use client"

import { useState } from "react"
import { KeyRound, Database, Users, Bell, Building2, Inbox as InboxIcon } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { NotificationsTab } from "./notifications-tab"
import { ClientsTab } from "./clients-tab"
import { InboxAutomationTab } from "./inbox-tab"
import type { MondayClient } from "@/lib/integrations/monday"
import type { InboxAutomationRules } from "../types"

type SettingsTabId = "clients" | "tokens" | "board" | "users" | "notifications" | "inbox"

const TABS: TopTab<SettingsTabId>[] = [
  { id: "clients", label: "Clients", icon: Building2 },
  { id: "tokens", label: "API Tokens", icon: KeyRound },
  { id: "board", label: "Board Config", icon: Database },
  { id: "users", label: "Users", icon: Users },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "inbox", label: "Inbox", icon: InboxIcon },
]

type Props = {
  tokenStatuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  boardConfig: React.ComponentProps<typeof BoardConfigTab>["config"]
  defaultBoardConfig: React.ComponentProps<typeof BoardConfigTab>["defaults"]
  users: React.ComponentProps<typeof UsersTab>["users"]
  currentUserId: string
  mondayPeople: string[]
  clients: MondayClient[]
  inboxAutomationRules: InboxAutomationRules
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
  clients,
  inboxAutomationRules,
  notifications,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("clients")

  return (
    <div className="mt-6 space-y-6">
      <TopTabs<SettingsTabId> tabs={TABS} value={activeTab} onChange={setActiveTab} />

      {activeTab === "clients" && <ClientsTab clients={clients} />}
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
      {activeTab === "inbox" && <InboxAutomationTab rules={inboxAutomationRules} />}
    </div>
  )
}
