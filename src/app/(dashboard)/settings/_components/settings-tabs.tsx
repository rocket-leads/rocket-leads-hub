"use client"

import { useState, useMemo } from "react"
import { KeyRound, Database, Users, Bell, Building2, Inbox as InboxIcon, Sparkles } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { NotificationsTab } from "./notifications-tab"
import { ClientsTab } from "./clients-tab"
import { InboxAutomationTab } from "./inbox-tab"
import { PedroSettingsTab } from "./pedro-tab"
import type { MondayClient } from "@/lib/integrations/monday"
import type { InboxAutomationRules } from "../types"

type SettingsTabId = "clients" | "tokens" | "board" | "users" | "notifications" | "inbox" | "pedro"

type Props = {
  tokenStatuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  boardConfig: React.ComponentProps<typeof BoardConfigTab>["config"]
  defaultBoardConfig: React.ComponentProps<typeof BoardConfigTab>["defaults"]
  users: React.ComponentProps<typeof UsersTab>["users"]
  currentUserId: string
  mondayPeople: string[]
  fathomTeamMembers: React.ComponentProps<typeof UsersTab>["fathomTeamMembers"]
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
  fathomTeamMembers,
  clients,
  inboxAutomationRules,
  notifications,
}: Props) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("clients")
  const locale = useLocale()

  // Tabs are rebuilt per render so labels flip with the locale toggle. The
  // icon + id pair stay the same; just the label is dictionary-driven.
  const tabs: TopTab<SettingsTabId>[] = useMemo(
    () => [
      { id: "clients", label: t("settings.tab.clients", locale), icon: Building2 },
      { id: "tokens", label: t("settings.tab.tokens", locale), icon: KeyRound },
      { id: "board", label: t("settings.tab.board", locale), icon: Database },
      { id: "users", label: t("settings.tab.users", locale), icon: Users },
      { id: "notifications", label: t("settings.tab.notifications", locale), icon: Bell },
      { id: "inbox", label: t("settings.tab.inbox", locale), icon: InboxIcon },
      { id: "pedro", label: t("settings.tab.pedro", locale), icon: Sparkles },
    ],
    [locale],
  )

  return (
    <div className="mt-6 space-y-6">
      <TopTabs<SettingsTabId> tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === "clients" && <ClientsTab clients={clients} />}
      {activeTab === "tokens" && <ApiTokensTab statuses={tokenStatuses} />}
      {activeTab === "board" && <BoardConfigTab config={boardConfig} defaults={defaultBoardConfig} />}
      {activeTab === "users" && (
        <UsersTab
          users={users}
          currentUserId={currentUserId}
          mondayPeople={mondayPeople}
          fathomTeamMembers={fathomTeamMembers}
        />
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
      {activeTab === "pedro" && <PedroSettingsTab />}
    </div>
  )
}
