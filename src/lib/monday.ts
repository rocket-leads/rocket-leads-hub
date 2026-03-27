import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const MONDAY_API_URL = "https://api.monday.com/v2"

async function getToken(): Promise<string> {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "monday")
    .single()
  if (!data) throw new Error("Monday token not configured. Go to Settings → API Tokens.")
  return decrypt(data.token_encrypted)
}

async function getBoardConfig() {
  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "board_config")
    .single()
  return data?.value as BoardConfig | null
}

export type BoardConfig = {
  onboarding_board_id: string
  current_board_id: string
  onboarding_columns: Record<string, string>
  current_columns: Record<string, string>
  client_board_columns: Record<string, string>
}

export type MondayClient = {
  mondayItemId: string
  name: string
  firstName: string
  accountManager: string
  campaignManager: string
  campaignStatus: string
  kickOffDate: string
  adBudget: string
  metaAdAccountId: string
  stripeCustomerId: string
  trengoContactId: string
  clientBoardId: string
  boardType: "onboarding" | "current"
}

async function gql(query: string, variables: Record<string, unknown>, token: string) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: 60 }, // cache 60s
  })
  if (!res.ok) throw new Error(`Monday API error: ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(json.errors[0]?.message ?? "Monday API error")
  return json.data
}

async function fetchAllItems(boardId: string, token: string) {
  const query = `
    query GetItems($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 100, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values {
              id
              text
            }
          }
        }
      }
    }
  `

  const allItems: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string }> }> = []
  let cursor: string | null = null

  do {
    const data = await gql(query, { boardId, cursor }, token)
    const page = data.boards?.[0]?.items_page
    if (!page) break
    allItems.push(...(page.items ?? []))
    cursor = page.cursor ?? null
  } while (cursor)

  return allItems
}

function mapItem(
  item: { id: string; name: string; column_values: Array<{ id: string; text: string }> },
  columns: Record<string, string>,
  boardType: "onboarding" | "current"
): MondayClient {
  const cv: Record<string, string> = {}
  for (const col of item.column_values) {
    cv[col.id] = col.text ?? ""
  }

  return {
    mondayItemId: item.id,
    name: item.name,
    firstName: cv[columns.first_name] ?? "",
    accountManager: cv[columns.account_manager] ?? "",
    campaignManager: cv[columns.campaign_manager] ?? "",
    campaignStatus: cv[columns.campaign_status] ?? "",
    kickOffDate: cv[columns.kick_off_date] ?? "",
    adBudget: cv[columns.ad_budget] ?? "",
    metaAdAccountId: cv[columns.meta_ad_account_id] ?? "",
    stripeCustomerId: cv[columns.stripe_customer_id] ?? "",
    trengoContactId: cv[columns.trengo_contact_id] ?? "",
    clientBoardId: cv[columns.client_board_id] ?? "",
    boardType,
  }
}

export async function fetchClients(boardType: "onboarding" | "current"): Promise<MondayClient[]> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found. Run the Supabase migration.")

  const boardId =
    boardType === "onboarding" ? config.onboarding_board_id : config.current_board_id
  const columns =
    boardType === "onboarding" ? config.onboarding_columns : config.current_columns

  const items = await fetchAllItems(boardId, token)
  return items.map((item) => mapItem(item, columns, boardType))
}

export async function fetchBothBoards(): Promise<{
  onboarding: MondayClient[]
  current: MondayClient[]
}> {
  const [onboarding, current] = await Promise.all([
    fetchClients("onboarding"),
    fetchClients("current"),
  ])
  return { onboarding, current }
}

export async function fetchClientById(itemId: string): Promise<MondayClient | null> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const query = `
    query GetItem($itemId: ID!) {
      items(ids: [$itemId]) {
        id
        name
        board { id }
        column_values {
          id
          text
        }
      }
    }
  `

  const data = await gql(query, { itemId }, token)
  const item = data.items?.[0]
  if (!item) return null

  const boardId = String(item.board?.id)
  let boardType: "onboarding" | "current"
  let columns: Record<string, string>

  if (boardId === String(config.onboarding_board_id)) {
    boardType = "onboarding"
    columns = config.onboarding_columns
  } else if (boardId === String(config.current_board_id)) {
    boardType = "current"
    columns = config.current_columns
  } else {
    // Fallback: try to match by checking both
    boardType = "current"
    columns = config.current_columns
  }

  return mapItem(item, columns, boardType)
}
