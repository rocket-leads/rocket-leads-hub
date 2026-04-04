import { auth } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiTokensTab } from "./_components/api-tokens-tab"
import { BoardConfigTab } from "./_components/board-config-tab"
import { UsersTab } from "./_components/users-tab"
import { ColumnMappingTab } from "./_components/column-mapping-tab"
import { TargetsTab } from "./_components/targets-tab"
import { DEFAULT_TARGETS, type KpiTargets } from "@/lib/clients/targets"
import { ApiHealthBar } from "./_components/api-health-bar"
import { fetchBothBoards } from "@/lib/integrations/monday"

export default async function SettingsPage() {
  const session = await auth()
  if (!session || session.user.role !== "admin") redirect("/clients")

  const supabase = await createAdminClient()

  const [{ data: tokens }, { data: settingsRow }, { data: targetsRow }, { data: users }, { data: columnMappings }] = await Promise.all([
    supabase.from("api_tokens").select("service, is_valid, last_verified"),
    supabase.from("settings").select("value").eq("key", "board_config").single(),
    supabase.from("settings").select("value").eq("key", "kpi_targets").single(),
    supabase.from("users").select("id, email, name, role, created_at").order("created_at"),
    supabase.from("user_column_mappings").select("user_id, monday_column_role, monday_person_name"),
  ])

  // Collect unique Monday people names from active clients only (not churned/on hold)
  const ACTIVE_STATUSES = new Set(["Kick off", "In development", "Live"])
  let mondayPeople: string[] = []
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
  const kpiTargets = (targetsRow?.value ?? DEFAULT_TARGETS) as KpiTargets

  return (
    <div className="container mx-auto max-w-4xl py-8 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-heading font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage API tokens, board configuration, and users</p>
      </div>

      <ApiHealthBar />

      <Tabs defaultValue="tokens" className="mt-6">
        <TabsList className="mb-6">
          <TabsTrigger value="tokens">API Tokens</TabsTrigger>
          <TabsTrigger value="board">Board Config</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
          <TabsTrigger value="mapping">Column Mapping</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens">
          <ApiTokensTab statuses={tokenStatuses} />
        </TabsContent>

        <TabsContent value="board">
          <BoardConfigTab config={boardConfig} defaults={defaultBoardConfig} />
        </TabsContent>

        <TabsContent value="users">
          <UsersTab users={users ?? []} currentUserId={session.user.id} />
        </TabsContent>

        <TabsContent value="targets">
          <TargetsTab initial={kpiTargets} />
        </TabsContent>

        <TabsContent value="mapping">
          <ColumnMappingTab
            users={(users ?? []).map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role }))}
            mondayPeople={mondayPeople}
            existingMappings={(columnMappings ?? []).map((m) => ({
              user_id: m.user_id,
              monday_column_role: m.monday_column_role,
              monday_person_name: m.monday_person_name,
            }))}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
