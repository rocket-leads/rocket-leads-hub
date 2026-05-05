import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"

const MONDAY_API_URL = "https://api.monday.com/v2"

let cachedToken: { value: string; expiresAt: number } | null = null

export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("api_tokens")
    .select("token_encrypted")
    .eq("service", "monday")
    .single()
  if (!data) throw new Error("Monday token not configured. Go to Settings → API Tokens.")
  const token = decrypt(data.token_encrypted)
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

let cachedBoardConfig: { value: BoardConfig | null; expiresAt: number } | null = null

async function getBoardConfig() {
  if (cachedBoardConfig && Date.now() < cachedBoardConfig.expiresAt) return cachedBoardConfig.value

  const supabase = await createAdminClient()
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "board_config")
    .single()
  const config = (data?.value as BoardConfig | null)
  cachedBoardConfig = { value: config, expiresAt: Date.now() + 5 * 60 * 1000 }
  return config
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
  /** Optional `bedrijfsnaam` column. Empty when the column isn't configured on the board. */
  companyName: string
  accountManager: string
  campaignManager: string
  appointmentSetter: string
  campaignStatus: string
  kickOffDate: string
  adBudget: string
  serviceFee: string
  /** Numeric follow-up fee from Monday (`numbers0__1`). Empty when not set. */
  followUpFee: string
  /** Status text from Monday (`status__1`). Used to detect whether RL is doing the lead follow-up. */
  followUpStatus: string
  metaAdAccountId: string
  stripeCustomerId: string
  trengoContactId: string
  clientBoardId: string
  googleDriveId: string
  /** Date the client's new billing cycle starts. Manual source of truth from
   *  Monday's `date3` column. `YYYY-MM-DD` or "" when unset. */
  cycleStartDate: string
  /** Date finance sends the invoice — always derived as `cycleStartDate - 7d`,
   *  but stored on Monday in column `date_mm3297df` so the CRM also has it.
   *  `YYYY-MM-DD` or "" when unset. */
  nextInvoiceDate: string
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

export async function fetchAllItems(boardId: string, token: string, maxRetries = 2) {
  const query = `
    query GetItems($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 500, cursor: $cursor) {
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

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const allItems: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string }> }> = []
      let cursor: string | null = null

      let firstPage = true
      do {
        const data = await gql(query, { boardId, cursor }, token)
        const board = data.boards?.[0]
        // Monday returns an empty `boards` array (or a null entry) when the API token
        // has no access to the requested board, instead of throwing. Surface that as
        // an error so callers can distinguish "inaccessible" from "genuinely empty".
        if (firstPage && (!data.boards?.length || board == null)) {
          throw new Error(`Monday board ${boardId} not accessible (no access or board missing)`)
        }
        firstPage = false
        const page = board?.items_page
        if (!page) break
        allItems.push(...(page.items ?? []))
        cursor = page.cursor ?? null
      } while (cursor)

      return allItems
    } catch (error) {
      const isCursorExpired = error instanceof Error && error.message.includes("cursor")
      if (!isCursorExpired || attempt === maxRetries) throw error
      // Retry from scratch with a fresh cursor
    }
  }

  return []
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
    // `company_name` resolves through board config first, then falls back to the literal
    // "bedrijfsnaam" column ID — the column has the same ID across all three boards, so
    // existing saved configs (without `company_name` set) still pick it up automatically.
    companyName: cv[columns.company_name] ?? cv["bedrijfsnaam"] ?? "",
    accountManager: cv[columns.account_manager] ?? "",
    campaignManager: cv[columns.campaign_manager] ?? "",
    appointmentSetter: cv[columns.appointment_setter] ?? cv["multiple_person_mm1w4j0b"] ?? "",
    campaignStatus: cv[columns.campaign_status] ?? "",
    kickOffDate: cv[columns.kick_off_date] ?? "",
    adBudget: cv[columns.ad_budget] ?? "",
    serviceFee: cv[columns.service_fee] ?? "",
    // Same literal-fallback pattern we already use for `bedrijfsnaam` /
    // `multiple_person_mm1w4j0b` — column IDs are stable across boards, board
    // config can override later if needed.
    followUpFee: cv[columns.follow_up_fee] ?? cv["numbers0__1"] ?? "",
    followUpStatus: cv[columns.follow_up_status] ?? cv["status__1"] ?? "",
    metaAdAccountId: cv[columns.meta_ad_account_id] ?? "",
    stripeCustomerId: cv[columns.stripe_customer_id] ?? "",
    trengoContactId: cv[columns.trengo_contact_id] ?? "",
    clientBoardId: cv[columns.client_board_id] ?? "",
    googleDriveId: cv[columns.google_drive_id] ?? "",
    // Two-date model — see lib/clients/billing-cycle.ts for the relationship:
    //   cycleStartDate   = manual source of truth, Monday `date3`
    //   nextInvoiceDate  = derived (cycle - 7d), stored on Monday `date_mm3297df`
    //
    // Defensive read: legacy board_config rows still have
    // `next_invoice_date: "date3"` (when date3 was the *invoice* column,
    // before the model split). Reading that would surface the cycle date as
    // the invoice date — the bug Roy is seeing right now. Skip the configured
    // mapping when it points at the cycle column, fall through to the new
    // literal id instead.
    cycleStartDate: cv[columns.cycle_start_date] ?? cv["date3"] ?? "",
    nextInvoiceDate:
      (columns.next_invoice_date && columns.next_invoice_date !== "date3"
        ? cv[columns.next_invoice_date]
        : null) ??
      cv["date_mm3297df"] ??
      "",
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

export type MondayUser = {
  id: number
  name: string
  email: string
}

let cachedMondayUsers: { value: MondayUser[]; expiresAt: number } | null = null

/**
 * Fetch the workspace's Monday users. Used by the Hub's client edit UI to
 * power AM/CM/setter dropdowns: the UI shows names but the API call back
 * to Monday needs numeric person IDs. Cached for 15 minutes — Monday
 * memberships rarely change. Excludes guests and disabled accounts.
 */
export async function fetchMondayUsers(): Promise<MondayUser[]> {
  if (cachedMondayUsers && Date.now() < cachedMondayUsers.expiresAt) {
    return cachedMondayUsers.value
  }

  const token = await getToken()
  const query = `
    query GetUsers {
      users(limit: 200, kind: non_guests) {
        id
        name
        email
        enabled
      }
    }
  `

  const data = await gql(query, {}, token)
  const users: MondayUser[] = (data.users ?? [])
    .filter((u: { enabled?: boolean }) => u.enabled !== false)
    .map((u: { id: string; name: string; email: string }) => ({
      id: parseInt(u.id, 10),
      name: u.name,
      email: u.email,
    }))
    .filter((u: MondayUser) => Number.isFinite(u.id))
    .sort((a: MondayUser, b: MondayUser) => a.name.localeCompare(b.name))

  cachedMondayUsers = { value: users, expiresAt: Date.now() + 15 * 60 * 1000 }
  return users
}

export type MondayLeadItem = {
  id: string
  name: string
  dateCreated: string
  dateAppointment: string
  leadStatus: string
  leadStatus2: string
  dealValue: number
  utm: string
  dateDeal: string
}

export async function fetchClientBoardItems(boardId: string, columnOverrides?: Record<string, string>): Promise<MondayLeadItem[]> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const cols = { ...config.client_board_columns, ...columnOverrides }
  const items = await fetchAllItems(boardId, token)

  return items.map((item) => {
    const cv: Record<string, string> = {}
    for (const col of item.column_values) {
      cv[col.id] = col.text ?? ""
    }
    return {
      id: item.id,
      name: item.name,
      dateCreated: cv[cols.date_created] ?? "",
      dateAppointment: cv[cols.date_appointment] ?? "",
      leadStatus: cv[cols.lead_status] ?? "",
      leadStatus2: cv[cols.lead_status_2] ?? "",
      dealValue: parseFloat(cv[cols.deal_value] ?? "0") || 0,
      utm: cv[cols.utm] ?? "",
      dateDeal: cv[cols.date_deal] ?? "",
    }
  })
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

export type MondayItemWithUpdates = {
  itemId: string
  itemName: string
  utm: string
  leadStatus: string
  updates: Array<{ text: string; createdAt: string }>
}

/**
 * Fetch the recent updates posted directly on a single Monday item — used to pull AM/CM
 * notes from a client's row in the Current Clients board (board-level commentary), distinct
 * from the per-lead updates in the client's lead board.
 */
export type ItemUpdate = {
  text: string
  createdAt: string
  /** Author name from Monday's `creator` field. Used downstream by AI checks
   *  to weigh updates differently depending on who wrote them (e.g. Finance
   *  saying "wacht met factureren" carries more decisive weight than a
   *  campaign manager note). Empty when Monday didn't return a creator. */
  creatorName: string
}

export async function fetchItemUpdates(
  itemId: string,
  daysBack: number = 14,
): Promise<ItemUpdate[]> {
  const token = await getToken()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - daysBack)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const query = `
    query GetItemUpdates($itemId: ID!) {
      items(ids: [$itemId]) {
        updates(limit: 50) {
          text_body
          created_at
          creator {
            name
          }
        }
      }
    }
  `
  const data = await gql(query, { itemId }, token)
  const item = data.items?.[0]
  if (!item) return []

  return (item.updates ?? [])
    .map((u: { text_body?: string; created_at?: string; creator?: { name?: string } | null }) => ({
      text: (u.text_body ?? "").trim(),
      createdAt: (u.created_at ?? "").slice(0, 10),
      creatorName: (u.creator?.name ?? "").trim(),
    }))
    .filter((u: ItemUpdate) => u.text && u.createdAt >= cutoffStr)
}

export async function fetchClientBoardItemsWithUpdates(
  boardId: string,
): Promise<MondayItemWithUpdates[]> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const cols = config.client_board_columns

  const query = `
    query GetItemsWithUpdates($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 500, cursor: $cursor) {
          cursor
          items {
            id
            name
            column_values {
              id
              text
            }
            updates(limit: 5) {
              text_body
              created_at
            }
          }
        }
      }
    }
  `

  type RawItem = {
    id: string
    name: string
    column_values: Array<{ id: string; text: string }>
    updates: Array<{ text_body: string; created_at: string }>
  }

  const allItems: RawItem[] = []
  let cursor: string | null = null

  do {
    const data = await gql(query, { boardId, cursor }, token)
    const page = data.boards?.[0]?.items_page
    if (!page) break
    allItems.push(...(page.items ?? []))
    cursor = page.cursor ?? null
  } while (cursor)

  return allItems.map((item) => {
    const cv: Record<string, string> = {}
    for (const col of item.column_values) {
      cv[col.id] = col.text ?? ""
    }
    return {
      itemId: item.id,
      itemName: item.name,
      utm: cv[cols.utm] ?? "",
      leadStatus: cv[cols.lead_status] ?? "",
      updates: (item.updates ?? []).map((u) => ({
        text: u.text_body ?? "",
        createdAt: u.created_at ?? "",
      })),
    }
  })
}

/**
 * Splits the `stripe_customer_id` column value into individual customer IDs.
 * One Monday item can map to multiple Stripe customers (entity changes, alt
 * payment methods, etc.) — we store them comma-separated. Trims, dedupes, and
 * filters empty tokens. Whitespace tolerant.
 */
export function parseStripeCustomerIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  for (const part of raw.split(",")) {
    const id = part.trim()
    if (id) seen.add(id)
  }
  return [...seen]
}

/**
 * Write a single text/simple value to a Monday column on a client board item.
 * `columnKey` is the logical key from board config (e.g. "stripe_customer_id"),
 * not the Monday column ID — we resolve the actual ID per board type from the
 * stored config so callers don't have to know the wiring.
 *
 * Returns a brief reason string when the column key isn't mapped or the GraphQL
 * call fails; throws only on auth/config issues.
 */
export async function setItemColumnValue(
  boardType: "onboarding" | "current",
  itemId: string,
  columnKey: string,
  value: string,
): Promise<void> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const boardId = boardType === "onboarding" ? config.onboarding_board_id : config.current_board_id
  const columns = boardType === "onboarding" ? config.onboarding_columns : config.current_columns
  const columnId = columns[columnKey]
  if (!columnId) throw new Error(`Column "${columnKey}" is not mapped for the ${boardType} board.`)

  const mutation = `
    mutation SetSimpleValue($boardId: ID!, $itemId: ID!, $columnId: String!, $value: String!) {
      change_simple_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) { id }
    }
  `

  await gql(mutation, { boardId, itemId, columnId, value }, token)
}

/**
 * Write a complex JSON-shape value to a Monday column. Use this for column
 * types that don't accept a flat string: status (`{ label: "Live" }`),
 * person/people (`{ personsAndTeams: [{ id, kind: "person" }] }`), dropdown
 * (`{ labels: ["A"] }`), etc. `columnKey` is resolved via board config like
 * `setItemColumnValue` does — callers pass logical keys, not Monday IDs.
 */
export async function setItemColumnValueRaw(
  boardType: "onboarding" | "current",
  itemId: string,
  columnKey: string,
  jsonValue: unknown,
): Promise<void> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const boardId = boardType === "onboarding" ? config.onboarding_board_id : config.current_board_id
  const columns = boardType === "onboarding" ? config.onboarding_columns : config.current_columns
  const columnId = columns[columnKey]
  if (!columnId) throw new Error(`Column "${columnKey}" is not mapped for the ${boardType} board.`)

  const mutation = `
    mutation SetValue($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) { id }
    }
  `

  await gql(mutation, { boardId, itemId, columnId, value: JSON.stringify(jsonValue) }, token)
}

/**
 * Post an update on a Monday item. Used by the Hub's inbox-mirror so updates
 * and tasks created in the Hub still surface on the client item's Monday
 * timeline. Returns the new update's ID, or null when the call fails — we
 * don't want a Monday outage to block the Supabase write.
 */
export async function postItemUpdate(
  itemId: string,
  body: string,
  parentUpdateId?: string,
): Promise<string | null> {
  const token = await getToken()
  const mutation = parentUpdateId
    ? `mutation Reply($itemId: ID!, $parentId: ID!, $body: String!) {
         create_update(item_id: $itemId, parent_id: $parentId, body: $body) { id }
       }`
    : `mutation Update($itemId: ID!, $body: String!) {
         create_update(item_id: $itemId, body: $body) { id }
       }`
  const variables = parentUpdateId
    ? { itemId, parentId: parentUpdateId, body }
    : { itemId, body }
  try {
    const data = await gql(mutation, variables, token)
    return data.create_update?.id ?? null
  } catch (e) {
    console.error("Monday postItemUpdate failed:", e)
    return null
  }
}

export async function fetchClientItemUpdates(
  itemId: string,
): Promise<Array<{ text: string; createdAt: string }>> {
  const token = await getToken()

  const query = `
    query GetItemUpdates($itemId: ID!) {
      items(ids: [$itemId]) {
        updates {
          text_body
          created_at
        }
      }
    }
  `

  const data = await gql(query, { itemId }, token)
  const updates = data.items?.[0]?.updates ?? []
  return updates.map((u: { text_body: string; created_at: string }) => ({
    text: u.text_body ?? "",
    createdAt: u.created_at ?? "",
  }))
}
