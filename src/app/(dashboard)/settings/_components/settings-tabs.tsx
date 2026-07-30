"use client"

import { useMemo } from "react"
import { Plug, Database, Users, Zap, UserCircle2, Sparkles } from "lucide-react"
import type { TopTab } from "@/components/ui/top-tabs"
import { cn } from "@/lib/utils"
import { useLocale } from "@/lib/i18n/client"
import { t } from "@/lib/i18n/t"
import { useUrlState } from "@/lib/use-url-state"
import { ApiTokensTab } from "./api-tokens-tab"
import { BoardConfigTab } from "./board-config-tab"
import { UsersTab } from "./users-tab"
import { AutomationsTab } from "./automations-tab"
import { MeTab, type MeTabData } from "./me-tab"
import { PedroTab } from "./pedro-tab"
import { IntegrationsTab } from "./integrations-tab"
import { MondayClientsTab } from "./monday-clients-tab"
import type { EnvPostureItem } from "@/lib/observability/env-posture"
import type { InboxAutomationRules } from "../types"

// The 6 domain sections after the 2026-07 regroup (was 8 flat tabs). Health +
// ApiHealthBar folded into Integrations; Clients folded into Monday.
type SettingsTabId =
  | "me"
  | "team"
  | "integrations"
  | "monday"
  | "notifications"
  | "pedro"

// Old deep-links (?tab=tokens, /settings?tab=health, the setup-checklist's
// tabs, watchlist's ?tab=api-tokens, etc.) must keep working after the regroup.
const LEGACY_TAB_ALIAS: Record<string, SettingsTabId> = {
  tokens: "integrations",
  "api-tokens": "integrations",
  health: "integrations",
  clients: "monday",
  board: "monday",
  users: "team",
  automations: "notifications",
}

type AdminProps = {
  isAdmin: true
  initialTab: SettingsTabId
  meTab: MeTabData
  tokenStatuses: React.ComponentProps<typeof ApiTokensTab>["statuses"]
  envPosture: EnvPostureItem[]
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
    configs: React.ComponentProps<typeof AutomationsTab>["notificationConfigs"]
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
  "team",
  "integrations",
  "monday",
  "notifications",
  "pedro",
]

/** Resolve a raw URL tab value to a canonical section, honouring legacy aliases. */
function resolveTabId(raw: string, fallback: SettingsTabId): SettingsTabId {
  if (ALL_TAB_IDS.includes(raw as SettingsTabId)) return raw as SettingsTabId
  if (raw in LEGACY_TAB_ALIAS) return LEGACY_TAB_ALIAS[raw]
  return fallback
}

export function SettingsTabs(props: Props) {
  const { isAdmin, initialTab, meTab } = props
  // useUrlState keeps the active tab in the URL so the back button + bookmarks
  // + "send me this view" links all work. The server already passed
  // `initialTab` in for the initial render - useUrlState then takes over for
  // any in-session tab changes.
  const [rawTab, setActiveTab] = useUrlState("tab", initialTab)
  const resolvedTab: SettingsTabId = resolveTabId(rawTab, initialTab)
  // Non-admins only have the Me tab. A direct URL like /settings?tab=team
  // would otherwise leave the page blank (admin tab content is gated below).
  const activeTab: SettingsTabId = isAdmin ? resolvedTab : "me"
  const locale = useLocale()

  // Order matches what the user-facing nav reads top-to-bottom: own profile
  // first, then team, then platform-wide config, then Pedro.
  const tabs: TopTab<SettingsTabId>[] = useMemo(() => {
    const base: TopTab<SettingsTabId>[] = [
      { id: "me", label: t("settings.tab.me", locale), icon: UserCircle2 },
    ]
    if (!isAdmin) return base
    return [
      ...base,
      { id: "team", label: t("settings.tab.team", locale), icon: Users },
      { id: "integrations", label: t("settings.tab.integrations", locale), icon: Plug },
      { id: "monday", label: t("settings.tab.monday", locale), icon: Database },
      { id: "notifications", label: t("settings.tab.notifications", locale), icon: Zap },
      { id: "pedro", label: t("settings.tab.pedro", locale), icon: Sparkles },
    ]
  }, [locale, isAdmin])

  return (
    <div className="set-grid mt-6">
      {/* 187N settings section-rail (left) */}
      <nav className="set-rail" aria-label="Settings sections">
        <div className="set-rail-label">Sections</div>
        {tabs.map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={active ? "page" : undefined}
              className={cn("set-rail-item", active && "active")}
            >
              {Icon && <Icon />}
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Active section content */}
      <div className="set-stack">
        {activeTab === "me" && <MeTab data={meTab} />}

        {isAdmin && activeTab === "team" && (
          <UsersTab users={props.users} currentUserId={props.currentUserId} />
        )}
        {isAdmin && activeTab === "integrations" && (
          <IntegrationsTab statuses={props.tokenStatuses} envPosture={props.envPosture} />
        )}
        {isAdmin && activeTab === "monday" && (
          <MondayClientsTab config={props.boardConfig} defaults={props.defaultBoardConfig} />
        )}
        {isAdmin && activeTab === "notifications" && (
          <AutomationsTab
            inboxRules={props.inboxAutomationRules}
            slackConnected={props.notifications.slackConnected}
            recipients={props.notifications.recipients}
            teamChannelId={props.notifications.teamChannelId}
            salesChannelId={props.notifications.salesChannelId}
            closers={props.notifications.closers}
            notificationConfigs={props.notifications.configs}
          />
        )}
        {isAdmin && activeTab === "pedro" && <PedroTab />}
      </div>
    </div>
  )
}
