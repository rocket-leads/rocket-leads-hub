"use client"

import { useMemo } from "react"
import { KeyRound, Database, Users, Bell, Building2, Inbox as InboxIcon, Sparkles, UserCircle2, Activity } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { useUrlState } from "@/lib/use-url-state"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { NotificationsTab } from "./notifications-tab"
import { ClientsTab } from "./clients-tab"
import { InboxAutomationTab } from "./inbox-tab"
import { PedroSettingsTab } from "./pedro-tab"
import { MeTab, type MeTabData } from "./me-tab"
import { HealthTab } from "./health-tab"
import type { InboxAutomationRules } from "../types"

type SettingsTabId =
  | "me"
  | "clients"
  | "tokens"
  | "board"
  | "users"
  | "notifications"
  | "inbox"
  | "pedro"
  | "health"

type AdminProps = {
  isAdmin: true
  initialTab: SettingsTabId
  meTab: MeTabData
  tokenStatuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  boardConfig: React.ComponentProps<typeof BoardConfigTab>["config"]
  defaultBoardConfig: React.ComponentProps<typeof BoardConfigTab>["defaults"]
  users: React.ComponentProps<typeof UsersTab>["users"]
  currentUserId: string
  inboxAutomationRules: InboxAutomationRules
  notifications: {
    slackConnected: boolean
    recipients: React.ComponentProps<typeof NotificationsTab>["recipients"]
    teamChannelId: string | null
    salesChannelId: string | null
    closers: React.ComponentProps<typeof NotificationsTab>["closers"]
  }
}

type MeOnlyProps = {
  isAdmin: false
  initialTab: SettingsTabId
  meTab: MeTabData
}

type Props = AdminProps | MeOnlyProps

const ALL_TAB_IDS: SettingsTabId[] = [
  "me",
  "clients",
  "tokens",
  "board",
  "users",
  "notifications",
  "inbox",
  "pedro",
  "health",
]

export function SettingsTabs(props: Props) {
  const { isAdmin, initialTab, meTab } = props
  // useUrlState keeps the active tab in the URL so the back button + bookmarks
  // + "send me this view" links all work. The server already passed
  // `initialTab` in for the initial render - useUrlState then takes over for
  // any in-session tab changes.
  const [rawTab, setActiveTab] = useUrlState("tab", initialTab)
  const resolvedTab: SettingsTabId = ALL_TAB_IDS.includes(rawTab as SettingsTabId)
    ? (rawTab as SettingsTabId)
    : initialTab
  // Non-admins only have the Me tab. A direct URL like /settings?tab=users
  // would otherwise leave the page blank (admin tab content is gated below).
  const activeTab: SettingsTabId = isAdmin ? resolvedTab : "me"
  const locale = useLocale()

  // Tabs are rebuilt per render so labels flip with the locale toggle. Me is
  // always first; admin tabs only show for admins. Visual ordering follows
  // the Me / Team / System grouping even though TopTabs renders a flat row.
  const tabs: TopTab<SettingsTabId>[] = useMemo(() => {
    const base: TopTab<SettingsTabId>[] = [
      { id: "me", label: t("settings.tab.me", locale), icon: UserCircle2 },
    ]
    if (!isAdmin) return base
    return [
      ...base,
      // Team
      { id: "users", label: t("settings.tab.users", locale), icon: Users },
      { id: "notifications", label: t("settings.tab.notifications", locale), icon: Bell },
      // System
      { id: "clients", label: t("settings.tab.clients", locale), icon: Building2 },
      { id: "inbox", label: t("settings.tab.inbox", locale), icon: InboxIcon },
      { id: "pedro", label: t("settings.tab.pedro", locale), icon: Sparkles },
      { id: "board", label: t("settings.tab.board", locale), icon: Database },
      { id: "tokens", label: t("settings.tab.tokens", locale), icon: KeyRound },
      { id: "health", label: t("settings.tab.health", locale), icon: Activity },
    ]
  }, [locale, isAdmin])

  return (
    <div className="mt-6 space-y-6">
      <TopTabs<SettingsTabId> tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === "me" && <MeTab data={meTab} />}

      {isAdmin && activeTab === "clients" && <ClientsTab />}
      {isAdmin && activeTab === "tokens" && <ApiTokensTab statuses={props.tokenStatuses} />}
      {isAdmin && activeTab === "board" && (
        <BoardConfigTab config={props.boardConfig} defaults={props.defaultBoardConfig} />
      )}
      {isAdmin && activeTab === "users" && (
        <UsersTab users={props.users} currentUserId={props.currentUserId} />
      )}
      {isAdmin && activeTab === "notifications" && (
        <NotificationsTab
          slackConnected={props.notifications.slackConnected}
          recipients={props.notifications.recipients}
          teamChannelId={props.notifications.teamChannelId}
          salesChannelId={props.notifications.salesChannelId}
          closers={props.notifications.closers}
        />
      )}
      {isAdmin && activeTab === "inbox" && <InboxAutomationTab rules={props.inboxAutomationRules} />}
      {isAdmin && activeTab === "pedro" && <PedroSettingsTab />}
      {isAdmin && activeTab === "health" && <HealthTab />}
    </div>
  )
}
