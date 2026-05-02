import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { SettingsTabs } from "./_components/settings-tabs"
import type { MondayRole } from "./actions"
import { ApiHealthBar } from "./_components/api-health-bar"
import { fetchAllItems, fetchBothBoards, getToken as getMondayToken } from "@/lib/integrations/monday"
import { getSlackChannels } from "@/lib/slack"

export default async function SettingsPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") redirect("/watchlist")

  const supabase = await createAdminClient()

  const [
    { data: tokens },
    { data: settingsRow },
    { data: users },
    { data: columnMappings },
    { data: closerMappingsRows },
    slackChannels,
  ] = await Promise.all([
    supabase.from("api_tokens").select("service, is_valid, last_verified"),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
    supabase.from("users").select("id, email, name, role, slack_user_id, created_at").order("created_at"),
    supabase.from("user_column_mappings").select("user_id, monday_column_role, monday_person_name"),
    supabase.from("closer_slack_mappings").select("monday_person_name, slack_user_id"),
    getSlackChannels(),
  ])

  // Collect unique Monday people names from active clients only (not churned/on hold)
  const ACTIVE_STATUSES = new Set(["Kick off", "In development", "Live"])
  let mondayPeople: string[] = []
  let closerNames: string[] = []
  try {
    const { onboarding, current } = await fetchBothBoards()
    const allClients = [...onboarding, ...current]
    const names = new Set<string>()
    for (const c of allClients) {
      if (!ACTIVE_STATUSES.has(c.campaignStatus)) continue
      if (c.accountManager) names.add(c.accountManager)
      if (c.campaignManager) names.add(c.campaignManager)
    }
    mondayPeople = Array.from(names).sort()
  } catch {
    // Monday token might not be configured yet — that's fine
  }

  // Closer names from targets board `wie_` column — only include people who
  // had at least one lead come in within the last 60 days. Old/inactive closers
  // would otherwise clutter the mapping list forever.
  try {
    const token = await getMondayToken()
    const items = await fetchAllItems("3762696870", token)
    const cutoff = new Date()
    cutoff.setUTCDate(cutoff.getUTCDate() - 60)
    const cutoffIso = cutoff.toISOString().slice(0, 10)
    const names = new Set<string>()
    for (const item of items) {
      const wie = item.column_values.find((c) => c.id === "wie_")?.text?.trim()
      if (!wie) continue
      const created = item.column_values.find((c) => c.id === "datum_created")?.text ?? ""
      const createdDate = created.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
      if (createdDate && createdDate >= cutoffIso) names.add(wie)
    }
    closerNames = Array.from(names).sort()
  } catch {
    // Targets board not accessible — leave empty
  }

  const tokenStatuses = Object.fromEntries(
    (tokens ?? []).map((t) => [t.service, { is_valid: t.is_valid, last_verified: t.last_verified }])
  )

  const defaultBoardConfig = {
    onboarding_board_id: "1316567475",
    current_board_id: "1626272350",
    onboarding_columns: {
      client_board_id: "text_mm1vbb2h", kick_off_date: "datum",
      meta_ad_account_id: "text_mm1vdkqg", stripe_customer_id: "text_mm1vy1bh",
      trengo_contact_id: "text_mm1vtaxg", account_manager: "mensen8",
      campaign_manager: "person", first_name: "text7",
      ad_budget: "numeric_mm1vfk40", contact_direction: "text6",
      contact_channel: "status_11", campaign_status: "status",
    },
    current_columns: {
      client_board_id: "text_mm1vajgv", country: "color3",
      meta_ad_account_id: "text_mm1vqpb", stripe_customer_id: "text_mm1v2pte",
      trengo_contact_id: "text_mm1vgtdy", account_manager: "dup__of_ad_manager",
      campaign_manager: "person", first_name: "tekst74",
      ad_budget: "numeric_mm1vdpd1", contact_direction: "tekst7",
      contact_channel: "status_17", campaign_status: "color5",
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
      <div className="mb-6">
        <h1 className="text-[22px] font-heading font-semibold tracking-tight leading-tight">Settings</h1>
        <p className="text-[13px] text-muted-foreground mt-1">API tokens, board config, users and notifications.</p>
      </div>

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

        return (
          <SettingsTabs
            tokenStatuses={tokenStatuses}
            boardConfig={boardConfig}
            defaultBoardConfig={defaultBoardConfig}
            users={usersWithMapping}
            currentUserId={session.user.id}
            mondayPeople={mondayPeople}
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
