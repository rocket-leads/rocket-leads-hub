import { auth } from "@/lib/auth"
import { NextRequest, NextResponse } from "next/server"
import { updateClientField } from "@/lib/clients/edit"
import { createAdminClient } from "@/lib/supabase/server"
import { getBoardConfig, getToken } from "@/lib/integrations/monday"

/**
 * POST /api/clients/[id]/onboarding/rl-ad-account
 *
 * Triggered when the AM ticks "We draaien op RL ad account" in Stap 1.
 * Two writes back to Monday:
 *
 *   1. `meta_ad_account_id` = RL_OWN_AD_ACCOUNT_ID env var. The wizard
 *      no longer needs the klant to add RL as partner in their BM
 *      (per knowledge/process.md §"Onboarding Roadblocks" #3).
 *   2. Status column ("color" on current board, "color5" on onboarding
 *      board) → "Rocket Leads". This flags to finance that ad budget
 *      gets invoiced to the klant through RL instead of paid directly
 *      to Meta. AM still has to enter the ad budget amount manually on
 *      Monday — the UI surfaces a reminder.
 *
 * The status column ID is board-specific so we resolve it inline rather
 * than via board_config (which would need an editable row added on
 * production Supabase first). Roy 2026-06-11 confirmed: `color` /
 * `color5`.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const adAccountId = process.env.RL_OWN_AD_ACCOUNT_ID
  if (!adAccountId) {
    return NextResponse.json(
      {
        error:
          "RL_OWN_AD_ACCOUNT_ID env var is not set. Add it to .env.local + Vercel so this toggle can fill the field.",
      },
      { status: 500 },
    )
  }

  const { id: mondayItemId } = await params

  // ── 1. Set meta_ad_account_id (via the standard editor path so the
  //      Supabase mirror + slide-over cache stay in lockstep) ──
  try {
    await updateClientField(mondayItemId, {
      fieldKey: "meta_ad_account_id",
      value: adAccountId,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to set RL ad account" },
      { status: 500 },
    )
  }

  // ── 2. Flip the board-specific "ad budget source" status column to
  //      "Rocket Leads". Best-effort — failure here doesn't undo the
  //      ad-account write above; the AM sees a warning in the response
  //      so they can fix it manually on Monday. ──
  let statusFlipError: string | null = null
  try {
    const supabase = await createAdminClient()
    const { data: client } = await supabase
      .from("clients")
      .select("monday_board_type")
      .eq("monday_item_id", mondayItemId)
      .single()
    if (!client) throw new Error(`Client ${mondayItemId} not synced to Supabase yet.`)

    const boardType = client.monday_board_type as "onboarding" | "current"
    const columnId = boardType === "onboarding" ? "color5" : "color"

    await writeStatusByColumnId(boardType, mondayItemId, columnId, "Rocket Leads")
  } catch (e) {
    statusFlipError = e instanceof Error ? e.message : "Status flip failed"
    console.error(
      `[rl-ad-account] Status column flip failed for ${mondayItemId}:`,
      statusFlipError,
    )
  }

  return NextResponse.json({
    ok: true,
    adAccountId,
    statusFlipError,
  })
}

/**
 * Direct Monday GQL write to a status column by its raw column ID.
 * Used for board-specific columns that aren't in board_config or the
 * KNOWN_COLUMN_FALLBACKS map. Mirrors the shape `setItemColumnValueRaw`
 * uses for status columns (`{ label: "…" }` payload).
 */
async function writeStatusByColumnId(
  boardType: "onboarding" | "current",
  itemId: string,
  columnId: string,
  label: string,
): Promise<void> {
  const [token, config] = await Promise.all([getToken(), getBoardConfig()])
  if (!config) throw new Error("Board config not found.")
  const boardId =
    boardType === "onboarding" ? config.onboarding_board_id : config.current_board_id

  const mutation = `
    mutation SetStatus($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) { id }
    }
  `

  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({
      query: mutation,
      variables: {
        boardId,
        itemId,
        columnId,
        value: JSON.stringify({ label }),
      },
    }),
  })
  if (!res.ok) throw new Error(`Monday API error: ${res.status}`)
  const json = (await res.json()) as { errors?: Array<{ message: string }> }
  if (json.errors?.length) {
    throw new Error(`Monday GQL errors: ${json.errors.map((e) => e.message).join("; ")}`)
  }
}
