import { createAdminClient } from "@/lib/supabase/server"
import { decrypt } from "@/lib/encryption"
import { getUserPlatformToken } from "@/lib/inbox/user-platform-tokens"
import { cachedFetch, readCache, writeCache } from "@/lib/cache"
import type { ResolvedEntity } from "./resolved-entity"

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

export async function getBoardConfig() {
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

/**
 * Build the deep-link URL to a Monday item. Monday's item permalink format is
 * `/boards/{boardId}/pulses/{itemId}` — the `/items/{itemId}` shape doesn't
 * resolve and is what the "Open in Monday" link used to render (404).
 *
 * Returns null when the board ID isn't available; callers should hide the
 * link in that case rather than render a broken URL.
 */
export function mondayItemUrl(
  itemId: string,
  boardType: "onboarding" | "current",
  config: BoardConfig | null,
): string | null {
  if (!config) return null
  const boardId =
    boardType === "onboarding" ? config.onboarding_board_id : config.current_board_id
  if (!boardId) return null
  return `https://rocketleads-team.monday.com/boards/${boardId}/pulses/${itemId}`
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
  /** Raw Monday status label from the onboarding board's "Meta connected" column
   *  (`dup__of_status`). Empty when not set. Tracks whether the client has hooked
   *  up their Meta Business Manager — distinct from `metaAdAccountId`, which is
   *  the actual ID once known. Only meaningful on the onboarding board. */
  metaConnected: string
  /** Preferred client contact channel — Monday status label from `contact_channel`
   *  column. Typically "WhatsApp" / "Email" / "Phone" / "" (unset). Drives the
   *  Client Update composer so AMs see which channel a generated update will land
   *  on without having to flip to Trengo. */
  contactChannel: string
  metaAdAccountId: string
  stripeCustomerId: string
  trengoContactId: string
  clientBoardId: string
  googleDriveId: string
  /** Raw Monday status from the "Administration" column (`status_16` on the
   *  current-clients board). Reflects finance's manual bookkeeping on whether
   *  the invoice has been sent / paid / chased. Distinct from
   *  `BillingSummary.status` (Stripe-derived) — finance considers Monday the
   *  source of truth for the workflow state, not Stripe. Empty when unset
   *  or when the column isn't on the row's board. */
  administration: string
  /** Date the client's new billing cycle starts. Manual source of truth from
   *  Monday's `date3` column. `YYYY-MM-DD` or "" when unset. */
  cycleStartDate: string
  /** Date finance sends the invoice — always derived as `cycleStartDate - 7d`,
   *  but stored on Monday in column `date_mm3297df` so the CRM also has it.
   *  `YYYY-MM-DD` or "" when unset. */
  nextInvoiceDate: string
  boardType: "onboarding" | "current"
}

async function gql(
  query: string,
  variables: Record<string, unknown>,
  token: string,
  options: { bypassCache?: boolean } = {},
) {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
    // `bypassCache` is set by the user-facing Refresh path. Without it Next.js
    // would happily serve the same Monday response for 60s even when the
    // outer `cache_store` cache was explicitly bypassed — making Refresh feel
    // like it does nothing for up to a minute.
    ...(options.bypassCache ? { cache: "no-store" as const } : { next: { revalidate: 60 } }),
  })
  if (!res.ok) throw new Error(`Monday API error: ${res.status}`)
  const json = await res.json()
  if (json.errors) throw new Error(json.errors[0]?.message ?? "Monday API error")
  return json.data
}

export async function fetchAllItems(
  boardId: string,
  token: string,
  maxRetries = 4,
  options: { bypassCache?: boolean } = {},
) {
  // Page size lowered from 500 → 200 (2026-05) after a string of
  // CursorExpiredError reports on the Clients overview. Monday's `items_page`
  // cursor has a ~60s TTL; a 500-item page on a slow Monday day can take long
  // enough that the *next* page's cursor is already stale. 200 keeps each
  // round-trip well under the TTL while still being only ~5 pages for the
  // largest boards in the workspace.
  const query = `
    query GetItems($boardId: ID!, $cursor: String) {
      boards(ids: [$boardId]) {
        items_page(limit: 200, cursor: $cursor) {
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

  let lastError: unknown = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Exponential backoff between attempts — 0ms before the first attempt,
    // then ~500ms, ~1s, ~2s, ~4s. Gives Monday time to recover when it's
    // having a slow burst; without this, retrying immediately just hits the
    // same overloaded backend again. Jittered to avoid thundering-herd if
    // multiple boards retry at once from the same cron tick.
    if (attempt > 0) {
      const baseMs = 500 * Math.pow(2, attempt - 1)
      const jitter = Math.floor(Math.random() * 200)
      await new Promise((r) => setTimeout(r, baseMs + jitter))
    }

    try {
      const allItems: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string }> }> = []
      let cursor: string | null = null

      let firstPage = true
      do {
        const data = await gql(query, { boardId, cursor }, token, { bypassCache: options.bypassCache })
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
      lastError = error
      const msg = error instanceof Error ? error.message.toLowerCase() : ""
      // Retry on cursor expiry (most common) and on transient 5xx/timeout
      // signatures. Anything else (auth, malformed query, missing board) is
      // not going to fix itself — fail fast so the caller sees a real error.
      const retryable =
        msg.includes("cursor") ||
        msg.includes("timeout") ||
        msg.includes("502") ||
        msg.includes("503") ||
        msg.includes("504") ||
        msg.includes("complexity")
      if (!retryable || attempt === maxRetries) throw error
      // Backoff for the next iteration is applied at the top of the loop.
    }
  }

  // Loop exited without success and without throwing — defensive fallback,
  // surface the last seen error rather than silently returning empty.
  if (lastError) throw lastError
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
    metaConnected: cv[columns.meta_connected] ?? cv["dup__of_status"] ?? "",
    // Defaults reflect the status column IDs configured for both boards
    // (status_11 on onboarding, status_17 on current — see settings/page.tsx).
    contactChannel:
      cv[columns.contact_channel] ?? cv["status_11"] ?? cv["status_17"] ?? "",
    metaAdAccountId: cv[columns.meta_ad_account_id] ?? "",
    stripeCustomerId: cv[columns.stripe_customer_id] ?? "",
    trengoContactId: cv[columns.trengo_contact_id] ?? "",
    clientBoardId: cv[columns.client_board_id] ?? "",
    googleDriveId: cv[columns.google_drive_id] ?? "",
    // Falls back to the literal `status_16` column ID — current-clients board
    // uses it consistently and existing board_config rows may not have an
    // `administration` mapping yet.
    administration: cv[columns.administration] ?? cv["status_16"] ?? "",
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
  leadStatus: string
  dealValue: number
  utm: string
  dateDeal: string
}

/**
 * Lightweight Monday board metadata for the picker. Just enough to render
 * the row + a discriminator the AM can use to pick the right board:
 * board name, workspace, item count. We deliberately don't fetch columns
 * here — that'd make the search 10× slower for no UX gain.
 */
type MondayBoardSummary = {
  id: string
  name: string
  workspaceName: string | null
  itemsCount: number | null
  state: string
}

// Bumped v1 → v2 when the picker scope was narrowed to the "Client Dashboard"
// workspace. The v1 cache held boards from EVERY workspace the token could
// see, which surfaced internal / template / archive-bucket boards as picker
// candidates — exactly the noise that was breaking the link experience.
const ALL_BOARDS_CACHE_KEY = "monday_all_boards_v2"
const ALL_BOARDS_TTL_MS = 5 * 60 * 1000
const WORKSPACE_ID_CACHE_KEY = "monday_client_dashboards_workspace_id_v1"
const WORKSPACE_ID_TTL_MS = 24 * 60 * 60 * 1000

// Name-match for the per-client lead boards workspace. Roy 2026-06-09:
// "Ik wil dat je de workspace client dashboard aanhoudt" — only boards in
// this workspace should be offered as link candidates. Case-insensitive,
// tolerates "Dashboard"/"Dashboards"/extra whitespace so a future rename
// like "Client Dashboards 3.0" doesn't silently empty the picker.
const CLIENT_DASHBOARDS_WORKSPACE_NAME_PATTERN = /client\s*dashboards?/i

/**
 * Look up the Monday workspace ID for the "Client Dashboard" workspace.
 * Cached 24 hours — workspaces basically never change. The picker scopes
 * its boards query to this workspace so the AM only sees per-client lead
 * boards as link candidates, not internal/template/legacy boards.
 *
 * Returns null when no workspace matches the name pattern. Callers should
 * treat null as "filter not applied" and fall back to the unfiltered set
 * (with a logged warning) — better to show too many options than to ship
 * an empty picker if the workspace gets renamed.
 */
async function findClientDashboardsWorkspaceId(): Promise<string | null> {
  // Cached shape is `{ id }` (not the raw string|null) so the cache_store
  // `data` column — which has a NOT NULL constraint — can safely hold a
  // "we checked, nothing matched" result without re-querying every 5 minutes.
  const cached = await readCache<{ id: string | null }>(
    WORKSPACE_ID_CACHE_KEY,
    WORKSPACE_ID_TTL_MS,
  )
  if (cached) return cached.id

  const token = await getToken()
  // Monday's `workspaces` query is picky about parameters:
  //   - omit `state` entirely → defaults to "active" anyway, but explicit
  //     `state: active` errors on some plans with "Field 'state' doesn't exist"
  //   - `limit` is required on newer schema versions, 100 covers any realistic
  //     workspace count
  const query = `
    query GetWorkspaces {
      workspaces(limit: 100) {
        id
        name
      }
    }
  `
  const data = await gql(query, {}, token)
  const workspaces = (data.workspaces ?? []) as Array<{ id: string; name: string }>
  const match = workspaces.find((w) => CLIENT_DASHBOARDS_WORKSPACE_NAME_PATTERN.test(w.name))
  const id = match?.id ?? null

  // Cache wrapped so null is storable. 24h TTL on the "not found" case
  // gives the picker time to fall back to unfiltered while Roy figures out
  // whether the workspace got renamed.
  await writeCache(WORKSPACE_ID_CACHE_KEY, { id })
  if (!id) {
    // Log the actual workspace names so we can see what to match against
    // next time — the regex `/client\s*dashboards?/i` clearly missed; this
    // tells us whether the workspace is named "Klanten" / "Active Clients"
    // / something else entirely.
    const names = workspaces.map((w) => `"${w.name}"`).join(", ")
    console.warn(
      `[monday] Client Dashboard workspace not found. ` +
        `Searched ${workspaces.length} workspaces: ${names}. ` +
        `Board picker will fall back to unfiltered.`,
    )
  }
  return id
}

/**
 * Pull the active boards inside the "Client Dashboard" workspace. ~200
 * boards per page, capped at 5 pages — that workspace has well under 1000
 * boards today. Cached for 5 minutes so per-keystroke search in the picker
 * doesn't fan out into a Monday API call each time.
 *
 * Workspace filter falls back to "all accessible boards" if discovery fails
 * (renamed workspace, token without workspace access, etc.) — the picker
 * stays usable, just noisier.
 *
 * `state: active` filters out archived/deleted boards which the picker
 * should never offer as a destination — leftover archived boards were one
 * of the main reasons broken board IDs were getting linked.
 */
async function fetchAllAccessibleBoards(): Promise<MondayBoardSummary[]> {
  const cached = await readCache<MondayBoardSummary[]>(ALL_BOARDS_CACHE_KEY, ALL_BOARDS_TTL_MS)
  if (cached) return cached

  const workspaceId = await findClientDashboardsWorkspaceId()
  const token = await getToken()
  // Two query variants — workspace-scoped (primary) and unfiltered (fallback).
  // GraphQL doesn't let us pass `workspace_ids: null` to mean "no filter",
  // so we branch the query string.
  // Monday's `workspace_ids` arg is `[ID]` (nullable list items), not `[ID!]` —
  // passing the non-null variant errors with "Variable type mismatch". Same for
  // dropping `state: active` (default anyway, and explicit value is rejected on
  // some account schemas). `order_by: used_at` is kept — it's the order_by that
  // makes the cold-open list show "boards I actually touch" first.
  const scopedQuery = `
    query GetBoards($page: Int!, $workspaceIds: [ID]) {
      boards(limit: 200, page: $page, order_by: used_at, workspace_ids: $workspaceIds) {
        id
        name
        state
        items_count
        workspace { name }
      }
    }
  `
  const unscopedQuery = `
    query GetBoards($page: Int!) {
      boards(limit: 200, page: $page, order_by: used_at) {
        id
        name
        state
        items_count
        workspace { name }
      }
    }
  `
  const out: MondayBoardSummary[] = []
  for (let page = 1; page <= 5; page++) {
    const data = workspaceId
      ? await gql(scopedQuery, { page, workspaceIds: [workspaceId] }, token)
      : await gql(unscopedQuery, { page }, token)
    const boards = (data.boards ?? []) as Array<{
      id: string
      name: string
      state: string
      items_count: number | null
      workspace: { name: string } | null
    }>
    if (boards.length === 0) break
    for (const b of boards) {
      // Server-side state filter removed (schema-incompat on some accounts),
      // so filter client-side — archived/deleted boards must never appear as
      // link candidates in the picker.
      if (b.state !== "active") continue
      out.push({
        id: b.id,
        name: b.name,
        state: b.state,
        itemsCount: b.items_count ?? null,
        workspaceName: b.workspace?.name ?? null,
      })
    }
    if (boards.length < 200) break
  }

  await writeCache(ALL_BOARDS_CACHE_KEY, out)
  return out
}

function toResolvedBoard(b: MondayBoardSummary): ResolvedEntity {
  const subParts: string[] = []
  if (b.workspaceName) subParts.push(b.workspaceName)
  if (typeof b.itemsCount === "number") subParts.push(`${b.itemsCount} items`)
  return {
    id: b.id,
    name: b.name,
    subline: subParts.length > 0 ? subParts.join(" · ") : undefined,
  }
}

/**
 * Search Monday boards by name for the ConnectedEntity picker.
 *
 * Monday's `boards` GraphQL query has no name-filter parameter, so we fetch
 * the full accessible boards list (cached 5 minutes) and filter client-side.
 * The cache flips the per-keystroke cost from "Monday API roundtrip" to
 * "in-memory substring match" which is the only thing that makes a debounced
 * search picker feel snappy here.
 *
 * Ranking: exact-prefix matches before substring matches, then alphabetical.
 * The AM almost always types the start of the company name first — that's
 * the entry that should land at the top.
 */
export async function searchMondayBoards(
  query: string,
  limit = 10,
): Promise<ResolvedEntity[]> {
  const boards = await fetchAllAccessibleBoards()
  const trimmed = query.trim().toLowerCase()
  const cap = Math.min(Math.max(limit, 1), 25)

  if (trimmed.length === 0) {
    // Cold-open: most-recently-used boards (order_by: used_at) so the
    // top of the list is "boards you actually touch", not the alphabetical
    // A-list of every legacy board ever created.
    return boards.slice(0, cap).map(toResolvedBoard)
  }

  type Scored = { board: MondayBoardSummary; rank: number }
  const scored: Scored[] = []
  for (const b of boards) {
    const name = b.name.toLowerCase()
    if (name.startsWith(trimmed)) {
      scored.push({ board: b, rank: 0 })
    } else if (name.includes(trimmed)) {
      scored.push({ board: b, rank: 1 })
    }
  }
  scored.sort((a, b) => a.rank - b.rank || a.board.name.localeCompare(b.board.name))
  return scored.slice(0, cap).map((s) => toResolvedBoard(s.board))
}

/**
 * Resolve a single Monday board ID to its ResolvedEntity. Used by the
 * always-on verification on the picker trigger — every time a Client
 * Information panel renders, the stored `client_board_id` is round-tripped
 * to confirm the board still exists + the token still has access. Catches
 * the "board got archived in Monday but the ID is still set" failure mode
 * that's been silently breaking KPIs.
 *
 * Returns null when:
 *   - the ID doesn't match any board (Monday returns empty array)
 *   - the board exists but is archived/deleted (state !== "active")
 * Throws on transport/auth errors so the picker shows "couldn't verify"
 * instead of "definitely broken".
 */
export async function resolveMondayBoard(id: string): Promise<ResolvedEntity | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const token = await getToken()
  const query = `
    query GetBoard($boardId: ID!) {
      boards(ids: [$boardId]) {
        id
        name
        state
        items_count
        workspace { name }
      }
    }
  `
  const data = await gql(query, { boardId: trimmed }, token)
  const board = (data.boards ?? [])[0] as
    | {
        id: string
        name: string
        state: string
        items_count: number | null
        workspace: { name: string } | null
      }
    | undefined
  if (!board || board.state !== "active") return null
  return toResolvedBoard({
    id: board.id,
    name: board.name,
    state: board.state,
    itemsCount: board.items_count ?? null,
    workspaceName: board.workspace?.name ?? null,
  })
}

export async function fetchClientBoardItems(
  boardId: string,
  columnOverrides?: Record<string, string>,
  options: { bypassCache?: boolean } = {},
): Promise<MondayLeadItem[]> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")

  const cols = { ...config.client_board_columns, ...columnOverrides }
  const items = await fetchAllItems(boardId, token, undefined, { bypassCache: options.bypassCache })

  return items.map((item) => {
    const cv: Record<string, string> = {}
    for (const col of item.column_values) {
      cv[col.id] = col.text ?? ""
    }
    return {
      id: item.id,
      name: item.name,
      dateCreated: cv[cols.date_created] ?? "",
      leadStatus: cv[cols.lead_status] ?? "",
      dealValue: parseFloat(cv[cols.deal_value] ?? "0") || 0,
      utm: cv[cols.utm] ?? "",
      dateDeal: cv[cols.date_deal] ?? "",
    }
  })
}

/** Cache key for a single Monday client item. Burst via `deleteCache` after
 *  any PATCH that updates a column on this item (see /api/clients/[id]
 *  PATCH handler). */
export const clientItemCacheKey = (itemId: string) => `monday_client_item:${itemId}`

/**
 * Cached single-client fetch. Backs the slide-over's primary network call —
 * every slide-over open used to spend 300-800ms (sometimes 2s) waiting on
 * Monday GraphQL before the panel even rendered tabs. A 5-minute TTL keeps
 * the call instant in normal workflow; PATCH bursts the entry so client edits
 * never serve stale data.
 */
/**
 * Pass `bypassCache: true` after any write to this same item — the 5-minute
 * cached value is stale the moment Monday accepts the change, and serving it
 * back to the caller (typically `updateClientField` patching the
 * `monday_boards` cache) would re-poison the cache with pre-edit data.
 */
export async function fetchClientById(
  itemId: string,
  options: { bypassCache?: boolean } = {},
): Promise<MondayClient | null> {
  return cachedFetch(
    clientItemCacheKey(itemId),
    () => fetchClientByIdLive(itemId, { bypassCache: options.bypassCache }),
    5 * 60 * 1000,
    { bypass: options.bypassCache },
  )
}

async function fetchClientByIdLive(
  itemId: string,
  options: { bypassCache?: boolean } = {},
): Promise<MondayClient | null> {
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

  const data = await gql(query, { itemId }, token, { bypassCache: options.bypassCache })
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

/**
 * Fuller version of {@link fetchItemUpdates} used by the timeline backfill —
 * paginates through ALL updates for an item (not just the last 50), returns
 * the Monday update id (stable dedupe key), full ISO timestamps, raw HTML
 * body (for downstream mention parsing), and the creator's Monday user id.
 *
 * Monday's `updates` connection caps `limit` at 100 per page; we walk pages
 * until a short page comes back. Internal safety cap stops us at 50 pages
 * (=5,000 updates) — no real client has more than that.
 */
export type ItemUpdateFull = {
  /** Stable Monday update id — anchor for `source_msg_id` dedupe. */
  id: string
  /** Plain-text body (stripped by Monday). Empty when the update was purely
   *  attachment-driven. */
  text: string
  /** Raw HTML body — used for parsing @-mention anchors during backfill. */
  body: string
  /** Full ISO timestamp (UTC). */
  createdAt: string
  /** Monday user id of the author. Empty when Monday didn't return one. */
  creatorId: string
  /** Author display name. Empty when Monday didn't return one. */
  creatorName: string
}

export async function fetchAllItemUpdates(itemId: string): Promise<ItemUpdateFull[]> {
  const token = await getToken()

  const query = `
    query GetAllItemUpdates($itemId: ID!, $page: Int!) {
      items(ids: [$itemId]) {
        updates(limit: 100, page: $page) {
          id
          text_body
          body
          created_at
          creator { id name }
        }
      }
    }
  `

  type RawUpdate = {
    id?: string | number
    text_body?: string
    body?: string
    created_at?: string
    creator?: { id?: string | number; name?: string } | null
  }

  const all: ItemUpdateFull[] = []
  for (let page = 1; page <= 50; page++) {
    const data = await gql(query, { itemId, page }, token)
    const updates = (data.items?.[0]?.updates ?? []) as RawUpdate[]
    if (updates.length === 0) break
    for (const u of updates) {
      const id = String(u.id ?? "")
      if (!id) continue
      all.push({
        id,
        text: (u.text_body ?? "").trim(),
        body: u.body ?? "",
        createdAt: u.created_at ?? "",
        creatorId: u.creator?.id != null ? String(u.creator.id) : "",
        creatorName: (u.creator?.name ?? "").trim(),
      })
    }
    if (updates.length < 100) break // last page
  }
  return all
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
/**
 * Hardcoded fallback Monday column IDs for logical keys that are stable
 * across boards. Lets the write path succeed without forcing every existing
 * `board_config` row to be re-saved through Settings — same pattern the read
 * path uses inline in `mapItem` (e.g. `cv[columns.administration] ?? cv["status_16"]`).
 * Keep entries in lockstep with the corresponding `mapItem` fallbacks.
 */
const KNOWN_COLUMN_FALLBACKS: Record<string, string> = {
  administration: "status_16",
}

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
  const columnId = columns[columnKey] ?? KNOWN_COLUMN_FALLBACKS[columnKey]
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
  const columnId = columns[columnKey] ?? KNOWN_COLUMN_FALLBACKS[columnKey]
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
 *
 * Author attribution: when `actorUserId` is provided AND that user has
 * connected their personal Monday API token (via Account → Connected
 * accounts), the call uses their token so Monday shows them as the
 * poster. Otherwise we fall back to the shared service token, which
 * means the update will appear as whoever owns that token (currently
 * Roy). Falling back instead of erroring keeps automation paths
 * (Pedro / webhooks / system tasks) working even when no human is the
 * actor.
 */
export async function postItemUpdate(
  itemId: string,
  body: string,
  parentUpdateIdOrOptions?: string | { parentUpdateId?: string; actorUserId?: string },
): Promise<string | null> {
  // Back-compat: original positional `parentUpdateId: string` arg.
  const opts =
    typeof parentUpdateIdOrOptions === "string"
      ? { parentUpdateId: parentUpdateIdOrOptions }
      : parentUpdateIdOrOptions ?? {}
  const parentUpdateId = opts.parentUpdateId
  const actorUserId = opts.actorUserId

  let token: string | null = null
  if (actorUserId) {
    token = await getUserPlatformToken(actorUserId, "monday")
  }
  if (!token) token = await getToken()

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

// ─── Webhook management ─────────────────────────────────────────────────
// Used by the admin tool to register / inspect / remove Monday webhooks for
// real-time client-mutation sync (status edits, name changes, create, delete).
// Endpoint: /api/webhooks/monday — see that route for what each event drives.

/** Event types Monday webhooks support that we currently consume.
 *  Adding a new one here is a no-op until the receiver knows what to do with
 *  it; the registration helpers below + the receiver are the matched pair.
 *
 *  Monday's v2 GraphQL enum renamed the legacy `create_pulse` to
 *  `create_item`. The new name is what `create_webhook` accepts; the
 *  receiver below still tolerates `create_pulse` payloads for back-compat
 *  if any older webhook lingers anywhere. */
export type MondayWebhookEvent =
  | "change_column_value"
  | "change_name"
  | "create_item"
  | "item_deleted"
  | "create_update"

export type MondayWebhook = {
  id: string
  boardId: string
  event: MondayWebhookEvent
  url: string | null
}

/**
 * Register a single webhook on a Monday board. Idempotency is the CALLER's
 * problem — Monday happily creates duplicates if you ask twice. The admin
 * registration endpoint reconciles by listing first and only creating the
 * missing (boardId, event) pairs.
 *
 * Returns the new webhook's Monday id.
 */
export async function createMondayWebhook(
  boardId: string,
  event: MondayWebhookEvent,
  url: string,
): Promise<string> {
  const token = await getToken()
  const query = `mutation ($boardId: ID!, $url: String!, $event: WebhookEventType!) {
    create_webhook(board_id: $boardId, url: $url, event: $event) {
      id
    }
  }`
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { boardId, url, event } }),
  })
  const json = (await res.json()) as {
    data?: { create_webhook?: { id?: string } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(`create_webhook failed: ${json.errors.map((e) => e.message).join("; ")}`)
  }
  const id = json.data?.create_webhook?.id
  if (!id) throw new Error("create_webhook returned no id")
  return id
}

/**
 * List existing webhooks on a board so the admin tool can show what's already
 * registered + skip duplicates on re-registration. Returned `url` may be null
 * — Monday doesn't always echo it back depending on app permissions.
 */
export async function listMondayWebhooks(boardId: string): Promise<MondayWebhook[]> {
  const token = await getToken()
  const query = `query ($boardId: ID!) {
    webhooks(board_id: $boardId) { id board_id event config }
  }`
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { boardId } }),
  })
  const json = (await res.json()) as {
    data?: { webhooks?: Array<{ id: string; board_id: string; event: string; config?: string }> }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    throw new Error(`webhooks query failed: ${json.errors.map((e) => e.message).join("; ")}`)
  }
  const list = json.data?.webhooks ?? []
  return list.map((w) => {
    let url: string | null = null
    if (w.config) {
      try {
        const parsed = JSON.parse(w.config) as { url?: string }
        url = parsed.url ?? null
      } catch {
        // Some webhook configs aren't JSON — leave url null.
      }
    }
    return {
      id: String(w.id),
      boardId: String(w.board_id),
      event: w.event as MondayWebhookEvent,
      url,
    }
  })
}

/** Remove a webhook by Monday's webhook id. Used by the admin tool to clean
 *  up dangling webhooks (URL changed, env rotated, board retired). */
export async function deleteMondayWebhook(webhookId: string): Promise<void> {
  const token = await getToken()
  const query = `mutation ($id: ID!) { delete_webhook(id: $id) { id } }`
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { id: webhookId } }),
  })
  const json = (await res.json()) as { errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`delete_webhook failed: ${json.errors.map((e) => e.message).join("; ")}`)
  }
}
