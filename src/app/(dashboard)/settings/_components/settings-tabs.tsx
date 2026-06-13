"use client"

import { useMemo } from "react"
import { KeyRound, Database, Users, Zap, Building2, UserCircle2, Activity, Sparkles } from "lucide-react"
import { TopTabs } from "@/components/ui/top-tabs"
import type { TopTab } from "@/components/ui/top-tabs"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { useUrlState } from "@/lib/use-url-state"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { ClientsTab } from "./clients-tab"
import { AutomationsTab } from "./automations-tab"
import { MeTab, type MeTabData } from "./me-tab"
import { HealthTab } from "./health-tab"
import { PedroTab } from "./pedro-tab"
import type { InboxAutomationRules } from "../types"

type SettingsTabId =
  | "me"
  | "users"
  | "tokens"
  | "automations"
  | "clients"
  | "board"
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
    recipients: React.ComponentProps<typeof AutomationsTab>["recipients"]
    teamChannelId: string | null
    salesChannelId: string | null
    closers: React.ComponentProps<typeof AutomationsTab>["closers"]
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
  "users",
  "tokens",
  "automations",
  "clients",
  "board",
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

  // Order matches what the user-facing nav reads top-to-bottom: own profile
  // first, then team management, then platform-wide config, then health.
  const tabs: TopTab<SettingsTabId>[] = useMemo(() => {
    const base: TopTab<SettingsTabId>[] = [
      { id: "me", label: t("settings.tab.me", locale), icon: UserCircle2 },
    ]
    if (!isAdmin) return base
    return [
      ...base,
      { id: "users", label: t("settings.tab.users", locale), icon: Users },
      { id: "tokens", label: t("settings.tab.tokens", locale), icon: KeyRound },
      { id: "automations", label: t("settings.tab.automations", locale), icon: Zap },
      { id: "clients", label: t("settings.tab.clients", locale), icon: Building2 },
      { id: "board", label: t("settings.tab.board", locale), icon: Database },
      { id: "pedro", label: t("settings.tab.pedro", locale), icon: Sparkles },
      { id: "health", label: t("settings.tab.health", locale), icon: Activity },
    ]
  }, [locale, isAdmin])

  return (
    <div className="mt-6 space-y-6">
      <TopTabs<SettingsTabId> tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === "me" && <MeTab data={meTab} />}

      {isAdmin && activeTab === "users" && (
        <UsersTab users={props.users} currentUserId={props.currentUserId} />
      )}
      {isAdmin && activeTab === "tokens" && <ApiTokensTab statuses={props.tokenStatuses} />}
      {isAdmin && activeTab === "automations" && (
        <AutomationsTab
          inboxRules={props.inboxAutomationRules}
          slackConnected={props.notifications.slackConnected}
          recipients={props.notifications.recipients}
          teamChannelId={props.notifications.teamChannelId}
          salesChannelId={props.notifications.salesChannelId}
          closers={props.notifications.closers}
        />
      )}
      {isAdmin && activeTab === "clients" && <ClientsTab />}
      {isAdmin && activeTab === "board" && (
        <BoardConfigTab config={props.boardConfig} defaults={props.defaultBoardConfig} />
      )}
      {isAdmin && activeTab === "pedro" && <PedroTab />}
      {isAdmin && activeTab === "health" && <HealthTab />}
    </div>
  )
}
