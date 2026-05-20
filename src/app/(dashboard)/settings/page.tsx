import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SettingsTabs } from "./_components/settings-tabs"
import {
  DEFAULT_INBOX_AUTOMATION_RULES,
  type InboxAutomationRules,
  type MondayRole,
} from "./types"
import { ApiHealthBar } from "./_components/api-health-bar"
import { PageHeader } from "@/components/ui/page-header"
import { fetchBothBoards, type MondayClient } from "@/lib/integrations/monday"
import { getSlackChannels } from "@/lib/slack"
import { fetchFathomTeamMembers, type FathomTeamMember } from "@/lib/integrations/fathom"
import { cachedFetch, readCache } from "@/lib/cache"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"

export default async function SettingsPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") redirect("/watchlist")

  const supabase = await createAdminClient()
  const locale = await getUserLocale(session.user.id)

  const [
    { data: tokens },
    { data: settingsRow },
    { data: users },
    { data: columnMappings },
    { data: closerMappingsRows },
    { data: automationRulesRow },
    slackChannels,
  ] = await Promise.all([
    supabase.from("api_tokens").select("service, is_valid, last_verified"),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
    supabase.from("users").select("id, email, name, role, slack_user_id, fathom_email, whatsapp_template_name, created_at").order("created_at"),
    supabase.from("user_column_mappings").select("user_id, monday_column_role, monday_person_name"),
    supabase.from("closer_slack_mappings").select("monday_person_name, slack_user_id"),
    supabase.from("settings").select("value").eq("key", "inbox_automation_rules").maybeSingle(),
    getSlackChannels(),
  ])

  // Two heavy data sources stayed in SSR: Monday boards (cron-warmed,
  // sub-second from cache) and Fathom team members (24h cache, only 1-2s
  // on the once-a-day cold path).
  //
  // The third — `targets_closer_names` — used to run here too but the
  // underlying `fetchAllItems("3762696870")` paginates the whole targets
  // board (1000s of leads, 5-10s cold) and was blocking the Board Config
  // tab loading even though closers are only used in the Notifications
  // tab. NotificationsTab now fetches it client-side via useQuery from
  // /api/admin/settings/closer-names, so opening Settings no longer waits
  // on Monday's targets-board pagination.
  const ACTIVE_STATUSES = new Set(["Kick off", "In development", "Live"])

  const [boards, fathomTeamMembers] = await Promise.all([
    (async () => {
      try {
        const cached = await readCache<{ onboarding: MondayClient[]; current: MondayClient[] }>(
          "monday_boards",
          60 * 60 * 1000,
        )
        if (cached) return cached
        return await fetchBothBoards()
      } catch {
        return { onboarding: [] as MondayClient[], current: [] as MondayClient[] }
      }
    })(),
    cachedFetch<FathomTeamMember[]>(
      "fathom_team_members",
      () => fetchFathomTeamMembers(),
      24 * 60 * 60 * 1000,
    ).catch(() => [] as FathomTeamMember[]),
  ])

  // Closer-names list starts empty; NotificationsTab hydrates it via
  // useQuery on mount. Keeping the variable here so the rest of the page
  // wiring (notifications.closers mapping below) stays the same shape.
  const closerNames: string[] = []

  const allClients = [...boards.onboarding, ...boards.current]
  const mondayPeople: string[] = (() => {
    const names = new Set<string>()
    for (const c of allClients) {
      if (!ACTIVE_STATUSES.has(c.campaignStatus)) continue
      if (c.accountManager) names.add(c.accountManager)
      if (c.campaignManager) names.add(c.campaignManager)
    }
    return Array.from(names).sort()
  })()

  const tokenStatuses = Object.fromEntries(
    (tokens ?? []).map((t) => [t.service, { is_valid: t.is_valid, last_verified: t.last_verified }])
  )

  const defaultBoardConfig = {
    onboarding_board_id: "1316567475",
    current_board_id: "1626272350",
    onboarding_columns: {
      client_board_id: "text_mm1vbb2h", kick_off_date: "datum",
      meta_ad_account_id: "text_mm1vdkqg", stripe_customer_id: "text_mm1vy1bh",
      trengo_contact_id: "text_mm1vtaxg", google_drive_id: "",
      account_manager: "mensen8",
      campaign_manager: "person", first_name: "text7", company_name: "bedrijfsnaam",
      ad_budget: "numeric_mm1vfk40", service_fee: "", contact_direction: "text6",
      contact_channel: "status_11", campaign_status: "status",
      meta_connected: "dup__of_status",
      follow_up_status: "status__1", follow_up_fee: "numbers0__1",
      cycle_start_date: "date3", next_invoice_date: "date_mm3297df",
    },
    current_columns: {
      client_board_id: "text_mm1vajgv", country: "color3",
      meta_ad_account_id: "text_mm1vqpb", stripe_customer_id: "text_mm1v2pte",
      trengo_contact_id: "text_mm1vgtdy", google_drive_id: "",
      account_manager: "dup__of_ad_manager",
      campaign_manager: "person", appointment_setter: "multiple_person_mm1w4j0b",
      first_name: "tekst74", company_name: "bedrijfsnaam",
      ad_budget: "numeric_mm1vdpd1", service_fee: "", contact_direction: "tekst7",
      contact_channel: "status_17", campaign_status: "color5",
      follow_up_status: "status__1", follow_up_fee: "numbers0__1",
      cycle_start_date: "date3", next_invoice_date: "date_mm3297df",
    },
    client_board_columns: {
      date_created: "date4", date_appointment: "dup__of_date_created__1",
      lead_status: "dup__of_status__1", lead_status_2: "dup__of_status6__1",
      deal_value: "omzet__1", utm: "text9__1",
      date_deal: "date_mm1vgcfx", taken_call_status_value: "Afspraak",
    },
  }

  const boardConfig = (settingsRow?.value ?? defaultBoardConfig) as typeof defaultBoardConfig

  return (
    <div>
      <PageHeader
        title={t("settings.title", locale)}
        subtitle={t("settings.subtitle", locale)}
        actions={
          <a
            href="/settings/health"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 bg-card text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            {t("settings.health_link", locale)}
          </a>
        }
      />

      <ApiHealthBar />

      {(() => {
        // Index Monday mappings by user_id — UI now enforces one mapping per user.
        const mappingByUser = new Map<string, { role: MondayRole; name: string }>()
        for (const m of columnMappings ?? []) {
          mappingByUser.set(m.user_id, {
            role: m.monday_column_role as MondayRole,
            name: m.monday_person_name,
          })
        }
        const usersWithMapping = (users ?? []).map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          slack_user_id: u.slack_user_id ?? null,
          fathom_email: u.fathom_email ?? null,
          whatsapp_template_name: u.whatsapp_template_name ?? null,
          monday_role: mappingByUser.get(u.id)?.role ?? null,
          monday_person_name: mappingByUser.get(u.id)?.name ?? null,
          created_at: u.created_at,
        }))

        const closerSlackById: Record<string, string> = {}
        for (const m of closerMappingsRows ?? []) closerSlackById[m.monday_person_name] = m.slack_user_id
        const closers = closerNames.map((name) => ({
          name,
          slackId: closerSlackById[name] ?? null,
        }))

        const inboxAutomationRules = {
          ...DEFAULT_INBOX_AUTOMATION_RULES,
          ...((automationRulesRow?.value as Partial<InboxAutomationRules> | undefined) ?? {}),
        }

        return (
          <SettingsTabs
            tokenStatuses={tokenStatuses}
            boardConfig={boardConfig}
            defaultBoardConfig={defaultBoardConfig}
            users={usersWithMapping}
            currentUserId={session.user.id}
            mondayPeople={mondayPeople}
            fathomTeamMembers={fathomTeamMembers}
            clients={allClients}
            inboxAutomationRules={inboxAutomationRules}
            notifications={{
              slackConnected: !!tokenStatuses.slack?.is_valid,
              recipients: (users ?? []).map((u) => ({
                name: u.name,
                email: u.email,
                hasSlack: !!u.slack_user_id,
              })),
              teamChannelId: slackChannels.team_watchlist ?? null,
              salesChannelId: slackChannels.sales ?? null,
              closers,
            }}
          />
        )
      })()}
    </div>
  )
}
