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
import { SetupChecklistBanner } from "./_components/setup-checklist-banner"
import { PageHeader } from "@/components/ui/page-header"
import { getSlackChannels } from "@/lib/slack"
import { getAllNotificationConfigs } from "@/lib/slack/notification-config"
import { getUserLocale } from "@/lib/i18n/server"
import { t } from "@/lib/i18n/t"
import { listUserPlatformConnections } from "@/lib/inbox/user-platform-tokens"
import { getUserTrengoChannelIds } from "@/lib/inbox/user-prefs"
import { fetchSetupChecklist } from "@/lib/observability/setup-checklist"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    tab?: string
    slack_error?: string
    slack?: string
    google_calendar_error?: string
    google_calendar_connected?: string
  }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect("/auth/signin")
  const isAdmin = session.user.role === "admin"
  const params = (await searchParams) ?? {}

  const locale = await getUserLocale(session.user.id)

  // Me tab - every signed-in user can see this. Lightweight: just their own
  // platform connections + Trengo channel subscriptions.
  const meSupabase = await createAdminClient()
  const [meConnections, meTrengoChannelIds, googleCalendarRow] = await Promise.all([
    listUserPlatformConnections(session.user.id),
    getUserTrengoChannelIds(session.user.id),
    meSupabase
      .from("users")
      .select("google_calendar_email, google_refresh_token, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle<{
        google_calendar_email: string | null
        google_refresh_token: string | null
        avatar_url: string | null
      }>(),
  ])
  const meConnectionMap = Object.fromEntries(meConnections.map((c) => [c.platform, c]))
  const calendarEmail = googleCalendarRow.data?.google_calendar_email ?? null
  const calendarConnected = !!googleCalendarRow.data?.google_refresh_token
  const meTab = {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email,
    userEmail: session.user.email,
    avatarUrl: googleCalendarRow.data?.avatar_url ?? null,
    slack: meConnectionMap.slack ?? null,
    trengo: meConnectionMap.trengo ?? null,
    monday: meConnectionMap.monday ?? null,
    trengoChannelIds: meTrengoChannelIds,
    slackError: params.slack_error ?? null,
    googleCalendar: {
      connectedEmail: calendarConnected ? calendarEmail : null,
      isSignInAccount:
        calendarConnected &&
        calendarEmail !== null &&
        calendarEmail.toLowerCase() === session.user.email.toLowerCase(),
      error: params.google_calendar_error ?? null,
      justConnected: params.google_calendar_connected ?? null,
    },
  }

  // Non-admins only see the Me tab - skip every heavy admin fetch below.
  if (!isAdmin) {
    return (
      <div>
        <PageHeader title={t("settings.title", locale)} />
        <SettingsTabs
          isAdmin={false}
          initialTab={params.tab === "me" ? "me" : "me"}
          meTab={meTab}
        />
      </div>
    )
  }

  const supabase = await createAdminClient()

  const [
    { data: tokens },
    { data: settingsRow },
    { data: users },
    { data: columnMappings },
    { data: closerMappingsRows },
    { data: automationRulesRow },
    slackChannels,
    setupChecklist,
    notificationConfigs,
  ] = await Promise.all([
    supabase.from("api_tokens").select("service, is_valid, last_verified"),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
    supabase.from("users").select("id, email, name, role, slack_user_id, fathom_email, primary_email_channel_id, primary_wa_channel_id, created_at").order("created_at"),
    supabase.from("user_column_mappings").select("user_id, monday_column_role, monday_person_name"),
    supabase.from("closer_slack_mappings").select("monday_person_name, slack_user_id"),
    supabase.from("settings").select("value").eq("key", "inbox_automation_rules").maybeSingle(),
    getSlackChannels(),
    fetchSetupChecklist(),
    getAllNotificationConfigs(),
  ])

  // Trengo channels, Fathom team members, Monday boards + mondayPeople and
  // targets closer-names all moved to client useQuery on a per-tab basis:
  //
  //   - /api/admin/trengo-channels       (Users tab)
  //   - /api/admin/fathom-team-members   (Users tab)
  //   - /api/admin/settings/monday-clients (Clients tab + Users tab share)
  //   - /api/admin/settings/closer-names (Notifications tab)
  //
  // Settings now paints in ~200ms with just Supabase data; heavy external
  // calls only fire when their tab is opened.
  const closerNames: string[] = []

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
      contact_channel: "status_11", phone: "text6", email: "text_mm48jn2c",
      campaign_status: "status",
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
      contact_channel: "status_17", phone: "tekst7", email: "text_mm48f2j9",
      campaign_status: "color5",
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
      <PageHeader title={t("settings.title", locale)} />

      <ApiHealthBar />

      <SetupChecklistBanner items={setupChecklist.items} />

      {(() => {
        // Index Monday mappings by user_id - UI now enforces one mapping per user.
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
          primary_email_channel_id: u.primary_email_channel_id ?? null,
          primary_wa_channel_id: u.primary_wa_channel_id ?? null,
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
            isAdmin={true}
            initialTab={
              params.tab === "me" ||
              params.tab === "users" ||
              params.tab === "tokens" ||
              params.tab === "automations" ||
              params.tab === "clients" ||
              params.tab === "board" ||
              params.tab === "health"
                ? params.tab
                : "me"
            }
            meTab={meTab}
            tokenStatuses={tokenStatuses}
            boardConfig={boardConfig}
            defaultBoardConfig={defaultBoardConfig}
            users={usersWithMapping}
            currentUserId={session.user.id}
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
              configs: notificationConfigs,
            }}
          />
        )
      })()}
    </div>
  )
}
